import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser, type UserTier } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { byteLength, checkpointMetadata, nextRevision, parseCheckpoints, parseSnapshot } from '~~/server/utils/snapshots'

const TIER_STORAGE_BYTES: Record<UserTier, number> = {
  free: 2 * 1024 * 1024,
  starter: 10 * 1024 * 1024,
  pro: 50 * 1024 * 1024
}

type PutBody = { title?: string, content?: string, format?: 'markdown' | 'typst', baseRevision?: number }

function transient(error: any) { return /busy|locked|serial|conflict/i.test(String(error?.message || error)) }
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn() } catch (error) {
      if (!transient(error) || attempt >= 4) throw error
      await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt)))
    }
  }
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<PutBody>(event)
  const title = typeof body?.title === 'string' ? body.title : 'Untitled Document'
  const content = typeof body?.content === 'string' ? body.content : ''
  const format = body?.format === 'typst' ? 'typst' : 'markdown'
  const db = await useDatabase()

  return retry(() => db.transaction(async (tx) => {
    const rows = await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1)
    const current = rows[0]
    const quota = TIER_STORAGE_BYTES[user.tier] ?? TIER_STORAGE_BYTES.free
    const all = await tx.select({ content: documents.content, checkpoints: documents.checkpoints, previousSnapshot: documents.previousSnapshot }).from(documents).where(eq(documents.ownerId, user.id))
    const total = all.reduce((sum, row) => sum + byteLength(row.content) + byteLength(row.checkpoints) + byteLength(row.previousSnapshot), 0)

    if (!current) {
      if (total + byteLength(content) > quota) throw createError({ statusCode: 413, statusMessage: 'Storage limit reached' })
      await tx.insert(documents).values({ id, ownerId: user.id, title, content, format, updatedAt: Date.now(), revision: 0 })
    } else if (!(current.title === title && current.content === content && current.format === format)) {
      if (typeof body?.baseRevision !== 'number' || current.revision !== body.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
      parseSnapshot(current.previousSnapshot, 'write')
      const snapshot = JSON.stringify({ title: current.title, content: current.content, format: current.format, savedAt: current.updatedAt })
      const projected = total - byteLength(current.content) - byteLength(current.previousSnapshot) + byteLength(content) + byteLength(snapshot)
      if (projected > quota) throw createError({ statusCode: 413, statusMessage: 'Storage limit reached' })
      const changed = await tx.update(documents).set({ title, content, format, previousSnapshot: snapshot, updatedAt: Date.now(), revision: nextRevision(current.revision) }).where(and(eq(documents.id, id), eq(documents.ownerId, user.id), eq(documents.revision, current.revision)))
      if (!changed.rowsAffected) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
    }

    const row = (await tx.select({ id: documents.id, title: documents.title, content: documents.content, format: documents.format, updated_at: documents.updatedAt, revision: documents.revision, checkpoints: documents.checkpoints, previousSnapshot: documents.previousSnapshot }).from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1))[0]
    const previous = parseSnapshot(row?.previousSnapshot, 'read')
    return {
      document: {
        id: row.id, title: row.title, content: row.content, format: row.format,
        updated_at: row.updated_at, revision: row.revision,
        checkpoints: checkpointMetadata(parseCheckpoints(row.checkpoints, 'read')),
        hasPrevious: previous !== null
      },
      user: { id: user.id, tier: user.tier }
    }
  }))
})
