# Checkpoints (Manual Versioning) + Document Delete — Implementation Plan

> Revised per review: unified snapshot shape, transactional mutations, no
> sensitive payload leakage, strict validation, quota accounting, and explicit
> stale-save / last-document-delete UX.

## Objective

Add two self-contained document-management features, both additive and low-risk:

1. **Manual checkpoints** — the user explicitly saves up to 5 named snapshots of a
   document. No automatic versioning on autosave (this avoids the 5s-debounced
   save storm entirely). Plus one automatic "previous snapshot" slot so the last
   overwrite (title/format/content) is always recoverable.
2. **Delete own document** — a user can delete a document they own. Today only an
   admin delete endpoint exists (`server/api/admin/documents/[id].delete.ts`);
   there is no user-facing delete in the API or UI.

Both features touch the same storage layer (`documents` table, Turso/libSQL via
Drizzle) and the same central save endpoint (`PUT /documents/[id]`).

## Final implementation rules

- Add a monotonic `revision INTEGER NOT NULL DEFAULT 0` column to `documents` and
  the Drizzle schema. Every changed PUT, restore, and checkpoint create/delete
  request carries `baseRevision`; writes require a matching revision and then
  increment it. Do not rely on `Date.now()` as the concurrency token because
  writes can share the same millisecond.
- A PUT whose title, content, and format are already identical is a safe no-op
  and may succeed before the revision check. This makes a retried autosave
  idempotent. A changed stale PUT returns `409`.
- Checkpoint creation checks `clientRequestId` before enforcing `baseRevision`;
  a committed retry returns the existing checkpoint even if its base revision is
  now stale. Legacy checkpoints may omit `clientRequestId`; new checkpoints must
  include it.
- Checkpoint creation retries transient transaction conflicts with bounded
  backoff. The retry must not duplicate a checkpoint.
- `hasPrevious` is derived from the validated parsed snapshot, never solely from
  whether the database column is non-null.
- Existing `previous_snapshot` must be validated before PUT or restore replaces
  it. GET may degrade malformed values to `null`, but mutations refuse them.
- The last-document delete path uses an explicit empty state with a New document
  action; it does not auto-create a document.

## Design Decisions (agreed)

- **Manual only, no auto-versioning.** Checkpoints are created by an explicit user
  action, never by the autosave path.
- **Cap: 5 checkpoints per document.** When a 6th is created, the **oldest
  checkpoint is dropped (ring buffer)**.
- **One unified snapshot shape** used for both checkpoints and the auto undo slot
  (see Schema). This prevents metadata drift: a restore always restores
  title + content + format together.
- **In-row JSON storage** (no new table): `checkpoints TEXT` (array) and
  `previous_snapshot TEXT` (single snapshot or null).
- **Restore is a real save**: updates `updatedAt`, captures the current full
  snapshot into the undo slot, and the client reconciles all editor/preview/list
  state (and cancels pending autosave) so stale client state cannot overwrite the
  restored document.
- **Transactions for read-modify-write atomicity.** Transactions provide atomic
  read-modify-write behavior; separate **retry / idempotency / version** safeguards
  (below) handle conflicts, duplicate requests, and stale writes. Transactions alone
  do not solve request ordering or duplicate retries.
- **Mandatory revision token (optimistic concurrency).** Every `PUT` and restore
  request (and, for consistency, checkpoint create/delete which also write the row)
  must carry the `updatedAt` the client last loaded (or a monotonic `rev`). The
  server applies the write only if the stored row still matches that base
  (`UPDATE ... WHERE ... AND updatedAt = :base`); if zero rows match, return `409`
  stale and the client reloads the document. This is **mandatory** (not optional)
  because it prevents the cross-tab stale-write sequence: A reads v1, B reads v1, B
  writes v2, then A writes stale content afterward.
- **Hard delete** for document removal (matches existing admin delete).

## Schema

File: `server/db/schema.ts` and `server/utils/database.ts`
(`ensureSchema` raw SQL — the established migration path).

Add two columns to the `documents` table:

- `checkpoints TEXT` — JSON array of checkpoint entries:
  ```ts
  type Checkpoint = {
    id: string
    label: string
    title: string
    content: string
    format: 'markdown' | 'typst'
    savedAt: number
    clientRequestId: string   // idempotency key; REQUIRED for new checkpoints,
                              // OPTIONAL/tolerated on legacy entries read from
                              // before this feature shipped (see Backward compat)
  }
  ```
  Empty array `[]` when none.
- `previous_snapshot TEXT` — nullable JSON:
  ```ts
  type Snapshot = {
    title: string
    content: string
    format: 'markdown' | 'typst'
    savedAt: number
  }
  ```
  `null` when there is nothing to undo.

Apply via `ensureSchema` using the **same pattern** as the existing `format` /
`share_token` / `is_shared` columns:

1. Add both columns to the `CREATE TABLE IF NOT EXISTS documents (...)` statement
   (fresh DBs):
   - `checkpoints TEXT NOT NULL DEFAULT '[]'`
   - `previous_snapshot TEXT`  (nullable — `null` means nothing to undo)
2. Add two PRAGMA-guarded `ALTER TABLE documents ADD COLUMN ...` blocks (already
   deployed DBs, in place, non-fatal on error):
   - `ALTER TABLE documents ADD COLUMN checkpoints TEXT NOT NULL DEFAULT '[]'`
   - `ALTER TABLE documents ADD COLUMN previous_snapshot TEXT`
   These must run inside the existing `ensureSchema` try/catch so a failure does
   **not** permanently cache a broken schema — the current utility resets
   `schemaReady = null` on failure to retry on the next request. Preserve that
   behavior for the new statements. Additionally, a failed migration must **fail the
   current request** (throw / `500`) rather than let it proceed against a partially
   upgraded schema — the existing `ensureSchema` already does this by throwing once
   the statement loop records failures; preserve that.

**Defensive parsing:** although `checkpoints` is `NOT NULL DEFAULT '[]'`, rows
written by older deployments before this migration may still be `NULL`. The parser
must treat `NULL` / unparseable `checkpoints` as `[]`, and `NULL` / unparseable
`previous_snapshot` as `null`.

**Mandatory:** also add both columns to the Drizzle `documents` definition in
`server/db/schema.ts` (not optional). The endpoints reference them as
`documents.checkpoints` and `documents.previousSnapshot`, and the typed schema must
contain them or TypeScript/build will fail. Add:

```ts
checkpoints: text('checkpoints').notNull().default('[]'), // JSON array of Checkpoint
previousSnapshot: text('previous_snapshot')               // JSON Snapshot | null
```

(Column keys use camelCase; the string arg pins the physical column name to
`checkpoints` / `previous_snapshot` so the raw-SQL migration and Drizzle agree.)

### Malformed-data policy

- **Reads** (GET / list): a non-array / unparseable `checkpoints` degrades to `[]`;
  a non-object / unparseable `previous_snapshot` degrades to `null`. Safe, no throw.
- **Mutations** (create / delete / restore): a malformed `checkpoints` or
  `previous_snapshot` must **not** be silently overwritten. Log the corruption and
  return a controlled error (e.g. `422`/`500`). Reads degrade; writes refuse.

## Quota / size limits

> **Byte vs character lengths.** SQLite's `length(content)` counts **characters**,
> not UTF-8 bytes. For exact quotas, use a server-side helper everywhere:
> ```ts
> function byteLength(value: string): number {
>   return new TextEncoder().encode(value ?? '').byteLength
> }
> ```
> Apply `byteLength` (not `length`) to: document `content`, the `checkpoints` JSON
> string, the `previous_snapshot` JSON string, and `label` (if labels are
> byte-limited). Do not mix the two — if a character-based quota is ever preferred,
> state it explicitly; the default here is **byte-based**.

The storage quota in `PUT` currently sums `length(documents.content)` **in SQL**,
which counts characters. Correct this to a **byte-based** quota and move the
computation out of SQL:
- Select the relevant stored strings (or use the values being written) and compute
  `byteLength()` in JavaScript with `TextEncoder`; **do not leave the old SQL
  `sum(length(...))` aggregation in place** while describing the quota as byte-based.
- If a reliable DB byte-length function is available (e.g. SQLite
  `length(cast(column as blob))`), that is an acceptable alternative, but the result
  must be UTF-8 bytes, not characters.
Then add the explicit checkpoint + snapshot byte sizes per the replacement formulas
below, and enforce the caps:

- `MAX_LABEL_CHARS = 80` **and** `MAX_LABEL_BYTES = 320` — enforce **both** on input:
  reject if `label.length > 80` **or** `byteLength(label) > 320` (80 chars can span
  up to 320 UTF-8 bytes). Do not mix the two concepts into one ambiguous limit.
- Per-checkpoint content length guard (reject if a single checkpoint's content
  exceeds the document's tier quota — i.e. a checkpoint can never be larger than
  the doc itself would be allowed to be).
- **Count `byteLength(checkpoints) + byteLength(previous_snapshot)` toward the
  user's tier quota** (`TIER_STORAGE_BYTES`). This bounds total snapshot storage by
  construction and removes the false "5 small snapshots" assumption (a large
  SVG/HTML/Typst doc × 5 checkpoints + 1 previous can be very large).

**Replacement, not addition.** Quota projection must subtract the *old* row's
snapshot sizes, never merely add the new ones:

- **PUT** (both `content` and `previous_snapshot` may change size):
  ```
  projected = currentTotalUsage
            - byteLength(oldContent) - byteLength(oldPreviousSnapshot ?? '')
            + byteLength(newContent) + byteLength(newPreviousSnapshot ?? '')
  ```
  (For a brand-new document, `oldContent` / `oldPreviousSnapshot` are 0.)
- **Checkpoint creation** (only the `checkpoints` JSON blob changes size):
  ```
  projected = currentTotalUsage
            - byteLength(oldCheckpointsJson)
            + byteLength(newCheckpointsJson)
  ```
- **Restore / restore-previous** follow the same PUT-style replacement using the
  changed `content` + `previous_snapshot` sizes.

- The `PUT` and `POST .../checkpoints` handlers recompute projected usage including
  the snapshot columns (byte lengths) before writing.

## Endpoint Changes

All **read-modify-write** mutations run inside `db.transaction(async (tx) => { ... })`
so the read-modify-write is atomic. This covers: `PUT` (snapshot capture),
checkpoint create / delete, and both restore endpoints. **Document deletion is a
single `delete` statement and does not require a transaction** unless it is combined
with another mutation. All handlers verify `documents.ownerId === user.id` and
return `404` for not-found / not-owned (same safe response as today).

**Transaction retry / conflict handling (chosen approach: bounded retry).** A
transaction guarantees atomicity but does **not** automatically retry after a
transient conflict (e.g. `SQLITE_BUSY` / serialization failure, possible with
concurrent tabs). The implementation must:
- wrap each read-modify-write transaction in a **bounded retry** loop — retry only
  on transient busy/conflict errors, with **exponential backoff** and a **maximum
  attempt count** (e.g. 3–5 attempts);
- treat any non-transient error as a hard failure (no retry);
- combined with the `clientRequestId` idempotency key (above) so a retried request
  that already committed does not create a duplicate checkpoint.
Alternatives considered (acceptable if preferred): an optimistic version column, an
atomic conditional `UPDATE`, or returning a retryable `409`/`423`. But the default
implementation choice is **bounded retry + idempotency key**.
The concurrency test must reflect this: two simultaneous checkpoint creations both
eventually persist (retries absorb `SQLITE_BUSY`), or one gets a retryable error
that the test re-issues with the same `clientRequestId` and succeeds without
duplication.

**Structural validation, not just JSON syntax.** Valid JSON is not necessarily a
valid snapshot. `parseCheckpoints` / `parseSnapshot` must verify shape:
`title` is a string, `content` is a string, `format` is `'markdown' | 'typst'`,
`savedAt` is a finite number (same for each checkpoint entry). A parseable but
structurally invalid value is treated exactly like malformed JSON: **degrade on
read** (`[]` / `null`), **refuse on write** (log + `422`). Validate the size of each
**individual field** (`label`, `title`, `content`, `format`, `savedAt`) **before**
constructing the JSON entry — so oversized input yields a predictable `400`/`413`
and the server never builds an unnecessarily large blob.

### `PUT /documents/[id]` (existing — `server/api/documents/[id].put.ts`)

Inside a transaction:
1. Select current row (`content`, `title`, `format`, `updatedAt`).
2. **Revision check:** the request carries `baseUpdatedAt`. If
   `currentRow.updatedAt !== baseUpdatedAt`, return `409` (stale write) — the client
   must reload before saving. (Applies even to the no-op/identical case below.)
3. If content/title/format are **identical** to the stored values (e.g. a retried
   autosave that already committed), treat the request as a **no-op**: do **not**
   capture `previous_snapshot` and do **not** rewrite the row. This makes autosave
   retries idempotent and prevents a duplicate retry from overwriting the undo slot
   with the same data.
4. Otherwise, if `existingDoc` present and **any** of content/title/format differs:
   - **Validate the existing `previous_snapshot`** with `parseSnapshot(existingPrevious,
     { mode: 'write' })`. If it is present but malformed/invalid, refuse with `422`
     (do **not** silently destroy/replace a corrupt-but-present snapshot);
   - then set `previous_snapshot = { title: old.title, content: old.content,
     format: old.format, savedAt: old.updatedAt }` — capturing the *full* prior
     state, not just content.
5. `update(...).set({ title, content, format, previous_snapshot, updatedAt })`
   where `documents.id = id AND documents.ownerId = user.id AND documents.updatedAt = baseUpdatedAt`
   (use `and(...)` — see Ownership-query note). If zero rows were affected (revision
   moved between select and update), return `409` stale.
6. **Do not** touch `checkpoints` — checkpoints are manual only.
7. Recompute quota including `checkpoints` + `previous_snapshot` lengths (byte
   lengths, JS-computed — see Quota section).

**Autosave retry semantics:** a failed autosave may be retried by the client. The
no-op rule above means a retried request carrying unchanged content does not create
a new `previous_snapshot`, so previous-save semantics stay reliable. For stronger
guarantees (e.g. guarding against a retry whose payload genuinely differs), pair
this with a client/server **revision token** (a monotonic `rev` or the current
`updatedAt`) sent on every save; the server rejects a save whose token is older than
the stored row, and the client refreshes its token after each successful save.

Returned row: include `hasPrevious` derived from the **parsed** snapshot (see GET
note) and lightweight `checkpoints` **metadata** (see GET), but **never**
`previous_snapshot` content.

### `GET /documents/[id]` (existing — `server/api/documents/[id].get.ts`)

- Select `checkpoints` and the raw `previous_snapshot` string.
- Return **metadata only** for checkpoints:
  `{ id, label, title, format, savedAt, size }[]` (size = byte length of `content`).
  Do **not** return full `content` or `previous_snapshot` over the wire.
- `hasPrevious: boolean` is derived from the **parsed** snapshot, not the raw SQL
  null check — the column may hold malformed JSON that SQL sees as non-null while the
  parser treats as `null`:
  ```ts
  const previous = parseSnapshot(rawPrevious, { mode: 'read' })
  const hasPrevious = previous !== null
  ```

**Response privacy:** list/GET endpoints return **metadata only** — never full
checkpoint `content`. The restore endpoints (`.../checkpoints/[cid]/restore`,
`.../restore-previous`) are exempt: they return the **resulting live document**
(`content` / `title` / `format`) because the client must display it after restore.
Checkpoint *payloads* (the stored `content` of each saved checkpoint) are never
returned as a list — only per-checkpoint metadata.

### `POST /documents/[id]/checkpoints`

- Validate body: `label` must be a `string` (coerce missing → `''`; reject
  non-string/object; enforce both `MAX_LABEL_CHARS` and `MAX_LABEL_BYTES`). Require
  `clientRequestId` (string, UUID-shaped); reject if missing/invalid.
- Transaction (with bounded retry — see conflict strategy):
  1. Select current `content`/`title`/`format` + existing `checkpoints` JSON.
  2. If `checkpoints` is malformed → log + `422` (do not overwrite).
  3. **Idempotency:** if a checkpoint with the same `clientRequestId` already exists
     for this document, return it (do not create a duplicate). This makes a retried
     request safe when the first committed but its response was lost.
     **Backward compatibility:** checkpoints created *before* this feature will not
     contain `clientRequestId`. On **read**, tolerate a missing `clientRequestId`
     (treat legacy entries as valid, never reject them for the absence); only
      **create** paths assign and require it. Do **not** retroactively invalidate or
      discard legacy checkpoint data.
      **Retention limit:** the idempotency key lives *inside* the checkpoint, so once
      the ring buffer drops that checkpoint (cap 5), a delayed retry carrying the same
      `clientRequestId` can create a duplicate. This is **acceptable** for this feature
      (the window is small and bounded by 5). If strict idempotency beyond the
      retained checkpoints is ever required, use a separate request-ledger table
      keyed by `clientRequestId` instead of storing the key only in the checkpoint.
  4. Validate field sizes **before** building JSON (see Validation): `label`,
     `title`, `content`, `format`, `savedAt`. Reject (`400`/`413`) on overflow.
  5. Build entry `{ id: crypto.randomUUID(), label, title, content, format,
     savedAt: Date.now(), clientRequestId }`.
  6. Push; if length > 5, `shift()` (drop oldest).
  7. Enforce per-checkpoint + total size against quota; reject (`413`) if exceeded.
  8. Write `checkpoints` JSON.
- Return updated metadata list.

### `DELETE /documents/[id]/checkpoints/[cid]`

- Validate `cid` is a non-empty string / UUID-shaped; reject otherwise.
- Transaction:
  1. Select `checkpoints`; if malformed → log + `422`.
  2. Find entry by `id`; if not found → `404`.
  3. Remove; write back. (No cap interaction — only frees room.)
- Return updated metadata list.

### `POST /documents/[id]/checkpoints/[cid]/restore`

- Validate `cid`. Request carries `baseUpdatedAt` (revision token).
- Transaction (restore is a normal save):
  1. Select current row + `checkpoints`; malformed checkpoints → `422`.
  2. Find entry; not found → `404`.
  3. If `currentRow.updatedAt !== baseUpdatedAt` → `409` stale (client reloads).
  4. **Validate the existing `previous_snapshot`** with `parseSnapshot(existing,
     { mode: 'write' })`; if present but malformed → `422` (do not silently destroy
     it).
  5. Set `previous_snapshot = { title: current.title, content: current.content,
     format: current.format, savedAt: current.updatedAt }` (undo safety — full
     current state).
  6. Apply (`.where(...)` is **outside** `.set(...)`):
     ```ts
     await tx
       .update(documents)
       .set({
         title: entry.title,
         content: entry.content,
         format: entry.format,
         previousSnapshot: snapshotJson,
         updatedAt: Date.now()
       })
       .where(and(
         eq(documents.id, id),
         eq(documents.ownerId, user.id),
         eq(documents.updatedAt, baseUpdatedAt)
       ))
     ```
     If zero rows affected → `409` stale.
- **Checkpoint immutability:** the restored checkpoint is **not** removed or
  modified — it remains in the list as an immutable snapshot. Restore only reads it
  and writes the document's live fields.
- **Retrieval strategy:** the client **never downloads checkpoint payloads**. The
  server selects the document row, finds the chosen checkpoint entry inside the
  `checkpoints` JSON, and applies its `content` / `title` / `format`. The restore
  response returns **only the resulting live document** (see Response privacy),
  never the list of checkpoint payloads.
- Client treats the response like a document load (see Client UX).

### `POST /documents/[id]/restore-previous`

- Request carries `baseUpdatedAt` (revision token).
- Transaction:
  1. Select current row + `previous_snapshot`.
  2. If `previous_snapshot` is null → `409` "Nothing to undo".
  3. If `currentRow.updatedAt !== baseUpdatedAt` → `409` stale (client reloads).
  4. **Validate the existing `previous_snapshot`** with `parseSnapshot(existing,
     { mode: 'write' })`; if present but malformed → `422` (do not silently destroy
     it).
  5. Swap (`.where(...)` outside `.set(...)`):
     ```ts
     await tx
       .update(documents)
       .set({
         title: prev.title,
         content: prev.content,
         format: prev.format,
         previousSnapshot: JSON.stringify({
           title: current.title,
           content: current.content,
           format: current.format,
           savedAt: current.updatedAt
         }),
          updatedAt: Date.now()
        })
        .where(and(
          eq(documents.id, id),
          eq(documents.ownerId, user.id),
          eq(documents.updatedAt, baseUpdatedAt)
        ))
      ```
  If zero rows affected → `409` stale.
- Checkpoints are untouched by this operation.
- Client treats like a document load.

### `DELETE /documents/[id]` (user-owned delete)

- **Ownership-query note:** Drizzle requires `and(...)`, not comma args:
  ```ts
  await db.delete(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
  ```
  (The originally proposed `.where(eq(a), eq(b))` is invalid — confirmed against
  the existing `PUT`/`GET` handlers which use `and(eq(...), eq(...))`.)
- Hard delete removes the row (and its `checkpoints`/`previous_snapshot`); any
  `share_token` is gone → public share returns `404` automatically.
- Return `{ ok: true, id }`. Keep `admin/documents/[id].delete.ts` unchanged.

## Client UX (`app/components/editor/EditorWorkspace.client.vue`)

1. **Save checkpoint** — action in the document menu/toolbar → optional label prompt
   → `POST .../checkpoints` → refresh checkpoint list (metadata).
2. **Checkpoints panel** (drawer/modal) — list up to 5 with timestamp + label; each
   has **Restore** and **Delete**. Plus a **"Restore previous save"** button enabled
   only when `hasPrevious` is true. Restoring triggers the endpoint, then a full
   document reload (see below).
3. **Delete document** — action in document menu → mandatory confirmation modal →
   `DELETE /documents/[id]`.
4. **Restore = document load, with in-flight save reconciliation.** Restoring
   must not be defeated by an autosave request already on the wire. Use a
   generation/token guard:
  - Declare `let saveGeneration = 0` **alongside `saveTimer`, `pendingMarkdown`, and
    `activeSave`** (same component scope). Every save request (`saveDocument` /
    `flushSaveQueue`) must **capture its generation at issuance** (e.g.
    `const gen = saveGeneration`) and only apply/close over its result if
    `saveGeneration === gen` when the response returns.
  - Before any restore/delete: `await activeSave` (settle any in-flight save
    promise) so the server has applied it; then `saveGeneration++`; then
    `clearTimeout(saveTimer.value)`, `pendingMarkdown.value = null`.
  - In `flushSaveQueue`/`saveDocument`, capture the generation at issuance and
    **skip applying/closing over stale results** if `saveGeneration` changed before
    the response is processed (a late-completing request must not overwrite the
    restored document).
  - Only after the in-flight save has **settled** (awaited) and the generation is
    bumped, call the restore endpoint, then load the response: set `markdown.value`,
    `title`, `format`, `currentDocId`, refresh preview (`refreshPreview()`), refresh
    the document list, and update `hasPrevious` / checkpoint list.
  - Because the in-flight autosave is awaited **before** the restore is issued, the
    server applies A *before* B — the old autosave request completes **before**
    the restore begins, so the final document is B. The `saveGeneration` token
    still guards against stale *client-side* callbacks, but note it cannot stop a
    network request that has already reached the server after the restore — which
    is why awaiting `activeSave` first is the load-bearing safeguard.

5. **Empty-label behavior.** A missing/empty label is stored as the exact empty
    string (`''`) — the server assigns **no** default. The UI displays
    **"Unnamed checkpoint"** only when the stored label is `''`; if the user typed a
    label, it is shown verbatim.
6. **Deleting the last document — explicit path.** After a successful delete:
    - clear `currentDocId`, `pendingMarkdown`, `saveTimer`, checkpoint UI state, and
      share state; blank the editor content;
    - refetch the document list;
  - if no documents remain, show an **empty state** with a "New document" button
       (do **not** auto-create one). Never leave a dangling deleted `currentDocId`.
7. All new UI must respect the existing `isPublicMode.value` guards (no save/share
   in public mode).

## Implementation Sequence

1. **Schema**: add `checkpoints` + `previous_snapshot` to `ensureSchema` (CREATE +
   PRAGMA ALTER) **and** to the Drizzle `documents` definition in `schema.ts`
   (mandatory — endpoints reference `documents.checkpoints` / `documents.previousSnapshot`).
2. **Shared snapshot util** (`server/utils/snapshots.ts`): define the `Snapshot`
   and `Checkpoint` types **once** plus validators and parsers —
   `validateLabel`, `validateSnapshot`, `validateCheckpoint`, `parseCheckpoints`
   (degrade on read / throw on write), `parseSnapshot` (same contract), and
   size-limit constants. Every endpoint imports from here so JSON parsing, shape
   validation, and metadata projection stay consistent (no duplicated interfaces).
3. **PUT**: transactional full-snapshot capture + quota including snapshots.
4. **GET**: return `hasPrevious` + lightweight checkpoint metadata only.
5. **Endpoints**: `POST/DELETE/restore .../checkpoints`, `POST .../restore-previous`,
   `DELETE /documents/[id]` (with `and(...)` ownership).
6. **Client**: checkpoint button, panel, restore = load, delete + confirm, last-doc
   empty state.
7. **Tests** (below).
8. **Manual pass**: save checkpoint, restore (title+content+format), delete
   checkpoint at cap, restore-previous after an edit, delete document + list
   updates, public share 404 after delete, concurrent-tab behavior.

## Test Plan (vitest, reusing the added setup)

- **Pure helpers**: `pushCheckpoint(list, entry, max=5)` cap/ring-buffer;
  `parseCheckpoints` (read → `[]`, write → throw) contract; `byteLength` returns
  UTF-8 bytes (verify a multibyte string differs from `length()`).

- **Schema migration (`ensureSchema`)** — because migrations are raw SQL, not
  generated:
  - fresh database: both columns created;
  - existing database missing **both** `checkpoints` and `previous_snapshot`:
    PRAGMA-guarded `ALTER` adds them;
  - existing database with **only one** of the two columns: the missing one is
    added without error;
  - `ensureSchema()` called **repeatedly**: idempotent, no error, columns persist;
  - **existing NULL rows:** a row with `checkpoints = NULL` and
    `previous_snapshot = NULL` (from before this feature) — confirm `GET` returns
    `checkpoints: []` and `hasPrevious: false`, and that a mutation against it
    follows the declared corruption policy (reads degrade, writes refuse on
    malformed). This guards the defensive-NULL-parse path.
  - migration failure path: a forced statement failure is surfaced (does not
    silently leave the schema half-applied).
  Use a throwaway libSQL file (or `:memory:`) per test case. **Isolated state:**
  `server/utils/database.ts` caches `dbInstance` and `schemaReady` at module scope,
  so tests must reset those singletons between cases (`dbInstance = null`,
  `schemaReady = null`) or load the module in an isolated context
  (`vi.resetModules()` + dynamic `import()`) so one test's initialized database
  cannot leak into another.

- **PUT transactions**:
  - title-only update still captures `previous_snapshot` with old title+content+format;
  - format-only update captured;
  - `hasPrevious` reflected; `previous_snapshot` content **not** in GET payload;
  - quota rejects (byte-based) when checkpoints + previous push usage over tier limit.

- **Concurrency / stale-save**:
  - two `POST .../checkpoints` requests in flight both persist (no lost update) —
    reflecting the chosen conflict strategy: either both succeed after bounded
    retry on `SQLITE_BUSY`, or one receives a retryable `409`/`423` that the test
    re-issues and then succeeds;
  - **precise race sequence**: edit A → autosave request starts (in flight) →
    **wait for the autosave to settle** → restore checkpoint B → assert the final
    document content is **B** (not A). The generation token still guards stale
    client-side callbacks, but it cannot stop a request already at the server after
    restore — awaiting `activeSave` first is the load-bearing safeguard (Client UX §4).
  - restore followed by a pending autosave timer: client cancels it so restored
    content survives.
  - **stale PUT across tabs (revision token):** `PUT A` and `PUT B` are issued with
    the **same** `baseUpdatedAt`; the first commits (advancing `updatedAt`), the
    second receives `409` stale (zero rows matched by the `updatedAt` guard). The
    client must then reload before retrying. This is required to claim protection
    against cross-tab stale writes.

- **Validation**:
  - `label` as object / number rejected;
  - oversized label rejected (both `MAX_LABEL_CHARS` and `MAX_LABEL_BYTES` enforced,
    including a multibyte string that fits 80 chars but exceeds 320 bytes);
  - malformed checkpoints JSON → `422` on mutation, `[]` on read;
  - **structurally invalid but valid JSON** (e.g. `format: 'pdf'`, missing
    `content`, non-finite `savedAt`) → treated as malformed: `[]` on read, `422` on
    write;
  - oversized checkpoint content → `413`.
  - **empty label**: missing label stored as `''`; GET metadata label is `''`
    (server assigns no default; "Unnamed checkpoint" is UI-only).

- **Quota replacement arithmetic**:
  - document already has a `previous_snapshot`; a new save replaces it with a
    **smaller** snapshot → projected quota **decreases** correctly;
  - replacing it with a **larger** snapshot → quota **increases**;
  - checkpoint creation replaces the `checkpoints` JSON blob → quota changes by the
    delta of old vs new JSON size, not by adding the new size.

- **Restore correctness**:
  - content/title/format restore returns all three; current state moved to undo slot;
  - **restored checkpoint remains in the list unchanged** (immutable);
  - restore-previous when none → `409`.

- **Delete**:
  - owner delete removes row; non-owner → `404` (same safe response as not found);
  - deleting the last document → client clears state and shows empty state.

- **Regression**: autosave (`PUT`) never creates/modifies `checkpoints`.

## Risks and Safeguards

- **Concurrent writes (server)**: all mutations run in `db.transaction`, and every
  write is guarded by a **mandatory `updatedAt` revision token** (`UPDATE ... WHERE
  ... AND updatedAt = :base`; zero rows → `409` stale). Transactions give atomicity;
  the revision token prevents cross-tab stale writes. (Idempotency for checkpoint
  creation additionally uses `clientRequestId`; note its retention is bounded by the
  5-checkpoint ring buffer — acceptable, documented above.)
- **Concurrent writes (client)**: an in-flight autosave is not cancelled by nulling
  a local reference. Use the `saveGeneration` token + `await activeSave` before
  restore/delete (Client UX §4) so a late-completing request cannot overwrite the
  restored document.
- **Irreversible delete**: confirmation modal mandatory; consider undo-grace only if
  desired (out of scope).
- **Storage growth**: bounded by counting snapshot bytes toward the tier quota +
  per-checkpoint size guard.
- **Payload leakage**: `previous_snapshot` and full checkpoint `content` never
  returned by GET; only `hasPrevious` + metadata.
- **Corruption**: reads degrade, writes refuse (log + error) — never silently
  overwrite recoverable snapshots.
- **Admin vs owner delete**: owner delete narrowly scoped with `and(eq(id),
  eq(ownerId))`; admin delete unchanged.
- **Typst path**: unaffected — `format` stored on every snapshot, so restoring a
  Typst checkpoint restores the correct format.

## Out of Scope

- Auto-versioning / time-based snapshots.
- Per-block restore (storage model is whole-document only).
- Soft delete / trash folder (hard delete chosen).
- Diff viewer between checkpoints (could be added later client-side).
