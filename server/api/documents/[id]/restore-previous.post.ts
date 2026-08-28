import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { parseSnapshot } from '~~/server/utils/snapshots'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<{ baseRevision?: unknown }>(event)
  if (typeof body?.baseRevision !== 'number') throw createError({ statusCode: 400, statusMessage: 'Missing baseRevision' })
  const db = await useDatabase()
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1))[0]
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    if (current.revision !== body.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before restoring' })
    const previous = parseSnapshot(current.previousSnapshot, 'write')
    if (!previous) throw createError({ statusCode: 409, statusMessage: 'Nothing to undo' })
    const nextPrevious = JSON.stringify({ title: current.title, content: current.content, format: current.format, savedAt: current.updatedAt })
    const updated = await tx.update(documents).set({ title: previous.title, content: previous.content, format: previous.format, previousSnapshot: nextPrevious, updatedAt: Date.now(), revision: current.revision + 1 }).where(and(eq(documents.id, id), eq(documents.ownerId, user.id), eq(documents.revision, current.revision)))
    if (!updated.rowsAffected) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before restoring' })
    return { document: { id, title: previous.title, content: previous.content, format: previous.format, revision: current.revision + 1, updated_at: Date.now(), hasPrevious: true } }
  })
})
