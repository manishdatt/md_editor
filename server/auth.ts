import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { BetterAuth } from 'better-auth'
import type { H3Event } from 'h3'
import { ensureSchema, getDb } from './utils/database'
import { user, session, account, verification } from './db/schema'

export async function getAuth(event?: H3Event): Promise<BetterAuth> {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || (event?.context as any)?.env || {}

  await ensureSchema(event)

  const socialProviders: Record<string, { clientId: string, clientSecret: string }> = {}

  const githubId = cfEnv.GITHUB_CLIENT_ID || cfEnv.NUXT_GITHUB_CLIENT_ID || (config.githubClientId as string) || process.env.GITHUB_CLIENT_ID
  const githubSecret = cfEnv.GITHUB_CLIENT_SECRET || cfEnv.NUXT_GITHUB_CLIENT_SECRET || (config.githubClientSecret as string) || process.env.GITHUB_CLIENT_SECRET
  if (githubId && githubSecret) {
    socialProviders.github = {
      clientId: githubId,
      clientSecret: githubSecret
    }
  }

  const googleId = cfEnv.GOOGLE_CLIENT_ID || cfEnv.NUXT_GOOGLE_CLIENT_ID || (config.googleClientId as string) || process.env.GOOGLE_CLIENT_ID
  const googleSecret = cfEnv.GOOGLE_CLIENT_SECRET || cfEnv.NUXT_GOOGLE_CLIENT_SECRET || (config.googleClientSecret as string) || process.env.GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret) {
    socialProviders.google = {
      clientId: googleId,
      clientSecret: googleSecret
    }
  }

  const secret = cfEnv.BETTER_AUTH_SECRET || cfEnv.NUXT_BETTER_AUTH_SECRET || (config.betterAuthSecret as string) || process.env.BETTER_AUTH_SECRET || 'fallback-secret-for-session-key-must-be-min-32-chars-long'
  const baseURL = cfEnv.BETTER_AUTH_URL || cfEnv.NUXT_BETTER_AUTH_URL || (config.betterAuthUrl as string) || process.env.BETTER_AUTH_URL || (config.public?.siteUrl as string) || 'https://shbd.bioinfo.guru'

  return betterAuth({
    baseURL,
    secret,
    socialProviders,
    advanced: {
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
