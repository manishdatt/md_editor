import { and, eq, sql } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

type PutBody = {
  title?: string
  content?: string
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
  const updatedAt = Date.now()

  const db = await useDatabase()
  const existing = await db
    .select({
      id: documents.id,
      owner_id: documents.ownerId
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)

  const existingDoc = existing[0]
  if (existingDoc && existingDoc.owner_id !== user.id) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (existingDoc) {
    await db
      .update(documents)
      .set({
        title,
        content,
        updatedAt
      })
      .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
  } else {
    if (user.tier === 'free') {
      const countRows = await db
        .select({ count: sql<number>`count(*)` })
        .from(documents)
        .where(eq(documents.ownerId, user.id))
      const documentCount = Number(countRows[0]?.count ?? 0)

      if (documentCount >= 3) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Free tier limit reached',
          data: { code: 'FREE_TIER_LIMIT_REACHED' }
        })
      }
    }

    await db
      .insert(documents)
      .values({
        id,
        ownerId: user.id,
        title,
        content,
        updatedAt
      })
  }

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

  return {
    document: row[0],
    user: {
      id: user.id,
      tier: user.tier
    }
  }
})
