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
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || {}

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
      try {
        console.info('[auth-db] ensuring database schema')
        const database = getDb(event)

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
            updated_at INTEGER NOT NULL
          )`
        ]

        for (const statement of statements) {
          await database.run(sql.raw(statement))
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
          )).catch(() => {})
        }

        const documentColumns = await database.all(sql.raw(`PRAGMA table_info(documents)`)).catch(() => [])
        const hasFormat = Array.isArray(documentColumns) && documentColumns.some(
          (column: any) => column?.name === 'format'
        )

        if (!hasFormat) {
          await database.run(sql.raw(
            `ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'`
          )).catch(() => {})
        }

        console.info('[auth-db] database schema ready', {
          accountIssuer: hasIssuer || true,
          documentsFormat: hasFormat || true
        })
      } catch (err) {
        console.error('[auth-db] schema initialization failed; continuing with existing schema', err)
      }
    })()
  }

  await schemaReady
}

export async function useDatabase(event?: H3Event): Promise<LibSQLDatabase<typeof schema>> {
  await ensureSchema(event)
  return getDb(event)
}
