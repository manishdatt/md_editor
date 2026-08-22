import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { getAuth } from '~~/server/auth'
import { user } from '~~/server/db/schema'
import { useDatabase } from '~~/server/utils/database'

export type UserTier = 'free' | 'paid'

export type AuthenticatedUser = {
  id: string
  tier: UserTier
}

export async function requireAuthenticatedUser(event: H3Event): Promise<AuthenticatedUser> {
  const auth = await getAuth(event)
  const result = await auth.api.getSession({ headers: event.headers })
  const sessionUser = (result as any)?.user ?? (result as any)?.session?.user
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = await useDatabase()
  const rows = await db
    .select({ tier: user.tier })
    .from(user)
    .where(eq(user.id, sessionUser.id))
    .limit(1)

  const tier = (rows[0]?.tier as UserTier) || 'free'

  return { id: sessionUser.id, tier }
}
