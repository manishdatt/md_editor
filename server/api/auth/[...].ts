import { toWebRequest } from 'h3'
import { getAuth } from '../../auth'

export default defineEventHandler(async (event) => {
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || {}

  console.log('[auth] cfEnv keys:', Object.keys(cfEnv))
  console.log('[auth] hasGoogle:', !!cfEnv.GOOGLE_CLIENT_ID, 'hasGoogleSecret:', !!cfEnv.GOOGLE_CLIENT_SECRET, 'hasGitHub:', !!cfEnv.GITHUB_CLIENT_ID, 'hasGitHubSecret:', !!cfEnv.GITHUB_CLIENT_SECRET)
  console.log('[auth] hasTurso:', !!cfEnv.TURSO_URL, 'hasSecret:', !!cfEnv.BETTER_AUTH_SECRET)

  const auth = await getAuth(event)
  const response = await auth.handler(toWebRequest(event))

  console.log('[auth] handler response status:', response.status)
  if (response.status >= 400) {
    const cloned = response.clone()
    try {
      const body = await cloned.json()
      console.error('[auth] handler error body:', JSON.stringify(body))
    } catch {
      const text = await cloned.text()
      console.error('[auth] handler error text:', text)
    }
  }

  return response
})