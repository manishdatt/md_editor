# Worker Bundle Size: Diagnosis and Resolution

**Date:** 2026-08-22
**Stack:** Nuxt 4 · Nitro (`cloudflare_pages` preset) · Cloudflare Pages
**Outcome:** Worker bundle reduced from **3.528 MiB gzip → 0.499 MiB gzip (−86%)**, back under the Cloudflare free-tier limit of 1 MiB compressed.

---

## Symptom

`nuxt build` produced a `dist/_worker.js` of **15.36 MiB raw / 3.65+ MiB gzip** across **828 files**, over the Cloudflare Workers/Pages Functions free-tier limit of 1 MiB compressed.

Nitro's build summary:

```
Σ Total size: 16.1 MB (3.66 MB gzip)
```

## Phase 1 — Disproving the initial hypothesis (auth/database graph)

Working theory was that Better Auth + drizzle + libsql formed a heavy dependency graph. Three controlled builds were measured (per-file gzip sum of everything under `dist/_worker.js`):

| Build variant | Raw | Gzip | Δ gzip |
|---|---|---|---|
| Baseline (HEAD, with auth) | 15.36 MiB | 3.528 MiB | — |
| Catch-all route `server/api/auth/[...].ts` disabled | 15.36 MiB | 3.528 MiB | −471 bytes |
| All better-auth removed (`server/utils/auth.ts` stubbed) | 14.53 MiB | 3.318 MiB | −0.21 MiB |

**Conclusions:**

1. Removing the catch-all route saved nothing. The route chunk itself is 171 B; better-auth stayed because `server/utils/auth.ts:4` imports `getAuth()` from `server/auth.ts`, and five other routes (documents ×3, pdf, ai) call `requireAuthenticatedUser`.
2. Even deleting *all* of better-auth recovers only ~0.21 MiB gzip → 3.32 MiB, nowhere near 2.x.
3. Composition analysis showed the real mass: **384 "editor vendor" chunks = 12.88 MiB raw / 2.78 MiB gzip = 92.4% of the worker**:

   | Group | Gzip | Biggest single chunks |
   |---|---|---|
   | Shiki grammars/themes/wasm (~330 files) | ~1.5 MiB | `wasm.mjs` 227 KiB, `emacs-lisp.mjs` 193 KiB, `cpp.mjs` 47 KiB |
   | Mermaid + cytoscape + katex (~40 files) | ~660 KiB | `mermaid.core` 159 KiB, `mermaid-parser.core` 146 KiB, `cytoscape.esm` 138 KiB |
   | TipTap core | ~66 KiB | `index-Cgeiy8c4.mjs` (232 kB raw) |

## Phase 2 — Root cause

Everything was statically reachable from the server-rendered module graph, so Nitro bundled it into `_worker.js` even though none of it executes on the server:

```
app/pages/index.vue                          ← static import (BEFORE)
└── EditorWorkspace.vue                      ← rendered during SSR
    ├── @tiptap/vue-3, markdown, starter-kit, pm-state
    ├── extensions/codeBlockShiki.ts → CodeBlockNodeView.vue ─┐
    ├── extensions/mermaidBlock.ts  → MermaidNodeView.vue    ─┤
    └── ~/composables/useMarkdownRenderer.client.ts          ─┘
        ├── import('shiki')    → 380+ grammar/theme/wasm chunks
        ├── import('marked')
        └── import('mermaid')  → core/parser/cytoscape/katex/diagram chunks
```

Two assumptions that do **not** protect against this:

1. **The `.client.ts` suffix on composables** only affects Nuxt auto-import registration — not bundling. Importing by explicit path drags them into whichever build imports them.
2. **`<ClientOnly>` inside the component** and TipTap's `immediatelyRender: false` don't matter. The *module itself* was in the SSR graph, so Rollup emitted every dynamic-import chunk into `_worker.js/chunks/_/`. Cloudflare counts **every file in the worker directory** toward the limit.

## Phase 3 — Resolution

Three structural edits broke the linkage between the server bundle and the editor subtree. No dependencies were removed and no feature code changed.

### 1. `EditorWorkspace.vue` → `EditorWorkspace.client.vue`

Renaming with the `.client` suffix makes Nuxt exclude the component from the server build entirely and registers it as a client-only auto-import.

### 2. `app/pages/index.vue`

Removed the static import; render via lazy auto-import inside `<ClientOnly>` with a skeleton fallback:

```vue
<ClientOnly>
  <LazyEditorWorkspace />
  <template #fallback>
    <!-- pulsing placeholder panels -->
  </template>
</ClientOnly>
```

### 3. `layouts/default.vue` → extracted auth UI

`useSession()` was being invoked in layout setup during SSR. Extracted all session UI (sign-in buttons / user chip / sign-out) into `app/components/auth/AuthButtons.client.vue`; the layout renders `<AuthButtons />`. This also dropped the better-auth *client* chunk from the worker.

### Result

| Metric | Before | After | Δ |
|---|---|---|---|
| Files in `_worker.js` | 828 | 66 | −92% |
| Raw | 15.36 MiB | 1.89 MiB | −88% |
| Gzip | 3.528 MiB | 0.499 MiB | **−86%** |

What remains in the worker is legitimate: Nitro runtime + Vue SSR renderer + h3, the API routes (documents / pdf / ai), libsql/drizzle, and the server-side better-auth graph (~0.2 MiB) that the catch-all route genuinely needs.

All shiki/mermaid/katex/tiptap code still ships — as CDN-cached static assets under `dist/_nuxt/` (~14 MB), never touching the worker.

UX impact: first paint shows the skeleton fallback instead of server-rendered editor chrome; identical after hydration.

---

## Bonus: pre-existing production bugs found while verifying

Both existed on `main` and were found by smoke-testing the built worker with `wrangler pages dev`.

### Bug 1 — Every HTML page returned HTTP 500 in production

`layouts/default.vue` called `authClient.useSession()` at setup time. During SSR, better-auth's client (`createAuthClient({ baseURL: '/api/auth' })` in `app/lib/auth-client.ts`) validates the relative base URL, cannot resolve it without `window`, and throws `BetterAuthError: Invalid base URL: /api/auth` — aborting the whole page render. Since `dist/_routes.json` routes `/*` to the function, **every page request 500-ed**.

Proven pre-existing: rebuilding pristine `HEAD` produced the identical 500.

**Fix:** change #3 above (session UI is now client-only).

### Bug 2 — `/api/auth/*` endpoints crashed with ReferenceError

`server/api/auth/[...].ts` called `auth.handler(...)` but never imported or defined `auth`:

```ts
// BEFORE — `auth` is undefined at runtime
export default defineEventHandler(async (event) => {
  const response = await auth.handler(toWebRequest(event))
  return sendWebResponse(event, response)
})
```

**Fix:**

```ts
export default defineEventHandler(async (event) => {
  const auth = await getAuth()
  const response = await auth.handler(toWebRequest(event))
  return sendWebResponse(event, response)
})
```

---

## How to verify

```bash
npm run build                     # watch "Σ Total size" line
npx wrangler pages dev dist       # serve locally
curl -s http://127.0.0.1:8788/ | head -c 400
```

Expected: home and `/guide` return HTTP 200, contain the skeleton fallback (`animate-pulse`) and header shell, plus `__NUXT_DATA__`; no `ProseMirror` markup in SSR output.

> **Gotcha:** if `wrangler pages dev` fails with *"There is a deploy configuration at .wrangler\deploy\config.json"*, temporarily rename that generated file aside and restore it afterwards.

## Rules to keep the worker small

1. Anything touching shiki / mermaid / katex / TipTap must live in `.client.vue` / `.client.ts` modules that are **not imported by explicit path from SSR-rendered files**.
2. Prefer Nuxt auto-imports (`LazyXxx`, `.client.vue`) over manual path imports for heavy components.
3. After adding any import reachable from `pages/` or `layouts/`, check the build's `Σ Total size` line — it should stay well under ~700 kB gzip.
