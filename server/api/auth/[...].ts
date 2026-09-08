import { toWebRequest } from 'h3'
import { getAuth } from '../../auth'
import { withTimeout } from '../../utils/database'

const AUTH_HANDLER_TIMEOUT_MS = 20000

export default defineEventHandler(async (event) => {
  const traceId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now().toString(36)}`
  const started = Date.now()

  try {
    const request = toWebRequest(event)
    // getAuth -> ensureSchema now times out on its own; the better-auth DB
    // adapter calls below get an overall guard so a Turso stall surfaces as
    // a fast 503 with traceId instead of a 163s `canceled` isolate hang.
    const auth = await getAuth(event)
    const response = await withTimeout(auth.handler(request), AUTH_HANDLER_TIMEOUT_MS, 'auth-handler')

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
    const elapsed = Date.now() - started
    console.error('[auth] unhandled error', {
      traceId,
      elapsedMs: elapsed,
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
