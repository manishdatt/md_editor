import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { checkpointMetadata, parseCheckpoints, parseSnapshot } from '~~/server/utils/snapshots'

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
      format: documents.format,
      shareToken: documents.shareToken,
      isShared: documents.isShared,
      updated_at: documents.updatedAt,
      revision: documents.revision,
      checkpoints: documents.checkpoints,
      previousSnapshot: documents.previousSnapshot
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  if (!row[0]) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  const current = row[0]
  const checkpoints = parseCheckpoints(current.checkpoints, 'read')
  const previous = parseSnapshot(current.previousSnapshot, 'read')
  return {
    document: {
      id: current.id,
      title: current.title,
      content: current.content,
      format: current.format,
      shareToken: current.shareToken,
      isShared: current.isShared,
      updated_at: current.updated_at,
      revision: current.revision,
      checkpoints: checkpointMetadata(checkpoints),
      hasPrevious: previous !== null
    }
  }
})
