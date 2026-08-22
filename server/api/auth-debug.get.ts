export default defineEventHandler(async (event) => {
  const cfEnv = (event?.context?.cloudflare?.env as Record<string, string | undefined>) || {}

  return {
    hasGoogle: !!cfEnv.GOOGLE_CLIENT_ID,
    hasGoogleSecret: !!cfEnv.GOOGLE_CLIENT_SECRET,
    hasGithub: !!cfEnv.GITHUB_CLIENT_ID,
    hasGithubSecret: !!cfEnv.GITHUB_CLIENT_SECRET,
    hasTursoUrl: !!cfEnv.TURSO_URL,
    hasBetterAuthSecret: !!cfEnv.BETTER_AUTH_SECRET,
    hasBetterAuthUrl: !!cfEnv.BETTER_AUTH_URL,
    cfEnvKeys: Object.keys(cfEnv),
    processEnvHasGoogle: !!process.env.GOOGLE_CLIENT_ID,
    processEnvHasTurso: !!process.env.TURSO_URL,
  }
})
