import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull()
})
