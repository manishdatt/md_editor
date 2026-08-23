# Public Share Links for Markdown Documents

**Option B — Live Rendered Preview** · Status: implemented (2026-08-23, E2E-verified on Workers runtime) · Created: 2026-08-23 · Revised: 2026-08-23 (review fixes applied)

Anyone with a share URL can view the **rendered** document (same look as the logged-in
preview), updated live from the database, **without signing in**. The source markdown is
never shown in the UI.

> Known trade-off (accepted by product decision): because rendering happens in the
> browser, the raw content is technically retrievable by a determined user via devtools.
> This is *UI-level* hiding, not cryptographic secrecy. For true source-hiding, see
> "Future: Option A" at the bottom.

---

## 1. Current state (verified)

| Concern | Where | Notes |
|---|---|---|
| Documents table | `server/db/schema.ts` (`documents`) | `id, owner_id, title, content, format, updated_at` (`updated_at` is `integer mode: 'number'`) |
| Migrations | `server/utils/database.ts` → `ensureSchema()` | DDL statements + `PRAGMA table_info` + conditional `ALTER TABLE` pattern; failures are collected and the init is **retried on next request** (never cached-failed) |
| Owner-gated reads | `server/api/documents/[id].get.ts` | `requireAuthenticatedUser(event)` + `ownerId` filter; explicit column select list |
| Auth util | `server/utils/auth.ts` | `requireAuthenticatedUser` |
| **Preview pipeline** | `app/composables/useMarkdownRenderer.client.ts` | ⚠️ The logged-in preview is **NOT Tiptap** — it is `renderToHtml()` (marked + Shiki highlight + escaped raw HTML + emojify pass) injected via `v-html="previewHtml"` (see `EditorWorkspace.client.vue:868`), with `renderMermaidIn()` post-processing `.mermaid` nodes. Tiptap is only the editing pane. |
| Renderer details | same file | `renderer.html` escapes all raw HTML (XSS control); `renderer.code` routes ` ```mermaid ` to `<div class="mermaid">`, everything else through Shiki; mermaid initialized with `theme: 'neutral'` |
| Dialog/popover components | none exist in `app/components` | Share dialog must be built from scratch (or downgraded to an inline panel) — affects estimate |
| Field naming convention | `index.get.ts`, `[id].get.ts` | API responses use `updated_at` (snake_case) |
| Route guards | none | No `app/middleware/`; auth is enforced per-API server-side and per-component client-side |

## 2. Design overview

```
Owner (signed in)                     Public visitor
      │                                     │
      │ POST /api/documents/:id/share       │ GET /p/<token>
      ▼                                     ▼
 documents.share_token = <22-char token>   app/pages/p/[token].vue
 documents.is_shared  = 1                          │
      │                                            │ GET /api/public/doc/<token>
      └── share dialog shows                       ▼
          https://shbd.bioinfo.guru/p/<token>  returns { title, content, updated_at }
                                                    (only when is_shared = 1)
                                                    renders via useMarkdownRenderer()
```

- Token = bearer capability. 128-bit entropy, revocable, rotatable.
- Rendering reuses **`useMarkdownRenderer`** — the exact same pipeline that produces the
  logged-in preview (`v-html` output) — so Mermaid, code highlighting, tables, and emojis
  are identical by construction, with zero hand-synced extension list.
- Content stays **live**: every page load fetches current DB content. No cached snapshot.

## 3. Tasks

### Task 1 — Schema migration
**File:** `server/utils/database.ts` (extend `ensureSchema`), `server/db/schema.ts`

Add columns (fresh DBs get them from `CREATE TABLE IF NOT EXISTS`; existing DBs via the
existing PRAGMA-check → `ALTER TABLE` pattern). **Do NOT put `UNIQUE` in the column DDL** —
enforce uniqueness with one statement that works for both fresh and upgraded databases:

```sql
ALTER TABLE documents ADD COLUMN share_token TEXT            -- via PRAGMA guard
ALTER TABLE documents ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_share_token ON documents(share_token)
```

SQLite treats NULLs as distinct in unique indexes, so unshared rows (`share_token = NULL`)
never collide. The index is idempotent (`IF NOT EXISTS`); the ALTERs are guarded by
`PRAGMA table_info` checks, so re-runs are no-ops. Note: drizzle's `.unique()` in the
schema only affects drizzle-kit-generated migrations, not this runtime DDL — the index
above is the actual enforcement.

```ts
// server/db/schema.ts (documents table)
shareToken: text('share_token'),        // no .unique() — index lives in ensureSchema
isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false)
```

### Task 2 — Token generator
**New file:** `server/utils/share-token.ts`

Use **base64url** (not base62 — byte-level base62 needs bigint division and is easy to get
wrong; `btoa` is available on Cloudflare Workers):

```ts
export function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)) // 128-bit
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '') // 22 chars, URL-safe
}
```

### Task 3 — Share management API (authenticated)
**New file:** `server/api/documents/[id]/share.post.ts`

Request: `{ enabled: boolean, rotate?: boolean }` · Auth: `requireAuthenticatedUser` +
`ownerId` filter (same pattern as `[id].get.ts` — unknown/other-owner docs are 404,
never 403, to avoid existence leaks).

- Validate the body strictly (`enabled` must be boolean; `rotate` optional boolean);
  anything else → 400.
- Reject non-markdown docs with 400 (scope: markdown only).
- `enabled: true` → if `rotate` or no existing token, generate a new one (and on
  `SQLITE_CONSTRAINT` from the unique index, regenerate once — collision is
  astronomically unlikely but the retry is two lines); set `is_shared = 1`; return
  `{ url: '<siteUrl>/p/<token>', token, isShared: true }`.
- `enabled: false` → set `is_shared = 0`. Keep the token, so re-enabling restores the
  same URL ("Disable" in the UI). Rotating previously → old URLs die.
- `siteUrl` from runtime config (`public.siteUrl`), not from the request origin.

### Task 4 — Public read API (unauthenticated)
**New file:** `server/api/public/doc/[token].get.ts`

- Parameterized drizzle lookup: `where(and(eq(documents.shareToken, token), eq(documents.isShared, true)))`.
  No `ownerId` filter, no session, no `getAuth` call.
- Return **minimal payload only**: `{ title, content, updated_at }` — matching the
  internal snake_case convention. Never return `ownerId`, email, or account info.
- Unknown / disabled / revoked tokens → identical plain 404 (no state distinction).
- Headers:
  - `Cache-Control: no-store` (NOT `private, no-store` — the doc is public; the intent is
    "never cache anywhere" so revokes and edits propagate immediately)
  - `X-Robots-Tag: noindex, nofollow`
  - `X-Content-Type-Options: nosniff`
- Accepted cost: every view is one indexed Turso read (live content over caching).

### Task 5 — Public viewer page + renderer component
**New files:**
- `app/pages/p/[token].vue` — thin wrapper: reads `route.params.token`, sets
  `useSeoMeta({ robots: 'noindex, nofollow' })`, sets the tab `<title>` from the doc
  title, minimal standalone layout (no navbar/auth UI), renders `<SharedDocPreview>`.
- `app/components/public/SharedDocPreview.client.vue` — **reuse the logged-in preview
  pipeline exactly** (do NOT stand up a read-only Tiptap instance):

```ts
const { renderToHtml, renderMermaidIn } = useMarkdownRenderer()
previewHtml.value = await renderToHtml(doc.content)
await nextTick()
await renderMermaidIn(previewRef.value)
// template: <div ref="previewRef" class="preview-content prose ..." v-html="previewHtml" />
```

Rationale: the logged-in preview is marked-rendered HTML via `v-html`, not Tiptap — a
read-only editor would render emojis, tables, mermaid, and raw HTML *differently*, drag
in StarterKit/table node views/AI ghost text (weight + attack surface), and let raw HTML
through where the real preview escapes it. One shared pipeline = identical output
forever, less new code, smaller public bundle.

**Link hardening (required on this public anonymous surface):** override marked's
`renderer.link` for the shared renderer — force `target="_blank"
rel="noopener nofollow ugc"` and strip/deny `javascript:` and other non-http(s)
protocols. marked does not sanitize hrefs; owner-authored content becomes clickable on an
anonymous page. (Do not remove the existing `renderer.html = escapeHtml` escaping.)

States: loading skeleton, 404 ("This link is invalid or was revoked"), error.
Mermaid stays on the composable's `theme: 'neutral'` init — same as the editor, so
dark/light behavior matches automatically; don't "fix" it here.
A lightweight "Download PDF" button may reuse the html2pdf.js flow later (optional).

### Task 6 — Share UI in editor
**File:** `app/components/editor/EditorWorkspace.client.vue`

- Add a "Share" button next to the PDF export button, shown only when
  `isAuthenticatedMode && currentDocId && docFormat === 'markdown'`
  (anonymous/public-mode docs are not server-persisted — nothing to share; hide it
  there, not just disable).
- Toggle calls `POST /api/documents/:id/share`. On enable show a small popup with:
  full URL, Copy button, status line ("Anyone with the link can view"), and two distinct
  actions: **Disable** (`enabled: false` — link dies, re-enabling reuses the URL) and
  **Rotate** (`rotate: true` — new URL, old links die permanently).
- No dialog/popover component exists in the codebase — build a minimal one (absolute
  positioned tailwind panel) or use an inline toolbar panel; do not import a UI library
  for this.
- Reflect existing share state on load: add `shareToken`/`isShared` to the select lists
  in `index.get.ts` and `[id].get.ts` (internal, owner-gated endpoints only) so reopening
  a shared doc shows the active link.

### Task 7 — Hardening & polish
- Rate-limit/CAPTCHA out of scope initially (indexed token lookup is cheap; 128-bit
  tokens are not enumerable); revisit if abuse appears.
- Grep the public endpoint's select list before shipping: no `ownerId` or extra keys.
- Marked link hardening from Task 5 is a hard requirement, not polish (javascript:/data:
  protocols must not survive on a public page).
- Optional: `definePageMeta` layout choice for the public page.

## 4. Testing checklist

- [ ] Fresh DB: migration adds columns + unique index idempotently (run twice, no-ops)
- [ ] Existing DB (prod copy): ALTER path works via PRAGMA branch; index created
- [ ] Enable share → URL returned; incognito browser opens `/p/<token>` with rendered
      Mermaid + code highlighting **pixel-identical to the logged-in preview**
- [ ] Edit doc while share open → refresh shows new content (liveness)
- [ ] Disable → URL returns 404 immediately; re-enable → same URL works again
- [ ] Rotate → old URL 404, new URL 200
- [ ] Disabled/unshared/unknown tokens all return identical 404
- [ ] Malicious markdown renders inert: `<script>`, `<img onerror>`,
      `[x](javascript:alert(1))`; all doc links get `rel="noopener nofollow ugc"`
- [ ] `curl -i` public endpoint shows `no-store`, `X-Robots-Tag`, `nosniff`; body keys are
      exactly `{ title, content, updated_at }` (no `ownerId`)
- [ ] Signed-out user cannot call share POST (401), CAN view `/p/<token>` (200)
- [ ] Other user's doc id → share POST returns 404 (not 403)
- [ ] Bad body (`enabled: "yes"`) → 400
- [ ] Typst doc and **anonymous/unsaved doc** → share button hidden; direct POST → 400/404
- [ ] Two rapid reloads fetch fresh DB content (no edge caching on Cloudflare)

## 5. File change summary

| Action | Path |
|---|---|
| Modify | `server/utils/database.ts` (migration: columns + unique index) |
| Modify | `server/db/schema.ts` (columns) |
| Create | `server/utils/share-token.ts` (base64url generator) |
| Create | `server/api/documents/[id]/share.post.ts` |
| Create | `server/api/public/doc/[token].get.ts` |
| Create | `app/pages/p/[token].vue` |
| Create | `app/components/public/SharedDocPreview.client.vue` (uses `useMarkdownRenderer`) |
| Modify | `app/components/editor/EditorWorkspace.client.vue` (Share button + inline panel) |
| Modify | `server/api/documents/index.get.ts`, `[id].get.ts` (expose share flags internally) |

Estimated effort: ~half a day including testing (the `useMarkdownRenderer` reuse makes
the viewer cheaper than a Tiptap read-only mirror; building the share popup from scratch
partially offsets that).

## 6. Future: Option A (true source hiding, if ever needed)

Store compiled PDF bytes at share time (Typst service already exists; markdown would need
a server-side md→PDF path — e.g., extending the external compile service), serve them at
the same `/p/<token>` URL with `Content-Type: application/pdf`. The token/schema/API work
above carries over unchanged; only the response body changes.
