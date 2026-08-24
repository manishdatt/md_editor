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
    .select({ tier: user.tier, disabledAt: user.disabledAt })
    .from(user)
    .where(eq(user.id, sessionUser.id))
    .limit(1)

  // Soft-banned accounts keep their session but fail every data API. Admins
  // are unaffected (requireAdmin reads the row itself and skips this check).
  if (rows[0]?.disabledAt) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Account disabled',
      data: { code: 'ACCOUNT_DISABLED' }
    })
  }

  const tier = (rows[0]?.tier as UserTier) || 'free'

  return { id: sessionUser.id, tier }
}

// Admin authorization is env-driven: ADMIN_EMAILS holds a comma-separated
// allowlist of account emails. Deliberately no role column / DB mutation for
// admin identity — a single config source that cannot drift or be corrupted,
// and revocation is a redeploy away.
export type AdminUser = {
  id: string
  tier: UserTier
  email: string
}

export function parseAdminEmails(raw: string | undefined | null): string[] {
  return String(raw || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export async function requireAdmin(event: H3Event): Promise<AdminUser> {
  const auth = await getAuth(event)
  const result = await auth.api.getSession({ headers: event.headers })
  const sessionUser = (result as any)?.user ?? (result as any)?.session?.user
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const db = await useDatabase()
  const rows = await db
    .select({ tier: user.tier, email: user.email })
    .from(user)
    .where(eq(user.id, sessionUser.id))
    .limit(1)

  const email = String(rows[0]?.email || '').trim().toLowerCase()
  // The allowlist may be provisioned at build time (runtimeConfig), as a Node
  // env var, or as a Cloudflare Pages binding at runtime — accept all three,
  // mirroring how database.ts resolves Turso credentials.
  const cfEnv = (event.context as any)?.cloudflare?.env || (event.context as any)?.env || {}
  const rawAllowlist = [
    useRuntimeConfig(event).adminEmails,
    process.env.ADMIN_EMAILS,
    cfEnv.ADMIN_EMAILS
  ].filter(Boolean).join(',')
  const allowlist = parseAdminEmails(rawAllowlist)

  if (!email || !allowlist.includes(email)) {
    // 403 without echoing whether the account exists beyond the auth layer.
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const tier = (rows[0]?.tier as UserTier) || 'free'
  return { id: sessionUser.id, tier, email }
}
