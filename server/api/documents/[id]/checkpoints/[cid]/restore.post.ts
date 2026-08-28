import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { parseCheckpoints, parseSnapshot } from '~~/server/utils/snapshots'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id'); const cid = getRouterParam(event, 'cid')
  if (!id || !cid) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<{ baseRevision?: unknown }>(event)
  if (typeof body?.baseRevision !== 'number') throw createError({ statusCode: 400, statusMessage: 'Missing baseRevision' })
  const db = await useDatabase()
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1))[0]
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    if (current.revision !== body.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before restoring' })
    const checkpoints = parseCheckpoints(current.checkpoints, 'write')
    const entry = checkpoints.find(item => item.id === cid)
    if (!entry) throw createError({ statusCode: 404, statusMessage: 'Checkpoint not found' })
    parseSnapshot(current.previousSnapshot, 'write')
    const previousSnapshot = JSON.stringify({ title: current.title, content: current.content, format: current.format, savedAt: current.updatedAt })
    const updated = await tx.update(documents).set({ title: entry.title, content: entry.content, format: entry.format, previousSnapshot, updatedAt: Date.now(), revision: current.revision + 1 }).where(and(eq(documents.id, id), eq(documents.ownerId, user.id), eq(documents.revision, current.revision)))
    if (!updated.rowsAffected) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before restoring' })
    return { document: { id, title: entry.title, content: entry.content, format: entry.format, revision: current.revision + 1, updated_at: Date.now(), hasPrevious: true } }
  })
})
