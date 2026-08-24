import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { user } from '~~/server/db/schema'
import { requireAdmin, type UserTier } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

const VALID_TIERS: UserTier[] = ['free', 'paid']

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const db = await useDatabase()

  const id = String(getRouterParam(event, 'id') || '')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing user id' })
  }

  const body = await readBody<{ tier?: string, disabled?: boolean }>(event).catch(() => null)
  if (!body || (body.tier === undefined && body.disabled === undefined)) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  }

  const patch: {
    tier?: UserTier
    disabledAt?: Date | null
    updatedAt: Date
  } = { updatedAt: new Date() }

  if (body.tier !== undefined) {
    const tier = String(body.tier) as UserTier
    if (!VALID_TIERS.includes(tier)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid tier' })
    }
    patch.tier = tier
  }

  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') {
      throw createError({ statusCode: 400, statusMessage: 'Invalid disabled flag' })
    }
    // Guard against locking yourself out of the panel.
    if (body.disabled && id === admin.id) {
      throw createError({ statusCode: 400, statusMessage: 'Cannot disable your own account' })
    }
    patch.disabledAt = body.disabled ? new Date() : null
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
    .set(patch)
    .where(eq(user.id, id))

  return { user: { id, tier: patch.tier, disabled: body.disabled ?? undefined } }
})
