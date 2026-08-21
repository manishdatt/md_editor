import { and, eq, sql } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser, type UserTier } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

const TIER_STORAGE_BYTES: Record<UserTier, number> = {
  free: 2 * 1024 * 1024,
  paid: 50 * 1024 * 1024
}

type DocumentFormat = 'markdown' | 'typst'

type PutBody = {
  title?: string
  content?: string
  format?: DocumentFormat
}

function normalizeFormat(value: unknown): DocumentFormat {
  return value === 'typst' ? 'typst' : 'markdown'
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const user = await requireAuthenticatedUser(event)
  const body = await readBody<PutBody>(event)
  const title = typeof body?.title === 'string' ? body.title : 'Untitled Document'
  const content = typeof body?.content === 'string' ? body.content : ''
  // Format is fixed at creation; it is intentionally ignored on updates so a
  // document can never silently switch between markdown and typst.
  const format = normalizeFormat(body?.format)
  const updatedAt = Date.now()

  const db = await useDatabase()
  const existing = await db
    .select({
      id: documents.id,
      ownerId: documents.ownerId,
      contentLength: sql<number>`length(${documents.content})`
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)

  const existingDoc = existing[0]
  if (existingDoc && existingDoc.ownerId !== user.id) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  const quota = TIER_STORAGE_BYTES[user.tier] ?? TIER_STORAGE_BYTES.free
  const usageRows = await db
    .select({ total: sql<number>`coalesce(sum(length(${documents.content})), 0)` })
    .from(documents)
    .where(eq(documents.ownerId, user.id))
  const usedBytes = Number(usageRows[0]?.total ?? 0)
  const existingLength = existingDoc ? Number(existingDoc.contentLength) : 0
  const projectedBytes = usedBytes - existingLength + content.length

  if (projectedBytes > quota) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Storage limit reached',
      data: { code: 'STORAGE_LIMIT_REACHED' }
    })
  }

  if (existingDoc) {
    await db
      .update(documents)
      .set({ title, content, updatedAt })
      .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
  } else {
    await db
      .insert(documents)
      .values({ id, ownerId: user.id, title, content, format, updatedAt })
  }

  const row = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      format: documents.format,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  return {
    document: row[0],
    user: {
      id: user.id,
      tier: user.tier
    }
  }
})
