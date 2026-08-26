import { and, eq } from 'drizzle-orm'
import { documents } from '~~/server/db/schema'
import { requireAuthenticatedUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

const MAX_SOURCE_BYTES = 512 * 1024

type ExportBody = {
  documentId?: string
}

export default defineEventHandler(async (event) => {
  const user = await requireAuthenticatedUser(event)

  const body = await readBody<ExportBody>(event)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing documentId' })
  }

  const db = await useDatabase()
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      format: documents.format
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, user.id)))
    .limit(1)

  const doc = rows[0]
  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (doc.format !== 'typst') {
    throw createError({ statusCode: 400, statusMessage: 'Document is not a Typst document' })
  }

  const contentBytes = new TextEncoder().encode(doc.content).length
  if (contentBytes === 0 || contentBytes > MAX_SOURCE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'Document content is empty or too large' })
  }

  const config = useRuntimeConfig(event)
  if (!config.pdfServiceUrl || !config.pdfServiceKey) {
    throw createError({ statusCode: 500, statusMessage: 'PDF service is not configured' })
  }

  let upstream
  try {
    upstream = await $fetch.raw(`${config.pdfServiceUrl.replace(/\/+$/, '')}/compile`, {
      method: 'POST',
      headers: { 'x-api-key': config.pdfServiceKey },
      body: { source: doc.content },
      timeout: 45_000,
      retry: 0,
      ignoreResponseError: true
    })
  } catch (error) {
    console.error('[export/pdf] PDF service request failed', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'PDF service unavailable'
    })
  }

  if (upstream.status !== 200) {
    if (upstream.status === 422) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Typst compilation failed',
        data: { detail: truncateDetail(upstream._data) }
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: 'PDF service error',
      data: { detail: truncateDetail(upstream._data), upstreamStatus: upstream.status }
    })
  }

  const rawTitle = doc.title || 'document'
  const asciiTitle = rawTitle.replace(/[^\w\-. ]+/g, '').trim() || 'document'
  const headers: Record<string, string> = {
    'Content-Type': 'application/pdf',
    'Content-Disposition':
      `attachment; filename="${asciiTitle}.pdf"; filename*=UTF-8''${encodeURIComponent(rawTitle)}.pdf`,
    'Cache-Control': 'no-store'
  }

  if (upstream.body) {
    return new Response(upstream.body, { status: 200, headers })
  }

  const buffer = await upstream.arrayBuffer()
  return new Response(buffer, { status: 200, headers })
})

function truncateDetail(data: unknown): string {
  if (data === null || data === undefined) {
    return ''
  }

  const text = typeof data === 'string' ? data : JSON.stringify(data)
  return text.slice(0, 500)
}
