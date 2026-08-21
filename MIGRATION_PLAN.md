# Migration Plan: Turso DB + Better Auth

## 1. Goal
- Replace NuxtHub **D1** with **Turso (libSQL)** as the persistent database.
- Replace **Clerk** with **Better Auth** (social logins: Google + GitHub), where first login auto-creates an account and subsequent logins link to the same account.
- Enforce **per-tier storage limits** (free vs paid) on saved documents.

## 2. Architecture (recommended)
A single Turso database, accessed through **one Drizzle ORM instance**, is shared by both:

```
Turso (libSQL, https URL)
├── Better Auth  → Drizzle adapter (drizzle-orm/libsql)
│     tables: user, session, account, verification
│     user.tier column (default 'free')   ← tier lives here
└── App          → same Drizzle instance
      documents table (schema unchanged)
```

One database, one ORM, one connection. No second datastore to manage.

## 3. Feasibility verdict
| Change | Feasibility | Effort |
|---|---|---|
| Turso DB swap | Easy | ~½ day |
| Storage-tier enforcement | Easy | ~½ day |
| Clerk → Better Auth | Feasible | ~1–2 days |

**Key advantage:** no DB is connected yet and there are no real users → **zero data migration**. Clerk can simply be deleted.

## 4. What you need to provide (keys / credentials)

### Turso
| Item | How to get it | Env var name | Where to put |
|---|---|---|---|
| Turso account + DB | Sign up at turso.tech, create a database | — | — |
| Database URL | Shown in Turso dashboard (`https://<db>-<org>.turso.io`) | `TURSO_URL` | `.env` (local) + Cloudflare encrypted env (prod) |
| Auth token | `turso db tokens create <db-name>` or dashboard | `TURSO_AUTH_TOKEN` | same as above |

> Use the **`https://`** URL (HTTP driver, Workers-safe). Never a `file:` URL.

### Better Auth
| Item | How to get it | Env var name |
|---|---|---|
| Session secret | `npx @better-auth/cli secret` (or `openssl rand -base64 32`) | `BETTER_AUTH_SECRET` |
| Base URL (optional) | Your production domain, e.g. `https://shbd.bioinfo.guru` | `BETTER_AUTH_URL` |

### Google OAuth (social login)
| Item | How to get it | Env var name |
|---|---|---|
| Client ID | Google Cloud Console → OAuth consent screen + Credentials → OAuth client ID (Web) | `GOOGLE_CLIENT_ID` |
| Client secret | Same page | `GOOGLE_CLIENT_SECRET` |
| Redirect URI to register | `https://<yourdomain>/api/auth/callback/google` | — |
| JS origin to register | `https://<yourdomain>` | — |

### GitHub OAuth (social login)
| Item | How to get it | Env var name |
|---|---|---|
| Client ID | GitHub → Settings → Developer settings → OAuth Apps → New | `GITHUB_CLIENT_ID` |
| Client secret | Generated on the same screen | `GITHUB_CLIENT_SECRET` |
| Callback URL to register | `https://<yourdomain>/api/auth/callback/github` | — |

### No longer needed (can remove)
- `@clerk/nuxt` and all `NUXT_CLERK_*` env vars
- The D1 binding (`[[d1_databases]]` in `wrangler.toml`) and `hub: { db }` in `nuxt.config.ts`

> All the above secrets go into **`.env` for local** and **Cloudflare encrypted environment variables for prod** — never in `wrangler.toml` (it's committed to git).

## 5. Implementation steps

### Step 1 — Turso DB swap
- Add deps: `@libsql/client`, `drizzle-orm` (already present; add `drizzle-orm/libsql` export usage).
- Rewrite `server/utils/database.ts`: replace `import { db } from 'hub:db'` with a Turso-backed Drizzle singleton using `createClient({ url: env.TURSO_URL, authToken: env.TURSO_AUTH_TOKEN })`.
- Keep `server/db/schema.ts` unchanged; keep `ensureSchema()` raw `CREATE TABLE IF NOT EXISTS`.
- Remove `hub: { db: 'sqlite' }` from `nuxt.config.ts`; remove `[[d1_databases]]` from `wrangler.toml`. (Optional: remove `@nuxthub/core` if unused elsewhere.)
- Verify documents CRUD still works.

### Step 2 — Storage-tier enforcement
- In `server/api/documents/[id].put.ts`, replace the "max 3 docs" check with a byte budget:
  `SELECT SUM(LENGTH(content)) ... WHERE owner_id = ?` compared to `quotaFor(tier)`.
- Proposed defaults: free = **2 MB**, paid = **50 MB** (tune to your pricing).
- Return `413` / a `QUOTA_EXCEEDED` code when over budget.

### Step 3 — Better Auth (replace Clerk)
- Add `server/api/auth/[...].ts`: `return auth.handler(toWebRequest(event))`.
- Create `auth` instance with `socialProviders: { github, google }`, the Drizzle adapter on Turso, `@better-auth/cloudflare` plugin, and `user.additionalFields: { tier }` (default `'free'`).
- Delete `server/middleware/clerk-documents.ts`; rewrite `server/utils/auth.ts` `requireAuthenticatedUser` to read the Better Auth session (`auth.api.getSession`) and return `{ id, tier }`.
- Client: in `app/layouts/default.vue` swap `<SignedIn>/<SignedOut>/<SignInButton>/<UserButton>` for `useSession()` + `signIn.social({ provider })`. In `app/components/editor/EditorWorkspace.vue` replace `useAuth()` (`isLoaded/isSignedIn/userId`) with Better Auth's session state.
- The `/api/ai/complete` route keeps using `requireAuthenticatedUser` (no change needed there).

### Step 4 — Social login config (external)
- Register Google + GitHub OAuth apps and add the callback/redirect URLs listed in Section 4.

## 6. Risks / gotchas
- **Cloudflare preview domains:** Better Auth cookie handling on `*.pages.dev` / preview can be finicky — test on the real domain early.
- **libSQL on Workers:** must use the HTTP driver (`https://` URL). Native `better-sqlite3` will not run on Cloudflare.
- **OAuth apps** require real-world registration (not code) — budget time for Google/GitHub console setup.
- **Existing `users` table:** drop it; tier moves onto Better Auth's `user` table to avoid duplication.
- **Secrets:** never commit; use env vars + Cloudflare encrypted secrets (same rule as your Gemini key).

## 7. Suggested order
1. Turso swap → verify CRUD
2. Storage-tier enforcement
3. Better Auth (remove Clerk, reuse Turso)
4. Social login OAuth registration
