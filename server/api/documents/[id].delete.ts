import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const db = await useDatabase()
  const result = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
  if (!result.rowsAffected) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  return { ok: true, id }
})
