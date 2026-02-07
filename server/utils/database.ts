import { sql } from 'drizzle-orm'
import { db } from 'hub:db'

let schemaReady: Promise<void> | null = null

export function hubDatabase() {
  return db
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const database = hubDatabase()
      await database.run(sql.raw('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'))
      await database.run(sql.raw('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)'))

      try {
        await database.run(sql.raw("ALTER TABLE documents ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''"))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.toLowerCase().includes('duplicate column name')) {
          throw error
        }
      }
    })()
  }

  await schemaReady
}

export async function useDatabase() {
  await ensureSchema()
  return hubDatabase()
}
