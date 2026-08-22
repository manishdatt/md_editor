import { toWebRequest, sendWebResponse } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  try {
    const auth = await getAuth(event)
    const response = await auth.handler(toWebRequest(event))
    return sendWebResponse(event, response)
  } catch (error: any) {
    if (event.path.includes('/get-session')) {
      return sendWebResponse(event, new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    }
    throw error
  }
})