import { sql } from 'drizzle-orm'
import { documents, user } from '~~/server/db/schema'
import { requireAdmin } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = await useDatabase()

  const [userAgg] = await db
    .select({
      total: sql<number>`count(*)`,
      paid: sql<number>`sum(case when ${user.tier} = 'paid' then 1 else 0 end)`,
      disabled: sql<number>`coalesce(sum(case when ${user.disabledAt} is not null then 1 else 0 end), 0)`
    })
    .from(user)

  const [docAgg] = await db
    .select({
      total: sql<number>`count(*)`,
      storageBytes: sql<number>`coalesce(sum(length(${documents.content})), 0)`,
      shared: sql<number>`coalesce(sum(case when ${documents.isShared} = 1 then 1 else 0 end), 0)`,
      typst: sql<number>`coalesce(sum(case when ${documents.format} = 'typst' then 1 else 0 end), 0)`
    })
    .from(documents)

  return {
    users: {
      total: Number(userAgg?.total ?? 0),
      paid: Number(userAgg?.paid ?? 0),
      disabled: Number(userAgg?.disabled ?? 0)
    },
    documents: {
      total: Number(docAgg?.total ?? 0),
      storageBytes: Number(docAgg?.storageBytes ?? 0),
      shared: Number(docAgg?.shared ?? 0),
      typst: Number(docAgg?.typst ?? 0)
    }
  }
})
