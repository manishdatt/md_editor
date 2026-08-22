import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { BetterAuth } from 'better-auth'
import { getRequestURL, type H3Event } from 'h3'
import { ensureSchema, getDb } from './utils/database'
import { user, session, account, verification } from './db/schema'

export async function getAuth(event?: H3Event): Promise<BetterAuth> {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const context = event?.context as any
  // Nuxt/Cloudflare can expose bindings through either location depending on
  // the Pages runtime. Merge both instead of allowing an empty object in one
  // location to hide credentials from the other.
  const cfEnv = {
    ...(context?.env || {}),
    ...(context?.cloudflare?.env || {})
  } as Record<string, string | undefined>

  await ensureSchema(event)

  const githubId = cfEnv.GITHUB_CLIENT_ID || cfEnv.NUXT_GITHUB_CLIENT_ID || (config.githubClientId as string) || process.env.GITHUB_CLIENT_ID || process.env.NUXT_GITHUB_CLIENT_ID || ''
  const githubSecret = cfEnv.GITHUB_CLIENT_SECRET || cfEnv.NUXT_GITHUB_CLIENT_SECRET || (config.githubClientSecret as string) || process.env.GITHUB_CLIENT_SECRET || process.env.NUXT_GITHUB_CLIENT_SECRET || ''
  const googleId = cfEnv.GOOGLE_CLIENT_ID || cfEnv.NUXT_GOOGLE_CLIENT_ID || (config.googleClientId as string) || process.env.GOOGLE_CLIENT_ID || process.env.NUXT_GOOGLE_CLIENT_ID || ''
  const googleSecret = cfEnv.GOOGLE_CLIENT_SECRET || cfEnv.NUXT_GOOGLE_CLIENT_SECRET || (config.googleClientSecret as string) || process.env.GOOGLE_CLIENT_SECRET || process.env.NUXT_GOOGLE_CLIENT_SECRET || ''

  const socialProviders: Record<string, any> = {}
  if (githubId && githubSecret) {
    socialProviders.github = { clientId: githubId, clientSecret: githubSecret }
  }
  if (googleId && googleSecret) {
    socialProviders.google = { clientId: googleId, clientSecret: googleSecret }
  }

  const secret = cfEnv.BETTER_AUTH_SECRET || (config.betterAuthSecret as string) || process.env.BETTER_AUTH_SECRET || 'fallback-secret-for-session-key-must-be-min-32-chars-long'
  const configuredBaseURL = cfEnv.BETTER_AUTH_URL || (config.betterAuthUrl as string) || process.env.BETTER_AUTH_URL || ''
  const requestOrigin = event ? getRequestURL(event).origin : ''
  const baseURL = configuredBaseURL || requestOrigin || 'https://shbd.bioinfo.guru'

  return betterAuth({
    baseURL,
    secret,
    socialProviders,
    account: {
      storeStateStrategy: 'cookie'
    },
    database: drizzleAdapter(getDb(event), {
      provider: 'sqlite',
      usePlural: false,
      schema: { user, session, account, verification }
    }),
    user: {
      additionalFields: {
        tier: {
          type: 'string',
          defaultValue: 'free',
          required: false,
          input: false,
          output: true
        }
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24
    }
  })
}
