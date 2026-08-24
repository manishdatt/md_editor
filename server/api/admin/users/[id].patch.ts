import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { user } from '~~/server/db/schema'
import { requireAdmin, type UserTier } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

const VALID_TIERS: UserTier[] = ['free', 'paid']

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await useDatabase()

  const id = String(getRouterParam(event, 'id') || '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' })
  }

  const body = await readBody<{ tier?: string }>(event).catch(() => null)
  const tier = String(body?.tier || '') as UserTier
  if (!VALID_TIERS.includes(tier)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid tier' })
  }

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id))
    .limit(1)
  if (existing.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  await db
    .update(user)
    .set({ tier, updatedAt: new Date() })
    .where(eq(user.id, id))

  return { user: { id, tier } }
})
