import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { checkpointMetadata, parseCheckpoints } from '~~/server/utils/snapshots'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const cid = getRouterParam(event, 'cid')
  if (!id || !cid) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<{ baseRevision?: unknown }>(event)
  if (typeof body?.baseRevision !== 'number') throw createError({ statusCode: 400, statusMessage: 'Missing baseRevision' })
  const db = await useDatabase()
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1))[0]
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    if (current.revision !== body.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
    const checkpoints = parseCheckpoints(current.checkpoints, 'write')
    const next = checkpoints.filter(item => item.id !== cid)
    if (next.length === checkpoints.length) throw createError({ statusCode: 404, statusMessage: 'Checkpoint not found' })
    const updated = await tx.update(documents).set({ checkpoints: JSON.stringify(next), updatedAt: Date.now(), revision: current.revision + 1 }).where(and(eq(documents.id, id), eq(documents.ownerId, user.id), eq(documents.revision, current.revision)))
    if (!updated.rowsAffected) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
    return { checkpoints: checkpointMetadata(next), revision: current.revision + 1 }
  })
})
