import { desc, eq, sql } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { user } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await useDatabase()

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      tier: user.tier,
      emailVerified: user.emailVerified,
      disabledAt: user.disabledAt,
      createdAt: user.createdAt,
      documentCount: sql<number>`count(${documents.id})`,
      storageBytes: sql<number>`coalesce(sum(length(${documents.content})), 0)`,
      lastActivity: sql<number>`coalesce(max(${documents.updatedAt}), 0)`
    })
    .from(user)
    .leftJoin(documents, eq(documents.ownerId, user.id))
    .groupBy(user.id)
    .orderBy(desc(user.createdAt))

  return {
    users: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      tier: row.tier === 'paid' ? 'paid' : 'free',
      emailVerified: Boolean(row.emailVerified),
      disabledAt: row.disabledAt ? new Date(row.disabledAt).getTime() : null,
      createdAt: row.createdAt,
      documentCount: Number(row.documentCount ?? 0),
      storageBytes: Number(row.storageBytes ?? 0),
      lastActivity: Number(row.lastActivity ?? 0)
    }))
  }
})
