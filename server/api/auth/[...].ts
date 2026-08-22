import { getRequestURL, toWebRequest } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || {}
  const requestURL = getRequestURL(event)
  const request = toWebRequest(event)

  console.info('[auth] request received', {
    method: request.method,
    pathname: requestURL.pathname,
    origin: requestURL.origin,
    hasCookie: request.headers.has('cookie'),
    contentType: request.headers.get('content-type'),
    cfEnvKeys: Object.keys(cfEnv).filter((key) => /^(GOOGLE|GITHUB|TURSO|BETTER_AUTH)/.test(key))
  })

  try {
    const auth = await getAuth(event)
    const response = await auth.handler(request)

    console.info('[auth] handler response', {
      status: response.status,
      contentType: response.headers.get('content-type'),
      hasLocation: response.headers.has('location')
    })
    if (response.status >= 400) {
      const cloned = response.clone()
      try {
        const body = await cloned.json()
        console.error('[auth] handler error response', {
          status: response.status,
          body
        })
      } catch {
        const text = await cloned.text()
        console.error('[auth] handler error response text', {
          status: response.status,
          text: text.slice(0, 1000)
        })
      }
    }

    return response
  } catch (error: any) {
    console.error('[auth] unhandled error:', error?.stack || error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Authentication server error',
      data: import.meta.dev ? { message: error?.message || String(error) } : undefined
    })
  }
})
