import { toWebRequest } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  const traceId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now().toString(36)}`

  try {
    const request = toWebRequest(event)
    const auth = await getAuth(event)
    const response = await auth.handler(request)

    if (response.status >= 400) {
      const cloned = response.clone()
      try {
        const body = await cloned.json()

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
