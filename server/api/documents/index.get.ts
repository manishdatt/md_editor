import { desc } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async () => {
  const db = await useDatabase()
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .orderBy(desc(documents.updatedAt))

  return { documents: rows }
})
