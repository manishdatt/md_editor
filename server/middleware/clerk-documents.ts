import { clerkMiddleware } from '@clerk/nuxt/server'
import { getRequestURL } from 'h3'

const clerkAuthMiddleware = clerkMiddleware()

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/documents')) {
    return
  }

  await clerkAuthMiddleware(event)
})
