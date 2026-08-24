import { desc, eq, sql } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { user } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

// Recent documents across all accounts (metadata only — never content).
// Optional ?userId=<id> filters to one account; ?limit= caps rows (max 200).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await useDatabase()

  const query = getQuery(event)
  const userId = String(query.userId || '').trim()
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit || ''), 10) || 50, 1), 200)

  const owner = { name: user.name, email: user.email }

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      format: documents.format,
      isShared: documents.isShared,
      updatedAt: documents.updatedAt,
      bytes: sql<number>`length(${documents.content})`,
      ownerName: owner.name,
      ownerEmail: owner.email
    })
    .from(documents)
    .innerJoin(user, eq(user.id, documents.ownerId))
    .where(userId ? eq(documents.ownerId, userId) : undefined)
    .orderBy(desc(documents.updatedAt))
    .limit(limit)

  return {
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      format: row.format,
      isShared: Boolean(row.isShared),
      updatedAt: Number(row.updatedAt ?? 0),
      bytes: Number(row.bytes ?? 0),
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail
    }))
  }
})
