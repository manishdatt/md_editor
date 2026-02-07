import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const user = await requireAuthenticatedUser(event)
  const db = await useDatabase()
  const row = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  if (!row[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  return { document: row[0] }
})
