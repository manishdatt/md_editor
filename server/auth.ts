import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { BetterAuth } from 'better-auth'
import { ensureSchema, getDb } from './utils/database'
import { user, session, account, verification } from './db/schema'

let authInstance: BetterAuth | null = null

export async function getAuth(): Promise<BetterAuth> {
  await ensureSchema()

  if (!authInstance) {
    const socialProviders: Record<string, { clientId: string, clientSecret: string }> = {}

    if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
      socialProviders.github = {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
      }
    }

    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      socialProviders.google = {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET
      }
    }

    authInstance = betterAuth({
      baseURL: process.env.BETTER_AUTH_URL || undefined,
      secret: process.env.BETTER_AUTH_SECRET,
      socialProviders,
      database: drizzleAdapter(getDb(), {
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
