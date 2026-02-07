import { sql } from 'drizzle-orm'
import { db } from 'hub:db'

let schemaReady: Promise<void> | null = null

export function hubDatabase() {
  return db
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = hubDatabase()
      .run(sql.raw('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL)'))
      .then(() => undefined)
  }

  await schemaReady
}

export async function useDatabase() {
  await ensureSchema()
  return hubDatabase()
}
