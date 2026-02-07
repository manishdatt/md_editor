import { eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { useDatabase } from '~~/server/utils/database'

type PutBody = {
  title?: string
  content?: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const body = await readBody<PutBody>(event)
  const title = typeof body?.title === 'string' ? body.title : 'Untitled Document'
  const content = typeof body?.content === 'string' ? body.content : ''
  const updatedAt = Date.now()

  const db = await useDatabase()
  await db
    .insert(documents)
    .values({
      id,
      title,
      content,
      updatedAt
    })
    .onConflictDoUpdate({
      target: documents.id,
      set: {
        title,
        content,
        updatedAt
      }
    })

  const row = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updated_at: documents.updatedAt
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)

  return { document: row[0] }
})
