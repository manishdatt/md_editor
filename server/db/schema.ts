import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ----- Better Auth tables -----

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  tier: text('tier').notNull().default('free'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull()
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  // Required by Better Auth 1.7+ to identify the OAuth issuer alongside the
  // provider account id (for example, google + the Google subject id).
  issuer: text('issuer').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (table) => ({
  issuerAccountIdUnique: uniqueIndex('account_issuer_account_id_unique').on(table.issuer, table.accountId)
}))

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
})

// ----- Application tables -----

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  format: text('format', { enum: ['markdown', 'typst'] }).notNull().default('markdown'),
  // shareToken uniqueness is enforced by the idx_documents_share_token index in
  // ensureSchema (SQLite allows multiple NULLs, so unshared rows never collide)
  shareToken: text('share_token'),
  isShared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull()
})
