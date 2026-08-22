# Auth Issue: 500 on Social Sign-In (Google/GitHub) — Root Cause & Fix

## Symptom

Clicking **Google** or **GitHub** sign-in on `https://shbd.bioinfo.guru` resulted in:

```
POST https://shbd.bioinfo.guru/api/auth/sign-in/social 500 (Internal Server Error)
{"message":"Authentication provider request failed","traceId":"...","status":500,"statusText":""}
```

Confusingly, the same code worked locally (`nuxt dev`) but failed only on the Cloudflare Pages deployment. All required env vars (`GOOGLE_CLIENT_ID/SECRET`, `TURSO_URL/AUTH_TOKEN`, `BETTER_AUTH_SECRET/URL`) were confirmed present in the Cloudflare env via `/api/auth-debug`, so credentials were not the problem.

## Root Causes

### 1. `storeStateStrategy` was in the wrong config section

```ts
// BEFORE (silently ignored in better-auth 1.7):
advanced: { storeStateStrategy: 'cookie' }

// AFTER (correct location):
account: { storeStateStrategy: 'cookie' }
```

In better-auth 1.7 the option lives under `account` (see `node_modules/better-auth/dist/context/create-context.mjs`: `storeStateStrategy: options.account?.storeStateStrategy || (isStateful ? "database" : "cookie")`). Because it was ignored, the library defaulted to the **database** strategy — every `sign-in/social` call wrote OAuth state to the Turso `verification` table.

### 2. Missing `nodejs_compat` flag (the actual 500 trigger)

better-auth 1.7 uses **AsyncLocalStorage** (`node:async_hooks`) to carry per-request OAuth state (`setOAuthState`/`getOAuthState`, wrapped by `runWithRequestState`). On Cloudflare Workers, `node:async_hooks` **only works with the `nodejs_compat` compatibility flag**. Without it, the OAuth flow threw a plain (non-APIError) exception:

```
Error: No request state found. Please make sure you are calling this function
within a `runWithRequestState` callback.
```

Better Auth's own source even warns about this (`node_modules/@better-auth/core/dist/async_hooks/index.mjs`):

> "If you are using Cloudflare Workers, please see: compatibility-flags/#nodejs-compatibility-flag"

It worked locally because Nuxt dev runs on Node.js, which has AsyncLocalStorage natively.

### 3. Why the error message was misleading

better-call's router wraps non-APIError exceptions into `new Response(null, { status: 500 })` — an **empty body**. The catch-all handler (`server/api/auth/[...].ts`) then fell back to the generic message `"Authentication provider request failed"`, hiding the real cause. The true error was only visible in server-side logs (`# SERVER_ERROR:`).

## Fixes Applied

### `wrangler.toml` — the critical fix

```toml
compatibility_flags = ["nodejs_compat"]
```

### `server/auth.ts` — correct config placement

```ts
account: {
  storeStateStrategy: 'cookie'
},
```

### `server/utils/database.ts` — hardened `ensureSchema`

- Collects per-statement failures instead of aborting on the first one.
- Does **not** cache a failed initialization — retries on the next request, so one transient cold-start failure no longer breaks auth for an isolate's lifetime.

### `.gitignore`

Added `.dev.vars` so local `wrangler pages dev` secrets can live in the repo folder without being committed.

## Reproduction / Verification

1. Live probe reproduced it: `curl -X POST https://shbd.bioinfo.guru/api/auth/sign-in/social -d '{"provider":"google","callbackURL":"/","disableRedirect":true}'` → 500 with empty body.
2. `wrangler pages dev dist` (real Workers runtime emulation) reproduced the same 500 locally; plain `nuxt dev` (Node) did not.
3. Temporarily adding `onAPIError.onError` logging surfaced the real stack trace in wrangler logs.
4. After the fixes: both providers return **HTTP 200** with correct OAuth authorize URLs under Workers emulation, and both Google + GitHub sign-in confirmed working on the live site.

## Checklist if this breaks again

1. `wrangler.toml` still has `compatibility_flags = ["nodejs_compat"]` (also verify it's set if flags are ever managed in the Cloudflare dashboard instead of the toml).
2. Google/GitHub OAuth app redirect URIs match: `https://<domain>/api/auth/callback/<provider>`.
3. Cloudflare env/secrets contain all `GOOGLE_*`, `GITHUB_*`, `TURSO_*`, `BETTER_AUTH_*` values.
4. Check worker logs (`npx wrangler pages deployment tail` or dashboard → Logs) — the real error appears under `# SERVER_ERROR:` / `[auth] ...` entries, not in the client response.

## Files Touched

- `wrangler.toml` — added `nodejs_compat`
- `server/auth.ts` — `storeStateStrategy` moved to `account`
- `server/utils/database.ts` — `ensureSchema` retry-on-failure hardening
- `.gitignore` — ignore `.dev.vars`
- Debug console logging in `AuthButtons.client.vue`, `server/auth.ts`, `server/api/auth/[...].ts`, `server/utils/database.ts` was removed after verification
