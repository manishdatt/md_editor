import { betterAuth } from 'better-auth'
import { google, github } from 'better-auth/social-providers'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { BetterAuth } from 'better-auth'
import { getRequestURL, type H3Event } from 'h3'
import { ensureSchema, getDb } from './utils/database'
import { user, session, account, verification } from './db/schema'

export async function getAuth(event?: H3Event): Promise<BetterAuth> {
  const config = event ? useRuntimeConfig(event) : useRuntimeConfig()
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || (event?.context as any)?.env || {}

  console.info('[auth] initializing Better Auth', {
    hasEvent: !!event,
    cfEnvKeys: Object.keys(cfEnv).filter((key) => /^(GOOGLE|GITHUB|TURSO|BETTER_AUTH)/.test(key)),
    hasTursoUrl: !!(cfEnv.TURSO_URL || config.tursoUrl || process.env.TURSO_URL),
    hasTursoToken: !!(cfEnv.TURSO_AUTH_TOKEN || config.tursoAuthToken || process.env.TURSO_AUTH_TOKEN),
    hasSecret: !!(cfEnv.BETTER_AUTH_SECRET || config.betterAuthSecret || process.env.BETTER_AUTH_SECRET)
  })

  await ensureSchema(event)

  const githubId = cfEnv.GITHUB_CLIENT_ID || (config.githubClientId as string) || process.env.GITHUB_CLIENT_ID || ''
  const githubSecret = cfEnv.GITHUB_CLIENT_SECRET || (config.githubClientSecret as string) || process.env.GITHUB_CLIENT_SECRET || ''
  const googleId = cfEnv.GOOGLE_CLIENT_ID || (config.googleClientId as string) || process.env.GOOGLE_CLIENT_ID || ''
  const googleSecret = cfEnv.GOOGLE_CLIENT_SECRET || (config.googleClientSecret as string) || process.env.GOOGLE_CLIENT_SECRET || ''

  const socialProviders: Record<string, any> = {}
  if (githubId && githubSecret) {
    socialProviders.github = github({ clientId: githubId, clientSecret: githubSecret })
  }
  if (googleId && googleSecret) {
    socialProviders.google = google({ clientId: googleId, clientSecret: googleSecret })
  }

  const secret = cfEnv.BETTER_AUTH_SECRET || (config.betterAuthSecret as string) || process.env.BETTER_AUTH_SECRET || 'fallback-secret-for-session-key-must-be-min-32-chars-long'
  const configuredBaseURL = cfEnv.BETTER_AUTH_URL || (config.betterAuthUrl as string) || process.env.BETTER_AUTH_URL || ''
  const requestOrigin = event ? getRequestURL(event).origin : ''
  const baseURL = configuredBaseURL || requestOrigin || 'https://shbd.bioinfo.guru'

  console.info('[auth] Better Auth configuration resolved', {
    baseURL,
    baseURLSource: configuredBaseURL ? 'configured' : requestOrigin ? 'request-origin' : 'fallback',
    providers: Object.keys(socialProviders),
    googleCredentials: !!googleId && !!googleSecret,
    githubCredentials: !!githubId && !!githubSecret,
    hasSecret: secret !== 'fallback-secret-for-session-key-must-be-min-32-chars-long'
  })

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
