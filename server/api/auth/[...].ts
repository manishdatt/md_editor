import { getRequestURL, toWebRequest } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  const traceId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now().toString(36)}`

  try {
    const context = event?.context as any
    const cfEnv = {
      ...(context?.env || {}),
      ...(context?.cloudflare?.env || {})
    } as Record<string, string | undefined>
    const requestURL = getRequestURL(event)
    const request = toWebRequest(event)

    console.info('[auth] request received', {
      traceId,
      method: request.method,
      pathname: requestURL.pathname,
      origin: requestURL.origin,
      hasCookie: request.headers.has('cookie'),
      contentType: request.headers.get('content-type'),
      cfEnvKeys: Object.keys(cfEnv).filter((key) => /^(GOOGLE|GITHUB|TURSO|BETTER_AUTH)/.test(key))
    })

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
          traceId,
          status: response.status,
          body
        })

        if (response.status >= 500) {
          return new Response(JSON.stringify({
            message: body?.message || 'Authentication provider request failed',
            code: body?.code,
            detail: body,
            traceId
          }), {
            status: response.status,
            headers: { 'content-type': 'application/json' }
          })
        }
      } catch {
        const text = await cloned.text()
        console.error('[auth] handler error response text', {
          traceId,
          status: response.status,
          text: text.slice(0, 1000)
        })

        if (response.status >= 500) {
          return new Response(JSON.stringify({
            message: 'Authentication provider request failed',
            detail: text.slice(0, 1000),
            traceId
          }), {
            status: response.status,
            headers: { 'content-type': 'application/json' }
          })
        }
      }
    }

    return response
  } catch (error: any) {
    console.error('[auth] unhandled error', {
      traceId,
      message: error?.message || String(error),
      stack: error?.stack
    })
    return new Response(JSON.stringify({
      message: 'Authentication server error',
      detail: error?.message || String(error),
      traceId
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
})
