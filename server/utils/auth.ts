import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { users } from '~~/server/db/schema'
import { useDatabase } from '~~/server/utils/database'

export type UserTier = 'free' | 'paid'

export type AuthenticatedUser = {
  id: string
  tier: UserTier
}

function readAuthenticatedUserId(event: H3Event): string | null {
  const authContext = (event.context as any).auth
  if (typeof authContext !== 'function') {
    return null
  }

  const auth = authContext()
  if (!auth?.userId) {
    return null
  }

  return auth.userId
}

export async function requireAuthenticatedUser(event: H3Event): Promise<AuthenticatedUser> {
  const userId = readAuthenticatedUserId(event)
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = await useDatabase()
  const existing = await db
    .select({
      id: users.id,
      tier: users.tier
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!existing[0]) {
    const now = Date.now()
    await db.insert(users).values({
      id: userId,
      tier: 'free',
      createdAt: now,
      updatedAt: now
    })
    return { id: userId, tier: 'free' }
  }

  if (existing[0].tier !== 'free' && existing[0].tier !== 'paid') {
    const now = Date.now()
    await db
      .update(users)
      .set({
        tier: 'free',
        updatedAt: now
      })
      .where(eq(users.id, userId))
    return { id: userId, tier: 'free' }
  }

  return {
    id: existing[0].id,
    tier: existing[0].tier
  }
}
