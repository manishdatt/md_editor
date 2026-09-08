import { createClient } from '@libsql/client/web'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import * as schema from '~~/server/db/schema'

let dbInstance: LibSQLDatabase<typeof schema> | null = null
let dbInstanceKey = ''
let schemaReady: Promise<void> | null = null

// Intermittent full-hang root cause (see tail: wallTime ~163s, cpuTime 3ms,
// logs [], outcome canceled): a single stalled Turso fetch never settles, so
// `await schemaReady` hangs forever and poisons the whole worker isolate.
// Every DB route (/p/:token SSR, sign-in/social, get-session) then hangs.
// Timeouts below turn the next stall into a fast 503 with a log line naming
// the exact statement, instead of a silent 30s+ browser timeout.
const STATEMENT_TIMEOUT_MS = 8000
const SCHEMA_TIMEOUT_MS = 20000
const SLOW_LOG_MS = 2000

function timeoutError(label: string, ms: number) {
  const err = new Error(`[auth-db] ${label} timed out after ${ms}ms (Turso stall?)`)
  ;(err as any).code = 'TURSO_TIMEOUT'
  return err
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, ms)), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function timedFetch(input: any, init?: any): Promise<Response> {
  const timeout = (init?.timeoutMs as number) || STATEMENT_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeout)
  return fetch(input, { ...init, signal })
}

function getConfig(event?: H3Event) {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const context = event?.context as any
  const cfEnv = {
    ...(context?.env || {}),
    ...(context?.cloudflare?.env || {})
  } as Record<string, string | undefined>

  let url = (config.tursoUrl as string) || cfEnv.TURSO_URL || process.env.TURSO_URL || ''
  const authToken = (config.tursoAuthToken as string) || cfEnv.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || ''

  if (!url || !authToken) {
    throw createError({
      statusCode: 500,
      statusMessage: 'TURSO_URL and TURSO_AUTH_TOKEN must be configured'
    })
  }

  if (url.startsWith('libsql://')) {
    url = url.replace(/^libsql:\/\//, 'https://')
  }

  return { url, authToken }
}

export function getDb(event?: H3Event): LibSQLDatabase<typeof schema> {
  const { url, authToken } = getConfig(event)
  // Key the cache so a rotated TURSO_* value (or preview vs production env
  // sharing an isolate) can't leave a poisoned client cached forever.
  const key = `${url}::${authToken.slice(0, 8)}:${authToken.length}`
  if (!dbInstance || dbInstanceKey !== key) {
    const client = createClient({ url, authToken, fetch: timedFetch } as any)
    dbInstance = drizzle(client, { schema })
    dbInstanceKey = key
  }

  return dbInstance
}

export async function ensureSchema(event?: H3Event) {
  if (!schemaReady) {
    console.log('[auth-db] schema init start (cold start)')
    schemaReady = (async () => {
      const database = getDb(event)

      const failures: string[] = []

      const statements = [
          `CREATE TABLE IF NOT EXISTS user (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            email_verified INTEGER NOT NULL DEFAULT 0,
            image TEXT,
            tier TEXT NOT NULL DEFAULT 'free',
            disabled_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS session (
            id TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            user_id TEXT NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS account (
            id TEXT PRIMARY KEY,
            issuer TEXT NOT NULL,
            account_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            access_token TEXT,
            refresh_token TEXT,
            id_token TEXT,
            access_token_expires_at INTEGER,
            refresh_token_expires_at INTEGER,
            scope TEXT,
            password TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`,
          `CREATE TABLE IF NOT EXISTS verification (
            id TEXT PRIMARY KEY,
            identifier TEXT NOT NULL,
            value TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER,
            updated_at INTEGER
          )`,
          `CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            format TEXT NOT NULL DEFAULT 'markdown',
            share_token TEXT,
            is_shared INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            checkpoints TEXT NOT NULL DEFAULT '[]',
            previous_snapshot TEXT,
            revision INTEGER NOT NULL DEFAULT 0
          )`,
          // Uniqueness for share tokens (NULLs are distinct in SQLite, so
          // unshared rows never collide). Idempotent for fresh and existing DBs.
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_share_token ON documents(share_token)`
        ]

      for (const statement of statements) {
        const label = `schema:${statement.slice(0, 40)}...`
        const started = Date.now()
        await withTimeout(
          database.run(sql.raw(statement)).catch((err) => {
            failures.push(`${statement.slice(0, 40)}... -> ${err?.message || String(err)}`)
          }),
          STATEMENT_TIMEOUT_MS,
          label
        ).catch((err) => {
          failures.push(`${label} -> ${err?.message || String(err)}`)
        }).finally(() => {
          const elapsed = Date.now() - started
          if (elapsed >= SLOW_LOG_MS) {
            console.warn(`[auth-db] slow statement ${elapsed}ms: ${statement.slice(0, 80)}`)
          }
        })
      }

      // PRAGMA/ALTER probes share the same stall risk as the CREATEs above:
      // without a timeout a single hung fetch poisons `schemaReady` forever.
      const safeAll = async (label: string): Promise<any[]> => {
        try {
          return await withTimeout(
            database.all(sql.raw(label === 'account' ? `PRAGMA table_info(account)` : label === 'documents' ? `PRAGMA table_info(documents)` : `PRAGMA table_info(user)`)),
            STATEMENT_TIMEOUT_MS,
            `pragma:${label}`
          ) as any[]
        } catch (err: any) {
          failures.push(`PRAGMA table_info(${label}) -> ${err?.message || String(err)}`)
          return []
        }
      }
      const safeRun = async (label: string, statement: string) => {
        const started = Date.now()
        try {
          await withTimeout(database.run(sql.raw(statement)), STATEMENT_TIMEOUT_MS, label)
        } catch (err: any) {
          failures.push(`${label} -> ${err?.message || String(err)}`)
        } finally {
          const elapsed = Date.now() - started
          if (elapsed >= SLOW_LOG_MS) {
            console.warn(`[auth-db] slow statement ${elapsed}ms: ${label}`)
          }
        }
      }

      // Better Auth 1.7+ requires issuer when resolving OAuth accounts. The
      // table may already exist from an older deployment, so upgrade it in
      // place instead of relying on CREATE TABLE IF NOT EXISTS.
      const accountColumns = await safeAll('account')
      const hasIssuer = Array.isArray(accountColumns) && accountColumns.some(
        (column: any) => column?.name === 'issuer'
      )

      if (!hasIssuer) {
        await safeRun('ALTER account issuer', `ALTER TABLE account ADD COLUMN issuer TEXT`)
      }

      const documentColumns = await safeAll('documents')
      const hasFormat = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'format'
      )

      if (!hasFormat) {
        await safeRun('ALTER documents format', `ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'`)
      }

      // Admin soft-ban column on user (null = active). Same PRAGMA-guarded
      // ALTER pattern for pre-existing deployments.
      const userColumns = await safeAll('user')
      const hasDisabledAt = Array.isArray(userColumns) && userColumns.some(
        (column: any) => column?.name === 'disabled_at'
      )

      if (!hasDisabledAt) {
        await safeRun('ALTER user disabled_at', `ALTER TABLE user ADD COLUMN disabled_at INTEGER`)
      }

      // Public share-link columns. Same PRAGMA-guarded ALTER pattern: existing
      // tables get the columns added in place, fresh tables already have them.
      const hasShareToken = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'share_token'
      )

      if (!hasShareToken) {
        await safeRun('ALTER documents share_token', `ALTER TABLE documents ADD COLUMN share_token TEXT`)
      }

      const hasIsShared = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'is_shared'
      )

      if (!hasIsShared) {
        await safeRun('ALTER documents is_shared', `ALTER TABLE documents ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`)
      }

      const currentDocumentColumns = await safeAll('documents')
      const documentColumnMigrations = [
        ['checkpoints', `ALTER TABLE documents ADD COLUMN checkpoints TEXT NOT NULL DEFAULT '[]'`],
        ['previous_snapshot', `ALTER TABLE documents ADD COLUMN previous_snapshot TEXT`],
        ['revision', `ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`]
      ] as const
      for (const [name, statement] of documentColumnMigrations) {
        if (!(currentDocumentColumns as any[]).some((column) => column?.name === name)) {
          await safeRun(`ALTER documents ${name}`, statement)
        }
      }

      if (failures.length > 0) {
        throw createError({
          statusCode: 500,
          statusMessage: `[auth-db] schema statements failed: ${failures.join(' | ')}`
        })
      }
    })().catch((err) => {
      // Do NOT cache a failed initialization - retry on the next request,
      // otherwise one transient cold-start failure breaks auth for the whole
      // lifetime of this worker isolate.
      console.error('[auth-db] schema initialization failed; will retry on next request', err)
      schemaReady = null
    })
  }

  // Overall guard: even with per-statement timeouts, never let the shared
  // promise hang an isolate forever. On timeout the catch below resets
  // schemaReady so the next request retries on a fresh isolate state.
  try {
    await withTimeout(schemaReady, SCHEMA_TIMEOUT_MS, 'schema-init')
  } catch (err: any) {
    console.error('[auth-db] schema initialization timed out or failed; will retry on next request', err?.message || String(err))
    schemaReady = null
    throw createError({
      statusCode: 503,
      statusMessage: err?.message || '[auth-db] database temporarily unavailable'
    })
  }
}

export async function useDatabase(event?: H3Event): Promise<LibSQLDatabase<typeof schema>> {
  await ensureSchema(event)
  return getDb(event)
}

// Fast non-hanging probe for /api/health/db: distinguishes credential/config
// errors (fast 4xx/5xx) from Turso stalls (503 after timeoutMs).
export async function pingDatabase(event?: H3Event, timeoutMs = STATEMENT_TIMEOUT_MS): Promise<{ ok: boolean, ms: number }> {
  const started = Date.now()
  const database = getDb(event)
  await withTimeout(database.run(sql.raw('SELECT 1')), timeoutMs, 'ping:SELECT 1')
  return { ok: true, ms: Date.now() - started }
}
