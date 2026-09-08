import { pingDatabase } from '~~/server/utils/database'

// Fast Turso probe that NEVER hangs: SELECT 1 with an 8s timeout.
// Next time share-links/login stall, hit this first:
// - fast 200 -> Turso reachable, suspect schema-migration stall or isolate
//   poisoning (check tail for `[auth-db] slow statement` / `schema init start`)
// - fast 500 missing-config -> Pages env vars absent on this deployment
// - 503 TURSO_TIMEOUT after ~8s -> Workers -> Turso stall (transient network
//   or Turso cold path); retry and compare with direct `turso db shell`.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const started = Date.now()
  try {
    const { ms } = await pingDatabase(event)
    return { ok: true, ms, totalMs: Date.now() - started }
  } catch (err: any) {
    const statusCode = err?.statusCode === 500 && String(err?.statusMessage || '').includes('must be configured') ? 500 : 503
    throw createError({
      statusCode,
      statusMessage: err?.message || String(err),
      data: { ok: false, totalMs: Date.now() - started, code: (err as any)?.code || null }
    })
  }
})
