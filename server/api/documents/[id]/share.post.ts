import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { generateShareToken } from '~~/server/utils/share-token'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const body = await readBody<{ enabled?: unknown, rotate?: unknown }>(event).catch(() => null)
  const enabled = body?.enabled
  const rotate = body?.rotate

  if (typeof enabled !== 'boolean' || (rotate !== undefined && typeof rotate !== 'boolean')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body: expected { enabled: boolean, rotate?: boolean }' })
  }

  const user = await requireAuthenticatedUser(event)
  const db = await useDatabase(event)

  const rows = await db
    .select({
      id: documents.id,
      format: documents.format,
      shareToken: documents.shareToken
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, user.id)))
    .limit(1)

  const doc = rows[0]

  // 404 (never 403) so this endpoint cannot be used to enumerate doc ids
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (doc.format !== 'markdown') {
    throw createError({ statusCode: 400, statusMessage: 'Only markdown documents can be shared' })
  }

  const config = useRuntimeConfig(event)
  const siteUrl = ((config.public.siteUrl as string) || '').replace(/\/+$/, '')

  if (!enabled) {
    await db
      .update(documents)
      .set({ isShared: false })
      .where(and(eq(documents.id, doc.id), eq(documents.ownerId, user.id)))

    // Keep the token: disabling is temporary, re-enabling restores the same URL
    return {
      isShared: false,
      token: doc.shareToken,
      url: doc.shareToken ? `${siteUrl}/p/${doc.shareToken}` : null
    }
  }

  let token = doc.shareToken
  if (rotate || !token) {
    // Unique index constraint violation is astronomically unlikely, but retry
    // once with a fresh token instead of failing the request.
    for (let attempt = 0; ; attempt += 1) {
      token = generateShareToken()
      try {
        await db
          .update(documents)
          .set({ shareToken: token, isShared: true })
          .where(and(eq(documents.id, doc.id), eq(documents.ownerId, user.id)))
        break
      } catch (err: any) {
        const message = String(err?.message || err)
        if (attempt === 0 && message.includes('UNIQUE')) {
          continue
        }
        throw err
      }
    }
  } else {
    await db
      .update(documents)
      .set({ isShared: true })
      .where(and(eq(documents.id, doc.id), eq(documents.ownerId, user.id)))
  }

  return {
    isShared: true,
    token,
    url: `${siteUrl}/p/${token}`
  }
})
