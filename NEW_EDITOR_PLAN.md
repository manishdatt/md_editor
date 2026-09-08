# Production Architecture & Implementation Specification: Bun + Hono + HTMX + Milkdown + SQLite Editor

A production-grade, hardened specification and deployment architecture for building a zero-build, ultra-lightweight Dual-Editor (Markdown & Typst) web application with **AI Ghost Text Completions** on a 1GB RAM Ubuntu VPS (Oracle Cloud Free Tier) using Caddy, Litestream, and SQLite.

---

## 1. Architectural Principles & System Design

The application maintains **separate editing workflows for Markdown and Typst documents**, with AI Ghost completions & Typst exports scoped exclusively to authenticated logged-in users:

- **Markdown Documents (`format = 'markdown'`)**: Edited using **Milkdown v7 WYSIWYG editor** + ProseMirror AI Ghost Plugin (Logged-in users).
- **Typst Documents (`format = 'typst'`)**: Edited using a raw monospace code editor workspace + Server-side native `typst compile` PDF preview & download engine (Logged-in users).
- **AI Ghost Text Engine**: Debounced fetch (800ms) to `/api/ai/completion` (NVIDIA/Gemini API provider switch on Hono), rendering inline ghost text that accepts on `Tab` and dismisses on `Esc` or typing.

```
                                [ Client Browser ]
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
     [ HTMX 2.0.2 ]             [ Pico.css 2.0.6 ]         [ Dual Editor Modes ]
  (Vendored /static/js)        (Vendored /static/css)     (Markdown: Milkdown v7)
           │                            │                 (Typst: Code Editor)
           └────────────────────────────┴────────────────────────────┘
                                        │
                               [ AI Ghost Engine ]
                      (Tab to Accept, Esc to Dismiss)
                                        │
                       (HTTPS / Compression / CSRF Guard)
                                        │
                                        ▼
                            [ Caddy Reverse Proxy ]
                   (Auto-TLS, Security Headers, Absolute Paths)
                                        │
                                        ▼
                      [ Bun + Hono Production Server ]
            (Port 3000, Systemd MemoryMax=750M, Shared /tmp Sandbox)
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
    [ BetterAuth ]             [ AI Completion Route ]        [ Typst Compile Engine ]
 (Google/GitHub Redirect)     (Provider Switch & Bounds)     (--root Confinement)
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        │
                                        ▼
                            [ Drizzle ORM + bun:sqlite ]
                     (WAL, PRAGMA busy_timeout=5000, DATABASE_PATH)
                                        │
                                        ▼
                           [ Litestream >= 0.4.0 Daemon ]
               (Continuous WAL Stream -> OCI S3, User: ubuntu)
```

---

## 2. Tech Stack Specifications & Pin Matrix

| Component | Minimum Version | Pin / Recommended | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime** | `bun >= 1.1.27` | `1.1.27` | JS/TS runtime, package manager & native `bun:sqlite` engine |
| **Web Server** | `hono >= 4.5.11` | `4.5.11` | Backend framework, JSX renderer & `hono-rate-limiter` |
| **Hypermedia** | `htmx.org` | `2.0.2` | SPA behavior, fragment swaps, auto-save triggers |
| **UI Framework** | `@picocss/pico` | `2.0.6` (Vendored) | Classless, zero-build semantic CSS theme |
| **Markdown Editor** | `@milkdown/*` | `7.3.6` (Importmap Pinned) | ProseMirror WYSIWYG editor engine for Markdown mode |
| **Database** | `drizzle-orm` | `>= 0.33.0` | Embedded SQLite with WAL mode & busy timeout guards |
| **Authentication** | `better-auth` | `>= 1.3.0` | OAuth2 social provider integration (Google, GitHub) |
| **PDF Compiler**| Native `typst` CLI | `>= 0.11.0` (Sandboxed) | Server-side PDF compilation engine |
| **Backup** | `litestream` | `>= 0.4.0` | Live WAL replication (`-if-replica-exists` support) |
| **Proxy** | `caddy` | `>= 2.8.0` (Stock binary) | Automated Let's Encrypt TLS, Gzip/Zstd, Security Headers |

---

## 3. Security & Utility Helpers

### 3.1 Escaping Helpers (`server/utils/security.ts`)
```typescript
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function escapeJsonScript(str: string): string {
  return str.replace(/<\/script>/gi, '<\\/script>')
}
```

### 3.2 CSRF Protection (Excludes `/api/auth/*`)
```typescript
export async function csrfProtection(c: any, next: any) {
  if (c.req.path.startsWith('/api/auth/')) {
    return next()
  }

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    const originHeader = c.req.header('origin') || c.req.header('referer')
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000'

    if (!originHeader) {
      return c.text('Forbidden: Missing CSRF Origin Header', 403)
    }

    try {
      const requestOrigin = new URL(originHeader).origin
      const expectedOrigin = new URL(siteUrl).origin

      if (requestOrigin !== expectedOrigin) {
        return c.text('Forbidden: Invalid CSRF Origin', 403)
      }
    } catch (_) {
      return c.text('Forbidden: Malformed Origin Header', 403)
    }
  }
  await next()
}
```

### 3.3 AI Completion Route (`server/routes/ai.ts`)
Trusts `x-real-ip` from Caddy proxy, logs upstream API warnings, truncates context, and handles timeouts.

```typescript
import { Hono } from 'hono'
import { auth } from '../auth'
import { rateLimiter } from 'hono-rate-limiter'

export const aiRoutes = new Hono()

const aiRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (c) => c.req.header('x-real-ip') || 'anonymous'
})

aiRoutes.post('/completion', aiRateLimiter, async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ completion: '' }, 401)

  const body = await c.req.parseBody()
  const prompt = String(body.prompt || '').slice(0, 150)
  const prefix = String(body.prefix || '').slice(-2000)

  if (!prompt.trim()) return c.json({ completion: '' })

  const provider = process.env.AI_PROVIDER || 'nvidia'
  const apiKey = provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.NVIDIA_API_KEY
  if (!apiKey) return c.json({ completion: '' })

  let timeoutId: any = null
  const controller = new AbortController()
  timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    let completion = ''

    if (provider === 'gemini') {
      const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Prefix:\n${prefix}\nCurrent line: ${prompt}\n\nComplete the line naturally. Return ONLY the continuation text.` }] }],
          generationConfig: { maxOutputTokens: 30, temperature: 0.2 }
        })
      })
      if (!res.ok) console.warn(`[AI WARN] Gemini returned status ${res.status}`)
      const data = await res.json()
      completion = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } else {
      const model = process.env.NVIDIA_MODEL || 'openai/gpt-oss-20b'
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are an inline text completion assistant. Return ONLY the completion text.' },
            { role: 'user', content: `Prefix:\n${prefix}\nCurrent line: ${prompt}` }
          ],
          max_tokens: 30,
          temperature: 0.2
        })
      })
      if (!res.ok) console.warn(`[AI WARN] NVIDIA API returned status ${res.status}`)
      const data = await res.json()
      completion = data.choices?.[0]?.message?.content || ''
    }

    return c.json({ completion })
  } catch (err: any) {
    console.warn(`[AI WARN] Completion fetch failed: ${err.message}`)
    return c.json({ completion: '' })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
})
```

---

## 4. Server Views & Complete Entry Point (`server/index.ts`)

### 4.1 Base Layout with Conditional SRI (`server/views/layout.tsx`)
Omits `integrity` attribute if `sriHash` is empty (local dev), avoiding browser block bugs.

```tsx
import { jsxRenderer } from 'hono/jsx-renderer'

export const mainLayout = jsxRenderer(({ children, title, sriHash }) => (
  <html lang="en" data-theme="dark">
    <head>
      <meta charset="utf-8" />
      <title>{title || 'Editor'}</title>
      <link rel="stylesheet" href="/static/css/pico.min.css" />
      
      {/* Pinned ESM Importmap */}
      <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        imports: {
          "@milkdown/core": "https://esm.sh/@milkdown/core@7.3.6",
          "@milkdown/ctx": "https://esm.sh/@milkdown/ctx@7.3.6",
          "@milkdown/preset-gfm": "https://esm.sh/@milkdown/preset-gfm@7.3.6",
          "@milkdown/theme-nord": "https://esm.sh/@milkdown/theme-nord@7.3.6",
          "@milkdown/plugin-listener": "https://esm.sh/@milkdown/plugin-listener@7.3.6",
          "@milkdown/prose": "https://esm.sh/@milkdown/prose@7.3.6",
          "@milkdown/prose/state": "https://esm.sh/@milkdown/prose@7.3.6/state",
          "@milkdown/prose/view": "https://esm.sh/@milkdown/prose@7.3.6/view"
        }
      }) }}></script>

      {/* Conditional SRI Tag: Omits integrity attribute when hash is empty */}
      {sriHash ? (
        <script src="/static/js/htmx.min.js" integrity={sriHash} crossorigin="anonymous"></script>
      ) : (
        <script src="/static/js/htmx.min.js"></script>
      )}
      
      <script type="module" src="/static/js/editor-client.js"></script>
    </head>
    <body>
      <main class="container">{children}</main>
    </body>
  </html>
))
```

### 4.2 Complete Server Entry (`server/index.ts`)
```typescript
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { db } from './db'
import { documents } from './db/schema'
import { eq, and } from 'drizzle-orm'
import { auth } from './auth'
import { aiRoutes } from './routes/ai'
import { mainLayout } from './views/layout'
import { escapeHtml, escapeJsonScript, csrfProtection } from './utils/security'
import { rateLimiter } from 'hono-rate-limiter'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { existsSync } from 'fs'

const app = new Hono()

const siteUrl = process.env.SITE_URL || 'http://localhost:3000'
const htmxSriHash = process.env.HTMX_SRI_HASH || ''
console.log(`[BOOT] Server configured with SITE_URL: ${siteUrl}`)

// Static Assets & CSRF Guard
app.use('/static/*', serveStatic({ root: './' }))
app.use('/api/*', csrfProtection)

// Route Handlers
app.route('/api/ai', aiRoutes)
app.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))

// Shared Autosave/Title Limiter (2 requests/sec)
const docUpdateRateLimiter = rateLimiter({
  windowMs: 1000,
  limit: 2,
  keyGenerator: (c) => c.req.header('x-real-ip') || 'anonymous'
})

// PDF Export Handler
const pdfRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (c) => c.req.header('x-real-ip') || 'anonymous'
})

app.post('/api/export/pdf', pdfRateLimiter, async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.text('Unauthorized: Logged-in users only', 401)

  const body = await c.req.parseBody()
  const docId = String(body.id || '')
  if (!docId) return c.text('Document ID required', 400)

  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, docId), eq(documents.userId, session.user.id))
  })

  if (!doc) return c.text('Document not found', 404)
  if (doc.format !== 'typst') return c.text('PDF export requires a Typst document', 400)
  if (doc.content.length > 500_000) return c.text('Document exceeds 500KB limit', 413)

  const uuid = crypto.randomUUID()
  const sandboxDir = `/tmp/typst-sandbox-${uuid}`
  const tmpFile = `${sandboxDir}/input.typ`
  const pdfFile = `${sandboxDir}/output.pdf`

  await Bun.mkdir(sandboxDir, { recursive: true })
  await Bun.write(tmpFile, doc.content)

  let proc: any = null
  let timeoutTimer: any = null

  try {
    proc = Bun.spawn(['typst', 'compile', '--root', sandboxDir, tmpFile, pdfFile], {
      stderr: 'pipe',
      stdout: 'pipe'
    })

    const stderrPromise = new Response(proc.stderr).text()
    const stdoutPromise = new Response(proc.stdout).text()

    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        if (proc) { try { proc.kill() } catch (_) {} }
        reject(new Error('Typst compilation timed out'))
      }, 10_000)
    })

    const exitCode = await Promise.race([proc.exited, timeoutPromise])
    clearTimeout(timeoutTimer)

    const stderr = await stderrPromise
    await stdoutPromise

    if (exitCode !== 0) {
      return c.json({ error: 'Typst compilation failed', details: stderr }, 422)
    }

    const pdfBuffer = await Bun.file(pdfFile).arrayBuffer()
    const safeFilename = doc.title.toLowerCase().replace(/[^a-z0-9-_]/g, '_').slice(0, 80) || 'document'

    return c.body(pdfBuffer, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`
    })
  } catch (err: any) {
    if (proc) { try { proc.kill() } catch (_) {} }
    return c.json({ error: err.message || 'Internal compilation error' }, 500)
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    void Bun.spawn(['rm', '-rf', sandboxDir]).exited.catch(() => {})
  }
})

// Document Management Handlers
app.post('/api/documents/:id/title', docUpdateRateLimiter, async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.text('Unauthorized', 401)

  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const title = String(body.title || 'Untitled Document').slice(0, 150)

  const updated = await db.update(documents)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
    .returning()

  if (updated.length === 0) return c.text('Document not found', 404)
  return c.text('Title updated', 200)
})

app.post('/api/documents/:id/autosave', docUpdateRateLimiter, async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.text('Unauthorized', 401)

  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const content = String(body.content || '')

  if (content.length > 1_000_000) return c.text('Content exceeds 1MB limit', 413)

  const updated = await db.update(documents)
    .set({ content, updatedAt: new Date() })
    .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
    .returning()

  if (updated.length === 0) return c.text('Document not found', 404)
  return c.html('<span class="save-status">Saved</span>')
})

// Page View Rendering
app.use('*', mainLayout)

app.get('/doc/:id', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.redirect('/')

  const id = c.req.param('id')
  const doc = await db.query.documents.findFirst({
    where: and(eq(documents.id, id), eq(documents.userId, session.user.id))
  })

  if (!doc) return c.render(<article><p>Document not found</p></article>, { sriHash: htmxSriHash })

  const isTypst = doc.format === 'typst'
  const safeContent = escapeHtml(doc.content)
  const payloadJson = escapeJsonScript(JSON.stringify({ id: doc.id, content: doc.content }))

  return c.render(
    <article id="workspace">
      <header class="flex justify-between items-center mb-4">
        <div>
          <mark>{isTypst ? 'TYPST' : 'MARKDOWN'}</mark>
          <input
            type="text"
            name="title"
            value={doc.title}
            hx-post={`/api/documents/${doc.id}/title`}
            hx-trigger="change delay:500ms"
          />
        </div>
        <div>
          {isTypst ? (
            <form action="/api/export/pdf" method="POST" target="_blank">
              <input type="hidden" name="id" value={doc.id} />
              <button type="submit">Compile & Export PDF</button>
            </form>
          ) : (
            <button type="button" class="secondary" id="print-btn">Print / Export</button>
          )}
        </div>
      </header>

      <script type="application/json" id="doc-payload" dangerouslySetInnerHTML={{ __html: payloadJson }}></script>

      <form id="autosave-form" hx-post={`/api/documents/${doc.id}/autosave`} hx-trigger="save-doc delay:1000ms" hx-sync="this:replace" hx-target="#save-status">
        <input type="hidden" id="autosave-content" name="content" />
      </form>

      {isTypst ? (
        <textarea
          id="typst-editor"
          style="font-family: monospace; min-height: 500px; width: 100%;"
          spellcheck="false"
          dangerouslySetInnerHTML={{ __html: safeContent }}
        ></textarea>
      ) : (
        <div id="milkdown-editor"></div>
      )}

      <footer class="mt-2 text-sm flex justify-between">
        <span id="save-status" class="save-status">Saved</span>
      </footer>
    </article>,
    { title: `${doc.title} | Editor`, sriHash: htmxSriHash }
  )
})

// Auto-bootstrap DB Migration & Folder Check
if (!existsSync('./drizzle')) {
  console.error('[BOOT FATAL] Directory "./drizzle" not found. Run "bunx drizzle-kit generate" before starting server.')
  process.exit(1)
}

try {
  migrate(db, { migrationsFolder: './drizzle' })
  console.log('[BOOT] Database migrations applied successfully.')
} catch (err) {
  console.error('[BOOT FATAL] Migration failed:', err)
  process.exit(1)
}

export default {
  port: 3000,
  fetch: app.fetch
}
```

---

## 5. Client Script & AI Ghost Plugin (`static/js/editor-client.js`)

```javascript
import { Editor, rootCtx, defaultValueCtx, prosePluginsCtx } from '@milkdown/core'
import { gfm } from '@milkdown/preset-gfm'
import { nord } from '@milkdown/theme-nord'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'

let activeEditorInstance = null
let typstInputHandler = null
let printBtnHandler = null
let aiDebounceTimer = null

const ghostPluginKey = new PluginKey('ai-ghost-text')

function createAiGhostPlugin() {
  let currentGhostText = ''
  let ghostPos = null

  return new Plugin({
    key: ghostPluginKey,
    state: {
      init() { return DecorationSet.empty },
      apply(tr, set) {
        if (tr.docChanged) {
          currentGhostText = ''
          ghostPos = null
          return DecorationSet.empty
        }
        const meta = tr.getMeta(ghostPluginKey)
        if (meta) {
          currentGhostText = meta.text || ''
          ghostPos = meta.pos ?? null
        }
        return set.map(tr.mapping, tr.doc)
      }
    },
    props: {
      decorations(state) {
        if (!currentGhostText || ghostPos === null) return DecorationSet.empty

        const span = document.createElement('span')
        span.className = 'ai-ghost-text'
        span.textContent = currentGhostText
        span.style.color = '#888'
        span.style.opacity = '0.6'
        span.style.pointerEvents = 'none'

        return DecorationSet.create(state.doc, [Decoration.widget(ghostPos, span, { side: 1 })])
      },
      handleKeyDown(view, event) {
        if (event.key === 'Tab' && currentGhostText && ghostPos !== null) {
          event.preventDefault()
          const tr = view.state.tr.insertText(currentGhostText, ghostPos)
          tr.setMeta(ghostPluginKey, { text: '', pos: null })
          view.dispatch(tr)
          return true
        }

        if (event.key === 'Escape') {
          const tr = view.state.tr.setMeta(ghostPluginKey, { text: '', pos: null })
          view.dispatch(tr)
          return true
        }

        if (event.key.length === 1 || event.key === 'Backspace') {
          if (aiDebounceTimer) clearTimeout(aiDebounceTimer)
          aiDebounceTimer = setTimeout(async () => {
            const { $from } = view.state.selection
            const lineText = $from.parent.textContent
            if (!lineText || lineText.trim().length < 5) return

            const prefix = view.state.doc.textBetween(0, $from.pos).slice(-2000)
            const targetPos = $from.pos

            try {
              const res = await fetch('/api/ai/completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ prompt: lineText, prefix })
              })
              const data = await res.json()

              if (data.completion && view.state.selection.$from.pos === targetPos) {
                const tr = view.state.tr.setMeta(ghostPluginKey, { text: data.completion, pos: targetPos })
                view.dispatch(tr)
              }
            } catch (_) {}
          }, 800)
        }

        return false
      }
    }
  })
}

function triggerAutosave(markdown) {
  const saveInput = document.getElementById('autosave-content')
  const saveForm = document.getElementById('autosave-form')
  if (saveInput && saveForm) {
    saveInput.value = markdown
    htmx.trigger(saveForm, 'save-doc')
  }
}

async function initEditor() {
  const container = document.getElementById('milkdown-editor')
  const typstEditor = document.getElementById('typst-editor')
  const payloadEl = document.getElementById('doc-payload')
  const printBtn = document.getElementById('print-btn')

  if (aiDebounceTimer) clearTimeout(aiDebounceTimer)

  if (typstEditor && typstInputHandler) {
    typstEditor.removeEventListener('input', typstInputHandler)
    typstInputHandler = null
  }
  if (printBtn && printBtnHandler) {
    printBtn.removeEventListener('click', printBtnHandler)
    printBtnHandler = null
  }
  if (activeEditorInstance) {
    try { await activeEditorInstance.destroy() } catch (_) {}
    activeEditorInstance = null
  }

  if (printBtn) {
    printBtnHandler = () => window.print()
    printBtn.addEventListener('click', printBtnHandler)
  }

  if (typstEditor) {
    typstInputHandler = (e) => triggerAutosave(e.target.value)
    typstEditor.addEventListener('input', typstInputHandler)
    return
  }

  if (container && payloadEl) {
    try {
      const payload = JSON.parse(payloadEl.textContent || '{}')

      activeEditorInstance = await Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, container)
          ctx.set(defaultValueCtx, payload.content || '')
          ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
            triggerAutosave(markdown)
          })
          const existingPlugins = ctx.get(prosePluginsCtx) || []
          ctx.set(prosePluginsCtx, [...existingPlugins, createAiGhostPlugin()])
        })
        .config(nord)
        .use(gfm)
        .use(listener)
        .create()
    } catch (e) {
      console.error('Failed to initialize Milkdown:', e)
    }
  }
}

document.addEventListener('htmx:afterSettle', initEditor)
document.addEventListener('htmx:beforeSwap', () => {
  if (aiDebounceTimer) clearTimeout(aiDebounceTimer)
  if (activeEditorInstance) {
    try { activeEditorInstance.destroy() } catch (_) {}
    activeEditorInstance = null
  }
})
```

---

## 6. Infrastructure Hardening & Configs

### 6.1 Stock Caddyfile (`Caddyfile`)
```caddy
editor.yourdomain.com {
    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://esm.sh;"
    }

    handle_path /static/* {
        root * /var/www/editor/static
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    reverse_proxy localhost:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
    }

    encode gzip zstd
}
```

### 6.2 App Systemd Service (`/etc/systemd/system/editor.service`)
```ini
[Unit]
Description=Bun Hono Editor Production Server
After=network.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/var/www/editor

# ExecStartPre guarantees DB restoration from Litestream >=0.4.0 before server boot if missing
ExecStartPre=/bin/sh -c 'if [ ! -f /var/www/editor/data/editor.db ]; then /usr/local/bin/litestream restore -if-replica-exists -config /etc/litestream.yml /var/www/editor/data/editor.db; fi'

ExecStart=/home/ubuntu/.bun/bin/bun run server/index.ts
Restart=always
RestartSec=5

EnvironmentFile=/var/www/editor/.env
Environment=DATABASE_PATH=/var/www/editor/data/editor.db
Environment=BUN_TMPDIR=/tmp

MemoryHigh=600M
MemoryMax=750M
MemoryAccounting=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/var/www/editor/data /tmp

[Install]
WantedBy=multi-user.target
```

### 6.3 Litestream Service (`/etc/systemd/system/litestream.service`)
```ini
[Unit]
Description=Litestream SQLite WAL Replication Daemon
After=network.target editor.service

[Service]
Type=simple
User=ubuntu
Group=ubuntu
EnvironmentFile=/var/www/editor/.env
ExecStart=/usr/local/bin/litestream replicate -config /etc/litestream.yml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 6.4 Litestream Config (`/etc/litestream.yml`)
```yaml
dbs:
  - path: /var/www/editor/data/editor.db
    sync-interval: 1s
    retention: 72h
    snapshot-interval: 1h
    replicas:
      - type: s3
        bucket: your-oracle-bucket-name
        path: db
        endpoint: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
        access-key-id: ${OCI_ACCESS_KEY_ID}
        secret-access-key: ${OCI_SECRET_ACCESS_KEY}
```

---

## 7. Deployment Instructions & Integration Verification Tests

### 7.1 Deployment Commands & Build Gate
```bash
# 1. Generate SRI Hash for Vendored HTMX
export HTMX_SRI_HASH="sha384-$(openssl dgst -sha384 -binary static/js/htmx.min.js | openssl base64 -A)"

# 2. Build Gate Check (Validates prosePluginsCtx exports & types)
bunx tsc --noEmit

# 3. Generate Drizzle Migration SQL Files Prior to First Boot
bunx drizzle-kit generate
```

### 7.2 Integration & Security Smoke Tests (`tests/api.test.ts`)
```typescript
import { expect, test, describe, afterEach } from 'vitest'

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000'

describe('Typst PDF Compilation & Security Endpoints', () => {
  const uuid = crypto.randomUUID()
  const sandboxDir = `/tmp/typst-test-${uuid}`
  const tmpFile = `${sandboxDir}/test.typ`
  const pdfFile = `${sandboxDir}/test.pdf`

  afterEach(async () => {
    await Bun.spawn(['rm', '-rf', sandboxDir]).exited
  })

  test('Compiles typst within isolated sandbox directory', async () => {
    await Bun.mkdir(sandboxDir, { recursive: true })
    await Bun.write(tmpFile, '= Sandboxed Test')

    const proc = Bun.spawn(['typst', 'compile', '--root', sandboxDir, tmpFile, pdfFile])
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(await Bun.file(pdfFile).exists()).toBe(true)
  })

  test('Rejects unauthorized PDF export requests with 401', async () => {
    const res = await fetch(`${SITE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Origin': SITE_URL }
    })
    expect(res.status).toBe(401)
  })

  test('Rejects missing CSRF origin header with 403', async () => {
    const res = await fetch(`${SITE_URL}/api/export/pdf`, {
      method: 'POST'
    })
    expect(res.status).toBe(403)
  })
})
```
