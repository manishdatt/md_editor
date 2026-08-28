import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser, type UserTier } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { byteLength, checkpointMetadata, MAX_LABEL_BYTES, MAX_LABEL_CHARS, parseCheckpoints, pushCheckpoint, type Checkpoint } from '~~/server/utils/snapshots'

const QUOTA: Record<UserTier, number> = { free: 2 * 1024 * 1024, starter: 10 * 1024 * 1024, pro: 50 * 1024 * 1024 }
const transient = (error: any) => /busy|locked|serial|conflict/i.test(String(error?.message || error))
async function retry<T>(fn: () => Promise<T>) { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (!transient(e) || i >= 4) throw e; await new Promise(r => setTimeout(r, 20 * 2 ** i)) } } }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  const user = await requireAuthenticatedUser(event)
  const body = await readBody<{ label?: unknown, clientRequestId?: unknown, baseRevision?: unknown }>(event)
  const label = body?.label === undefined ? '' : body.label
  if (typeof label !== 'string' || label.length > MAX_LABEL_CHARS || byteLength(label) > MAX_LABEL_BYTES) throw createError({ statusCode: 400, statusMessage: 'Invalid checkpoint label' })
  if (typeof body?.clientRequestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.clientRequestId)) throw createError({ statusCode: 400, statusMessage: 'Invalid clientRequestId' })
  if (typeof body?.baseRevision !== 'number') throw createError({ statusCode: 400, statusMessage: 'Missing baseRevision' })
  const db = await useDatabase()
  return retry(() => db.transaction(async (tx) => {
    const current = (await tx.select().from(documents).where(and(eq(documents.id, id), eq(documents.ownerId, user.id))).limit(1))[0]
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    const checkpoints = parseCheckpoints(current.checkpoints, 'write')
    const existing = checkpoints.find((item) => item.clientRequestId === body.clientRequestId)
    if (existing) return { checkpoints: checkpointMetadata(checkpoints), revision: current.revision }
    if (current.revision !== body.baseRevision) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
    const entry: Checkpoint = { id: crypto.randomUUID(), label, title: current.title, content: current.content, format: current.format as 'markdown' | 'typst', savedAt: Date.now(), clientRequestId: body.clientRequestId }
    const next = pushCheckpoint(checkpoints, entry)
    const oldBytes = byteLength(current.checkpoints)
    const newJson = JSON.stringify(next)
    const all = await tx.select({ content: documents.content, checkpoints: documents.checkpoints, previousSnapshot: documents.previousSnapshot }).from(documents).where(eq(documents.ownerId, user.id))
    const total = all.reduce((sum, row) => sum + byteLength(row.content) + byteLength(row.checkpoints) + byteLength(row.previousSnapshot), 0)
    if (total - oldBytes + byteLength(newJson) > (QUOTA[user.tier] ?? QUOTA.free)) throw createError({ statusCode: 413, statusMessage: 'Storage limit reached' })
    const updated = await tx.update(documents).set({ checkpoints: newJson, updatedAt: Date.now(), revision: current.revision + 1 }).where(and(eq(documents.id, id), eq(documents.ownerId, user.id), eq(documents.revision, current.revision)))
    if (!updated.rowsAffected) throw createError({ statusCode: 409, statusMessage: 'Document changed; reload before saving' })
    return { checkpoints: checkpointMetadata(next), revision: current.revision + 1 }
  }))
})
