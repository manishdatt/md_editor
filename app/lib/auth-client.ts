import { createAuthClient } from 'better-auth/client'

export const authClient = createAuthClient()

export type AuthClient = typeof authClient
