import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { BetterAuth } from 'better-auth'
import type { H3Event } from 'h3'
import { ensureSchema, getDb } from './utils/database'
import { user, session, account, verification } from './db/schema'

let authInstance: BetterAuth | null = null
let hasRegisteredSocials = false

export async function getAuth(event?: H3Event): Promise<BetterAuth> {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || {}

  await ensureSchema(event)

  const socialProviders: Record<string, { clientId: string, clientSecret: string }> = {}

  const githubId = (config.githubClientId as string) || cfEnv.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID
  const githubSecret = (config.githubClientSecret as string) || cfEnv.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET
  if (githubId && githubSecret) {
    socialProviders.github = {
      clientId: githubId,
      clientSecret: githubSecret
    }
  }

  const googleId = (config.googleClientId as string) || cfEnv.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const googleSecret = (config.googleClientSecret as string) || cfEnv.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (googleId && googleSecret) {
    socialProviders.google = {
      clientId: googleId,
      clientSecret: googleSecret
    }
  }

  const secret = (config.betterAuthSecret as string) || cfEnv.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || 'fallback-secret-for-session-key-must-be-min-32-chars-long'
  const baseURL = (config.betterAuthUrl as string) || cfEnv.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL || (config.public?.siteUrl as string) || 'https://shbd.bioinfo.guru'

  const currentHasSocials = Object.keys(socialProviders).length > 0
  const needsRebuild = !authInstance || (currentHasSocials && !hasRegisteredSocials)

  if (needsRebuild) {
    hasRegisteredSocials = currentHasSocials
    authInstance = betterAuth({
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

  return authInstance
}
