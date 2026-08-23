import { createClient } from '@libsql/client/web'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import * as schema from '~~/server/db/schema'

let dbInstance: LibSQLDatabase<typeof schema> | null = null
let schemaReady: Promise<void> | null = null

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
  if (!dbInstance) {
    const { url, authToken } = getConfig(event)
    const client = createClient({ url, authToken })
    dbInstance = drizzle(client, { schema })
  }

  return dbInstance
}

export async function ensureSchema(event?: H3Event) {
  if (!schemaReady) {
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
            updated_at INTEGER NOT NULL
          )`,
          // Uniqueness for share tokens (NULLs are distinct in SQLite, so
          // unshared rows never collide). Idempotent for fresh and existing DBs.
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_share_token ON documents(share_token)`
        ]

      for (const statement of statements) {
        await database.run(sql.raw(statement)).catch((err) => {
          failures.push(`${statement.slice(0, 40)}... -> ${err?.message || String(err)}`)
        })
      }

      // Better Auth 1.7+ requires issuer when resolving OAuth accounts. The
      // table may already exist from an older deployment, so upgrade it in
      // place instead of relying on CREATE TABLE IF NOT EXISTS.
      const accountColumns = await database.all(sql.raw(`PRAGMA table_info(account)`)).catch(() => [])
      const hasIssuer = Array.isArray(accountColumns) && accountColumns.some(
        (column: any) => column?.name === 'issuer'
      )

      if (!hasIssuer) {
        await database.run(sql.raw(
          `ALTER TABLE account ADD COLUMN issuer TEXT`
        )).catch((err) => {
          failures.push(`ALTER account issuer -> ${err?.message || String(err)}`)
        })
      }

      const documentColumns = await database.all(sql.raw(`PRAGMA table_info(documents)`)).catch(() => [])
      const hasFormat = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'format'
      )

      if (!hasFormat) {
        await database.run(sql.raw(
          `ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'`
        )).catch((err) => {
          failures.push(`ALTER documents format -> ${err?.message || String(err)}`)
        })
      }

      // Public share-link columns. Same PRAGMA-guarded ALTER pattern: existing
      // tables get the columns added in place, fresh tables already have them.
      const hasShareToken = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'share_token'
      )

      if (!hasShareToken) {
        await database.run(sql.raw(
          `ALTER TABLE documents ADD COLUMN share_token TEXT`
        )).catch((err) => {
          failures.push(`ALTER documents share_token -> ${err?.message || String(err)}`)
        })
      }

      const hasIsShared = Array.isArray(documentColumns) && documentColumns.some(
        (column: any) => column?.name === 'is_shared'
      )

      if (!hasIsShared) {
        await database.run(sql.raw(
          `ALTER TABLE documents ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`
        )).catch((err) => {
          failures.push(`ALTER documents is_shared -> ${err?.message || String(err)}`)
        })
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

  await schemaReady
}

export async function useDatabase(event?: H3Event): Promise<LibSQLDatabase<typeof schema>> {
  await ensureSchema(event)
  return getDb(event)
}
