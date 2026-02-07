import { desc, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)
  const db = await useDatabase()
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .where(eq(documents.ownerId, user.id))
    .orderBy(desc(documents.updatedAt))

  return {
    documents: rows,
    user: {
      id: user.id,
      tier: user.tier
    }
  }
})
