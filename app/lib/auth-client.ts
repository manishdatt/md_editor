import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient({
  // Better Auth requires an absolute URL when baseURL is supplied. Resolve it
  // from the browser at runtime so local and production origins both work.
  baseURL: import.meta.client ? `${window.location.origin}/api/auth` : undefined
})

export type AuthClient = typeof authClient
