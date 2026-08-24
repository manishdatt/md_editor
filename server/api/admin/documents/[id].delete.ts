import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { documents } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await useDatabase()

  const id = String(getRouterParam(event, 'id') || '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing document id' })
  }

  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)
  if (existing.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  await db.delete(documents).where(eq(documents.id, id))

  return { ok: true, id }
})
