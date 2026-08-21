# Implementation Plan: Typst-based PDF Export via Google Cloud Run

Status: **Planned** (not yet implemented)
Created: 2026-08-21

---

## 1. Goal

Add high-quality, print-grade PDF export to the markdown editor by letting users author
documents in **Typst** (`.typ`) and compiling them on a dedicated **Google Cloud Run**
service. Markdown documents keep their existing behavior (TipTap editor + client-side
`html2pdf.js` export).

### Why this design

| Decision | Rationale |
|---|---|
| Per-document format (`markdown` \| `typst`) | They are different source languages; no lossy md→typst conversion. User picks at creation. |
| No Pandoc, no Mermaid rendering on Cloud Run | Collapses the image to `Go` + `typst` CLI. Tiny image, fast cold start, low cost, fewer supply-chain deps. |
| Subdirectory `pdf-service/` on `main` + Cloud Build trigger | Auto-deploy on push to `main`, but path-filtered so frontend-only commits don't rebuild the image. Keeps normal PR/review flow and one source of truth. |
| Compile happens on Cloud Run, not the edge | Cloudflare Pages workers cannot run native binaries; typst-wasm in a worker would blow CPU limits. |
| Browser → Nuxt route → Cloud Run (server-to-server) | Shared secret never reaches the client; reuses Better Auth session checks; avoids CORS. |

---

## 2. Architecture

```
┌─────────────────────────── Browser ───────────────────────────┐
│  EditorWorkspace.vue                                          │
│  ├─ format === 'markdown' → TipTap editor → html2pdf.js (local)
│  └─ format === 'typst'    → .typ source editor               │
│                              └─ "Export PDF" → POST /api/export/pdf
└──────────────────────────────┬────────────────────────────────┘
                               │ (auth: Better Auth session cookie)
┌──────────────────────────────▼────────────────────────────────┐
│  Nuxt server (Cloudflare Pages worker)                        │
│  server/api/export/pdf.post.ts                                │
│  1. requireAuthenticatedUser()                                │
│  2. Load doc from Turso, verify owner + format === 'typst'    │
│  3. Forward raw .typ source to Cloud Run with x-api-key       │
│  4. Stream application/pdf back to browser                    │
└──────────────────────────────┬────────────────────────────────┘
                               │ HTTPS + shared secret (header)
┌──────────────────────────────▼────────────────────────────────┐
│  Cloud Run: pdf-service (Go)                                  │
│  POST /compile  { source } → application/pdf                  │
│  - verifies x-api-key                                         │
│  - enforces size limit + compile timeout                      │
│  - runs: typst compile input.typ output.pdf                   │
│  Deployed via Cloud Build trigger (path filter pdf-service/**)│
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Phase A — Cloud Run service (`pdf-service/`)

### 3.1 Directory layout (new)

```
pdf-service/
├── main.go              # HTTP server: auth, limits, typst invocation
├── go.mod
├── Dockerfile           # multi-stage: build Go binary → slim runtime + typst
├── cloudbuild.yaml      # used by the Cloud Build trigger
└── README.md            # local run + deploy notes
```

> Note: this directory is **excluded** from the Cloudflare Pages deploy (Pages builds
> the Nuxt app from repo root; ensure its build command/output ignores `pdf-service/`).

### 3.2 API contract (Cloud Run)

`POST /compile`

Request:
- Header: `x-api-key: <PDF_SERVICE_API_KEY>` (required)
- Header: `Content-Type: application/json`
- Body: `{ "source": "<raw .typ text>" }`
- Max body: **512 KB** (reject larger with `413`)

Response:
- Success: `200`, `Content-Type: application/pdf`, body = PDF bytes.
  - Response header `X-Pdf-Filename` may carry a suggested filename.
- Errors: JSON `{ "error": "..." }`
  - `401` missing/invalid api key
  - `400` empty or oversized source
  - `422` typst compile failure (body includes typst's stderr, truncated)
  - `408` compile exceeded timeout
  - `500` unexpected

Non-goals for v1: multi-file projects (`#import`/`#include`), fonts beyond typst's
embedded set, network access, package downloads (`--ignore-system-fonts` style
isolation is fine; network egress denied).

### 3.3 `main.go` (sketch)

```go
func main() {
    apiKey := os.Getenv("PDF_SERVICE_API_KEY") // required, fail fast if empty
    port := os.Getenv("PORT")                  // Cloud Run injects PORT=8080
    mux := http.NewServeMux()
    mux.HandleFunc("POST /compile", handleCompile(apiKey))
    log.Fatal(http.ListenAndServe(":"+port, mux))
}

// handleCompile:
//  1. constant-time compare of x-api-key
//  2. decode JSON, validate len(source) in [1, 512_000]
//  3. write source to temp dir: main.typ
//  4. exec.CommandContext(ctx, "typst", "compile", "main.typ", "out.pdf")
//     ctx with timeout (env COMPILE_TIMEOUT_SECS, default 20s)
//  5. on exit != 0 → 422 with truncated stderr
//  6. stream out.pdf back as application/pdf; delete temp dir (defer)
```

Hardening requirements:
- Timeout via `context.WithTimeout`; kill the typst process on expiry.
- Truncate compiler stderr before returning it (avoid leaking paths / huge payloads).
- No filesystem writes outside the request's temp dir; container runs with read-only
  root FS except `/tmp` (set in Cloud Run).
- No outbound network needed; deny egress via VPC connector/firewall if available,
  otherwise rely on typst not fetching anything (v1 has no `@preview` packages).

### 3.4 `Dockerfile` (multi-stage, pinned versions)

```dockerfile
# ---- build stage ----
FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/pdf-service .

# ---- runtime stage ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Pin a typst release; bump deliberately, not incidentally.
ARG TYPST_VERSION=0.13.1
ADD https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz /tmp/typst.tar.xz
RUN tar -xJf /tmp/typst.tar.xz -C /usr/local/bin --strip-components=1 \
        typst-x86_64-unknown-linux-musl/typst && rm /tmp/typst.tar.xz
COPY --from=build /out/pdf-service /usr/local/bin/pdf-service
ENV PORT=8080
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/pdf-service"]
```

Notes:
- musl static typst binary → no runtime libc issues on slim Debian.
- `USER 65532` (non-root), read-only root FS configured at the Cloud Run level.
- Image stays small (~100–150 MB) since there is no Node/Puppeteer/Pandoc.

### 3.5 `cloudbuild.yaml`

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/pdf-service/pdf-service:${SHORT_SHA}', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', '${_REGION}-docker.pkg.dev/${PROJECT_ID}/pdf-service/pdf-service:${SHORT_SHA}']
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'pdf-service'
      - '--image=${_REGION}-docker.pkg.dev/${PROJECT_ID}/pdf-service/pdf-service:${SHORT_SHA}'
      - '--region=${_REGION}'
      - '--set-secrets=PDF_SERVICE_API_KEY=pdf-service-api-key:latest'
      - '--memory=512Mi'
      - '--cpu=1'
      - '--timeout=60s'
      - '--max-instances=5'
      - '--no-allow-unauthenticated'
substitutions:
  _REGION: europe-west1   # pick region close to users/Turso
options:
  logging: CLOUD_LOGGING_ONLY
```

> `--no-allow-unauthenticated` + our own `x-api-key` gives two independent gates.
> Alternatively use `--allow-unauthenticated` and rely solely on the API key — decide
> during setup; keeping both is safer and costs nothing.

### 3.6 One-time GCP setup (console/gcloud checklist)

1. Enable APIs: Cloud Build, Cloud Run, Artifact Registry, Secret Manager.
2. Create Artifact Registry repo `pdf-service` (Docker) in the chosen region.
3. Create secret `pdf-service-api-key` in Secret Manager
   (`openssl rand -hex 32` value). Grant the **Cloud Run service account** access.
4. Create a **Cloud Build trigger**:
   - Event: Push to branch `main`
   - Source: this GitHub repo
   - Build config: `cloudbuild.yaml`, working dir `pdf-service/`
   - Path filter (included files): `pdf-service/**`
   - Service account: one with Cloud Run Admin + Artifact Registry Writer + Secret
     Accessor (create a dedicated SA rather than using the default compute SA).
5. First deploy creates the service; subsequent pushes to `main` touching
   `pdf-service/**` auto-deploy.
6. Record the service URL → becomes `NUXT_PDF_SERVICE_URL` in the Nuxt app.

---

## 4. Phase B — Nuxt app changes

### 4.1 Database: `format` column

**`server/db/schema.ts`** — extend `documents`:

```ts
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),          // markdown OR typst source
  format: text('format').notNull().default('markdown'), // NEW
  updatedAt: integer('updated_at', { mode: 'number' }).notNull()
})
```

**`server/utils/database.ts`** — two changes inside `ensureSchema()`:

1. New-table DDL gains the column:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'markdown',
  updated_at INTEGER NOT NULL
)
```

2. **Migration for existing databases** (the current `CREATE TABLE IF NOT EXISTS`
   will NOT add the column to already-deployed DBs). Append an idempotent step:

```ts
const cols = await database.all(sql.raw(`PRAGMA table_info(documents)`))
const hasFormat = (cols as any[]).some((c) => c.name === 'format')
if (!hasFormat) {
  await database.run(sql.raw(
    `ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'`
  ))
}
```

Backfill: existing rows get `'markdown'` automatically via the default — correct,
since all current documents are markdown.

### 4.2 Documents API

All three routes must round-trip `format`.

- **`server/api/documents/[id].put.ts`**
  - Extend `PutBody` with `format?: 'markdown' | 'typst'`.
  - Normalize: `const format = body?.format === 'typst' ? 'typst' : 'markdown'`.
  - On **insert**: store `format`.
  - On **update**: do **not** let the client silently flip format — either ignore the
    field on update, or accept it but only when explicitly sent *and* treat it as an
    intentional conversion (recommended v1: **immutable after creation**; ignore on
    update). Keep selecting `format` in the final row query.
- **`server/api/documents/[id].get.ts`** — add `format: documents.format` to the select.
- **`server/api/documents/index.get.ts`** — add `format` to the list select (sidebar may
  show a badge/icon per format).

Quota logic in `[id].put.ts` is unchanged — typst source lives in the same `content`
column and counts toward the same tier byte quota.

### 4.3 Server route: `server/api/export/pdf.post.ts` (new)

```ts
export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)          // Better Auth session
  const { documentId } = await readBody<{ documentId?: string }>(event)
  if (!documentId) throw createError({ statusCode: 400, statusMessage: 'Missing documentId' })

  const db = await useDatabase()
  const row = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, user.id)))
    .limit(1)
  const doc = row[0]
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  if (doc.format !== 'typst') {
    throw createError({ statusCode: 400, statusMessage: 'Document is not a Typst document' })
  }

  const config = useRuntimeConfig(event)
  if (!config.pdfServiceUrl || !config.pdfServiceKey) {
    throw createError({ statusCode: 500, statusMessage: 'PDF service is not configured' })
  }

  // Save-before-export: flush latest content first (client also does this).
  const upstream = await $fetch.raw(`${config.pdfServiceUrl}/compile`, {
    method: 'POST',
    headers: { 'x-api-key': config.pdfServiceKey },
    body: { source: doc.content },
    timeout: 45_000,
    retry: 0,
    ignoreResponseError: true
  })

  if (upstream.status !== 200 || !upstream.body) {
    const detail = typeof upstream._data === 'object'
      ? JSON.stringify(upstream._data).slice(0, 500)
      : ''
    throw createError({
      statusCode: upstream.status === 422 ? 422 : 502,
      statusMessage: upstream.status === 422 ? 'Typst compilation failed' : 'PDF service error',
      data: { detail }
    })
  }

  const safeTitle = (doc.title || 'document').replace(/[^\w\-. ]+/g, '').trim() || 'document'
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition',
    `attachment; filename="${encodeURIComponent(safeTitle)}.pdf"`)
  return sendStream(event, upstream.body)
})
```

Design notes:
- `422` surfaces typst errors to the UI ("compilation failed" + detail) vs `502` for
  infra problems.
- Filename sanitized; non-ASCII titles handled via `encodeURIComponent`.

#### Ownership & authorization (load-bearing — implement exactly as specified)

Ownership is verified **explicitly** in this route; nothing downstream does it for you.

1. **Session** — `requireAuthenticatedUser(event)` validates the Better Auth session
   cookie server-side and returns `{ id, tier }`. No valid session → `401` before any
   DB access happens.
2. **Owner filter** — the document is loaded with both conditions in a single query:

   ```ts
   .where(and(eq(documents.id, documentId), eq(documents.ownerId, user.id)))
   ```

   No row → `404` ("Document not found"). A signed-in user passing someone else's
   `documentId` never reaches the Cloud Run call. Return `404`, **not** `403`, so the
   existence of other users' documents is not leaked — consistent with the existing
   pattern in `[id].get.ts` / `[id].put.ts`.

Why each piece matters:

- **Cloud Run cannot check ownership.** It only sees `x-api-key`, which proves
  *"this request came from our Nuxt app"* — not *"this user owns this document"*.
  All user-level authorization must happen in this route.
- **Content must come from Turso, never from the request body.** Accepting a
  client-supplied `source` field would let any authenticated user compile arbitrary
  content through our API key (cost/abuse hole) and could desynchronize the exported
  PDF from the saved document. Reading from the DB makes ownership enforcement and
  export correctness the *same* mechanism. Unsaved edits are handled by the client
  flushing pending saves first (`flushSaveQueue()`) — **not** by posting content.

Implementation guardrails:

- Do not add a shortcut that accepts `content`/`source` directly "for unsaved changes".
- Keep the single-query owner filter; avoid a "fetch any doc, then compare owner in
  application code" shape that ever materializes another tenant's row.
- Keep `404` semantics for non-owned ids.

### 4.4 Runtime config & secrets

**`nuxt.config.ts`** — add to `runtimeConfig` (private):

```ts
pdfServiceUrl: process.env.NUXT_PDF_SERVICE_URL || '',
pdfServiceKey: process.env.NUXT_PDF_SERVICE_KEY || ''
```

**`.env.example` / `.env`** — append:

```bash
# Typst PDF service (Google Cloud Run)
# URL of the deployed Cloud Run service, e.g. https://pdf-service-xxxx.a.run.app
NUXT_PDF_SERVICE_URL=
# Shared secret; must equal PDF_SERVICE_API_KEY secret in GCP Secret Manager
NUXT_PDF_SERVICE_KEY=
```

**`scripts/deploy-secrets.ps1`** — add both keys to `$secretKeys` so they deploy to
Cloudflare in one go. Generate the key once with `openssl rand -hex 32` and put the
same value in GCP Secret Manager and `.env`.

### 4.5 Editor UI: dual-mode workspace

**`app/components/editor/EditorWorkspace.vue`**

State/type changes:
- `type DocItem` gains `format: 'markdown' | 'typst'`.
- New refs: `docFormat = ref<'markdown' | 'typst'>('markdown')`,
  `exportingPdf = ref(false)`, `typstError = ref('')`.
- `loadDocument()` sets `docFormat.value = response.document.format ?? 'markdown'`.
- `createDocumentAuthenticated()` accepts a format param; the PUT body includes it.
- `saveDocument()` unchanged (PUT ignores format server-side).

Rendering branches (template):
- `docFormat === 'markdown'` → exactly today's UI (TipTap + preview pane).
- `docFormat === 'typst'` → replace the TipTap pane with a plain monospace
  `<textarea>` (MVP) bound to the same `markdown` ref (it's just "content"):
  - Debounced autosave identical to markdown mode (reuse `scheduleSave`).
  - No `refreshPreview()` / mermaid / shiki work in this mode.
  - Toolbar shows only: title input, save state, **Export PDF**.
- "New document" gets a small picker (two buttons or dropdown):
  `New markdown doc` / `New Typst doc`. Format is fixed after creation (v1).

Export flow (typst mode):

```ts
async function exportTypstPdf() {
  exportingPdf.value = true; typstError.value = ''
  try {
    await flushSaveQueue()                       // ensure latest content is saved
    const res = await $fetch.raw('/api/export/pdf', {
      method: 'POST', body: { documentId: currentDocId.value },
      responseType: 'blob'
    })
    const url = URL.createObjectURL(res._data as Blob)
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `${title.value || 'document'}.pdf`
    })
    a.click(); URL.revokeObjectURL(url)
  } catch (e: any) {
    typstError.value = e?.data?.data?.detail
      ? `Compilation failed: ${e.data.data.detail}`
      : (e?.statusMessage || 'PDF export failed')
  } finally { exportingPdf.value = false }
}
```

- `canExportPdf` should require `currentDocId` in typst mode (public/unauthenticated
  users can't export typst — the route demands a session; markdown html2pdf export
  remains available in public mode as today).
- Show `typstError` inline near the button; disable button while `exportingPdf`.

Optional nicety (cheap): CodeMirror 6 for the `.typ` pane instead of `<textarea>`
(no official typst grammar; use a Rust-like/plain mode). Defer unless wanted.

### 4.6 Docs

- `app/pages/guide.vue`: add a short "Typst documents" section (choose Typst when
  creating a document, write `.typ`, hit Export PDF; link https://typst.app/docs).
- Landing page copy (`app/pages/index.vue` meta descriptions) optionally mentions
  "PDF export via Typst".

---

## 5. Security considerations

| Risk | Mitigation |
|---|---|
| Open PDF-compilation endpoint (cost abuse) | Two gates: Cloud Run `--no-allow-unauthenticated` (IAM) **and** shared `x-api-key`; plus Nuxt route requires a signed-in session. |
| Secret leakage | Key lives in GCP Secret Manager + Cloudflare encrypted env var. Never in repo/client. Browser only ever talks to `/api/export/pdf`. |
| Malicious/looping `.typ` | Compile timeout (default 20 s) + process kill; 512 KB source cap; Cloud Run `--memory 512Mi --cpu 1 --timeout 60s --max-instances 5` bounds blast radius. |
| Compiler stderr leakage | Truncate before returning; strip absolute paths if present. |
| Filesystem/network abuse | Non-root container user, read-only root FS, temp dir per request, no egress needed. |
| Cross-tenant doc access | Export route verifies the Better Auth session server-side, then loads the doc by `id + ownerId` in one query; `404` (not `403`) on miss; never trusts client-supplied content/`source`. See §4.3 "Ownership & authorization". |

---

## 6. Testing & verification

Phase A (local):
1. `cd pdf-service && docker build -t pdf-service .`
2. `docker run -p 8080:8080 -e PDF_SERVICE_API_KEY=test123 pdf-service`
3. `curl -s -H "x-api-key: test123" -H "content-type: application/json" \
    -d '{"source":"= Hello Typst"}' localhost:8080/compile -o out.pdf`
   → valid PDF opens; wrong key → 401; oversized body → 413; bad typst → 422.
4. Deploy via trigger push; verify revision appears in Cloud Run console.

Phase B (local dev):
1. Fresh DB: create markdown + typst docs; verify `format` persists across reload.
2. Existing DB (pre-migration): start app against old schema → confirm ALTER ran and
   old docs read as `markdown`.
3. Quota: typst content counts toward tier bytes (413 still enforced).
4. Export happy path: typst doc → PDF downloads with correct filename.
5. Export failures: invalid typst → friendly 422 message; unauthenticated → 401;
   other user's docId → 404; markdown docId → 400.
6. Public mode: typst export hidden/disabled; markdown export still works.
7. `npx nuxt build` green.

---

## 7. Rollout order

| Step | Task | Depends on |
|---|---|---|
| 1 | DB: `format` column + idempotent migration (schema.ts, database.ts) | — |
| 2 | Documents API round-trips `format` (put/get/index) | 1 |
| 3 | Editor: format picker at creation, typst source view, autosave reuse | 2 |
| 4 | `/api/export/pdf` route + runtimeConfig + `.env.example` + deploy script keys | 2 |
| 5 | `pdf-service/` (main.go, Dockerfile, cloudbuild.yaml, README) | contract from 4 |
| 6 | GCP setup: registries, secret, trigger; first deploy; capture URL | 5 |
| 7 | Set `NUXT_PDF_SERVICE_URL/KEY` in `.env` + Cloudflare prod secrets; E2E test | 6 |
| 8 | Guide page + copy updates | 3–4 |

Steps 1–4 are fully testable locally without GCP (route returns 502 until the service
URL exists). Steps 5–7 bring it live.

Rough effort: steps 1–4 ≈ half a day; step 5 ≈ half a day; steps 6–7 ≈ 1–2 h of
console work.

---

## 8. Future extensions (explicitly out of scope for v1)

- Multi-file Typst projects (`#import`/`#include`) — accept a zip or a file map.
- Custom fonts upload.
- In-browser live preview via typst-wasm (`@myriaddreamin/typst-ts-web`) — duplicates
  the compiler; revisit only if "Export to see result" proves too slow.
- Gate Typst export to the `paid` tier (one-line check in the export route using
  `user.tier`).
- Template gallery (starter `.typ` templates selectable at creation).
