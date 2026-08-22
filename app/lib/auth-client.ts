import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient()

export type AuthClient = typeof authClient
