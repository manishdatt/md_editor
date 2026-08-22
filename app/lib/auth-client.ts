import { createAuthClient } from 'better-auth/vue'

// Keep the client request relative to the current site. This is important for
// deployments where a build-time auth URL can otherwise point at a different
// origin than the page the user is currently viewing.
export const authClient = createAuthClient({
  baseURL: '/api/auth'
})

export type AuthClient = typeof authClient
