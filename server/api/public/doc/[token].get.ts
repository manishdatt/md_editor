import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { useDatabase } from '~~/server/utils/database'

// Unauthenticated public read for shared documents. Deliberately returns a
// minimal payload: never ownerId, email, or any account information.
export default defineEventHandler(async (event) => {
  // Never cache: content is live and revocations must take effect immediately
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')

  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const db = await useDatabase(event)
  const rows = await db
    .select({
      title: documents.title,
      content: documents.content,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .where(and(eq(documents.shareToken, token), eq(documents.isShared, true)))
    .limit(1)

  const doc = rows[0]

  // Unknown / disabled / revoked tokens are indistinguishable
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return doc
})
