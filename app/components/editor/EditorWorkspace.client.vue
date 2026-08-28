<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextSelection } from '@tiptap/pm/state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { CodeBlockShiki } from '~/extensions/codeBlockShiki'
import { MarkdownTableBlock } from '~/extensions/markdownTableBlock'
import { MermaidBlock } from '~/extensions/mermaidBlock'
import { SvgBlock } from '~/extensions/svgBlock'
import { HtmlBlock } from '~/extensions/htmlBlock'
import { RawHtmlText } from '~/extensions/rawHtmlText'
import { AiGhostText } from '~/extensions/aiGhostText'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'
import { getPastedMarkdownTable } from '~/utils/markdownTablePaste'
import { serializeWithAlignment, extractAlignment, applyAlignmentDirectives, expandBlankRunsForParse, normalizeMarkdownForStorage } from '~/utils/markdownAlignment'
import { authClient } from '~/lib/auth-client'

type DocumentFormat = 'markdown' | 'typst'

type DocItem = {
  id: string
  title: string
  content: string
  format?: DocumentFormat
  shareToken?: string | null
  isShared?: boolean
  updated_at: number
  revision?: number
  checkpoints?: Array<{ id: string, label: string, title: string, format: DocumentFormat, savedAt: number, size: number }>
  hasPrevious?: boolean
}

type UserTier = 'free' | 'starter' | 'pro'
type AppMode = 'public' | UserTier

const TYPST_STARTER = '= Untitled Document\n\nStart writing your Typst document here.\n'

const publicDraftTitle = useState<string>('public-draft-title', () => 'Untitled Document')
const publicDraftMarkdown = useState<string>('public-draft-markdown', () => '')

const editor = shallowRef<Editor | null>(null)

const docs = ref<DocItem[]>([])
const currentDocId = ref<string>('')
const title = ref('Untitled Document')
const markdown = ref('')
const previewHtml = ref('')
const previewRef = ref<HTMLElement | null>(null)
const uploadInputRef = ref<HTMLInputElement | null>(null)

const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const freeTierMessage = ref('')
const userTier = ref<UserTier>('free')
const docFormat = ref<DocumentFormat>('markdown')
const exportingPdf = ref(false)
const typstError = ref('')
const revision = ref(0)
const checkpoints = ref<NonNullable<DocItem['checkpoints']>>([])
const hasPrevious = ref(false)
const checkpointBusy = ref(false)
const checkpointMessage = ref('')

const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const pendingMarkdown = ref<string | null>(null)
const showPreview = ref(true)
// True while programmatically applying document content (load/upload/mode
// switch). Guards the save path so a mere refresh can never re-serialize and
// persist content — the corruption loop that degraded documents over reloads.
const isApplyingContent = ref(false)
let activeSave: Promise<void> | null = null
let saveGeneration = 0
let activeModeKey = ''
let onThemeChanged: (() => void) | null = null
let previewRevision = 0

// Public share-link state for the current document
const runtimeConfig = useRuntimeConfig()
const shareToken = ref('')
const isShared = ref(false)
const shareOpen = ref(false)
const shareBusy = ref(false)
const shareMessage = ref('')
const shareCopied = ref(false)
const shareSlug = ref('')
let shareCopiedTimer: ReturnType<typeof setTimeout> | null = null

const sessionState = authClient.useSession()
const isLoaded = computed(() => !sessionState.value?.isPending)
const isSignedIn = computed(() => Boolean(sessionState.value?.data?.user))
const userId = computed(() => sessionState.value?.data?.user?.id ?? '')
const { renderToHtml, renderMermaidIn } = useMarkdownRenderer()

const canExportPdf = computed(() => {
  if (docFormat.value === 'typst') {
    return isAuthenticatedMode.value && Boolean(currentDocId.value)
  }
  return Boolean(previewRef.value)
})
const aiGhostEnabled = ref(true)
const mode = computed<AppMode>(() => {
  if (!isLoaded.value || !isSignedIn.value) {
    return 'public'
  }
  return userTier.value
})
const isPublicMode = computed(() => mode.value === 'public')
const isAuthenticatedMode = computed(() => !isPublicMode.value)
const canCreateDocument = computed(() => {
  if (isPublicMode.value) {
    return true
  }
  if (userTier.value === 'free') {
    return docs.value.length < 3
  }
  if (userTier.value === 'starter') {
    return docs.value.length < 15
  }
  return true
})

// Only saved, authenticated markdown documents can be shared (anonymous
// public-mode docs are never persisted server-side)
const canShare = computed(() => isAuthenticatedMode.value && Boolean(currentDocId.value) && docFormat.value === 'markdown')
const shareUrl = computed(() => {
  if (!isShared.value || !shareToken.value) {
    return ''
  }
  const siteUrl = String(runtimeConfig.public.siteUrl || '').replace(/\/+$/, '')
  return siteUrl ? `${siteUrl}/p/${shareToken.value}` : ''
})

function makeId() {
  return crypto.randomUUID()
}

async function listDocuments() {
  if (isPublicMode.value) {
    return
  }

  const response = await $fetch<{ documents: DocItem[], user: { id: string, tier: UserTier } }>('/api/documents')
  docs.value = response.documents
  userTier.value = response.user.tier
}

async function loadDocument(id: string) {
  if (isPublicMode.value) {
    return
  }

  const response = await $fetch<{ document: DocItem }>('/api/documents/' + id)
  currentDocId.value = response.document.id
  title.value = response.document.title
  docFormat.value = response.document.format === 'typst' ? 'typst' : 'markdown'
  revision.value = Number(response.document.revision ?? 0)
  checkpoints.value = response.document.checkpoints || []
  hasPrevious.value = response.document.hasPrevious === true
  typstError.value = ''

  // Alignments live in one trailing marker line; strip it for the editor and
  // re-apply as node attributes. Everything else passes through byte-for-byte.
  const normalizedRaw = normalizeMarkdownForStorage(response.document.content)
  const { clean, directives } = extractAlignment(normalizedRaw)
  markdown.value = normalizedRaw

  // Share state for the newly opened document
  shareToken.value = response.document.shareToken || ''
  isShared.value = response.document.isShared === true
  shareSlug.value = isShared.value ? (response.document.shareToken || '') : ''
  shareOpen.value = false
  shareMessage.value = ''

  // Typst source must never pass through the TipTap editor: its markdown
  // serializer would rewrite (and corrupt) the .typ syntax.
  if (editor.value && docFormat.value === 'markdown') {
    isApplyingContent.value = true
    try {
      editor.value.commands.setContent(expandBlankRunsForParse(clean), { contentType: 'markdown' })
      applyAlignmentDirectives(editor.value, directives)
    } finally {
      isApplyingContent.value = false
    }
    // Do NOT re-serialize here. TipTap's whitespace normalization can silently
    // alter the content, causing blank lines to drift on every open/refresh.
    // markdown.value already holds the canonical pre-load string; onUpdate will
    // update it the first time the user actually edits the document.
  }

  if (docFormat.value === 'markdown') {
    await refreshPreview()
  }
}

async function saveDocument(content: string) {
  if (isPublicMode.value || !currentDocId.value) {
    return
  }

  saveState.value = 'saving'

  const generation = saveGeneration
  const response = await $fetch<{ document?: { revision?: number, hasPrevious?: boolean, checkpoints?: NonNullable<DocItem['checkpoints']> } }>('/api/documents/' + currentDocId.value, {
    method: 'PUT',
    body: {
      title: title.value,
      content,
      format: docFormat.value,
      baseRevision: revision.value
    }
  })

  if (response.document?.revision !== undefined) revision.value = response.document.revision
  if (response.document?.hasPrevious !== undefined) hasPrevious.value = response.document.hasPrevious
  if (response.document?.checkpoints) checkpoints.value = response.document.checkpoints

  saveState.value = 'saved'
  if (generation === saveGeneration) await listDocuments()
}

async function setDocumentFormat(format: DocumentFormat) {
  if (docFormat.value === format) {
    return
  }

  docFormat.value = format
  typstError.value = ''

  // Keep the current source intact while changing the editor surface. This
  // lets users move between the two views without losing work; the selected
  // format is saved with authenticated documents along with the source.
  if (isAuthenticatedMode.value && currentDocId.value) {
    scheduleSave(markdown.value)
  }

  if (format === 'markdown') {
    await nextTick()
    await refreshPreview()
  }
}

function scheduleSave(content: string) {
  if (isPublicMode.value || !currentDocId.value) {
    return
  }

  pendingMarkdown.value = content

  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  saveTimer.value = setTimeout(() => {
    void flushSaveQueue()
  }, 5000)
}

async function flushSaveQueue() {
  if (isPublicMode.value || activeSave) {
    return
  }

  while (pendingMarkdown.value !== null) {
    const nextContent = pendingMarkdown.value
    pendingMarkdown.value = null

    if (typeof nextContent !== 'string') {
      continue
    }

    activeSave = saveDocument(nextContent)
      .catch((error: any) => {
        if (error?.data?.code === 'FREE_TIER_LIMIT_REACHED' || error?.statusMessage === 'Free tier limit reached') {
          freeTierMessage.value = 'Free tier limit reached'
        }
        saveState.value = 'error'
      })
      .finally(() => {
        activeSave = null
      })

    await activeSave
  }
}

async function refreshPreview() {
  const revision = ++previewRevision
  const html = await renderToHtml(markdown.value)
  if (revision !== previewRevision) {
    return
  }

  previewHtml.value = html
  await nextTick()

  if (previewRef.value) {
    await renderMermaidIn(previewRef.value)
  }
}

function resetShareState() {
  shareToken.value = ''
  isShared.value = false
  shareOpen.value = false
  shareMessage.value = ''
  shareBusy.value = false
  shareSlug.value = ''
}

async function postShare(enabled: boolean, rotate = false, slug?: string) {
  if (!canShare.value || shareBusy.value) {
    return
  }

  shareBusy.value = true
  shareMessage.value = ''

  try {
    const requestBody: { enabled: boolean, rotate?: boolean, slug?: string } = { enabled }
    if (rotate) {
      requestBody.rotate = true
    }
    if (slug !== undefined && slug.length > 0) {
      requestBody.slug = slug
    }

    const response = await $fetch<{ isShared: boolean, token: string | null, url: string | null }>(
      `/api/documents/${currentDocId.value}/share`,
      { method: 'POST', body: requestBody }
    )

    isShared.value = !!response.isShared
    shareToken.value = response.token || ''
  } catch (error: any) {
    shareMessage.value = error?.data?.statusMessage || error?.message || 'Share action failed'
  } finally {
    shareBusy.value = false
  }
}

async function copyShareUrl() {
  if (!shareUrl.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(shareUrl.value)
  } catch {
    // Fallback for non-secure-context/denied clipboard API
    const input = document.createElement('input')
    input.value = shareUrl.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
  }

  shareCopied.value = true
  if (shareCopiedTimer) {
    clearTimeout(shareCopiedTimer)
  }
  shareCopiedTimer = setTimeout(() => {
    shareCopied.value = false
    shareCopiedTimer = null
  }, 1500)
}

async function createDocumentAuthenticated(format: DocumentFormat = 'markdown') {
  const id = makeId()
  const now = Date.now()
  const startingContent = format === 'typst' ? TYPST_STARTER : ''
  const doc: DocItem = {
    id,
    title: 'Untitled Document',
    content: startingContent,
    format,
    updated_at: now
  }

  try {
    await $fetch('/api/documents/' + id, {
      method: 'PUT',
      body: {
        title: doc.title,
        content: doc.content,
        format
      }
    })
  } catch (error: any) {
    if (error?.data?.code === 'FREE_TIER_LIMIT_REACHED' || error?.statusMessage === 'Free tier limit reached') {
      freeTierMessage.value = 'Free tier limit reached'
      return
    }
    throw error
  }

  docFormat.value = format
  markdown.value = startingContent

  await listDocuments()
  await loadDocument(id)
}

async function createLocalDocument() {
  docs.value = []
  currentDocId.value = ''
  title.value = 'Untitled Document'
  markdown.value = ''
  revision.value = 0
  checkpoints.value = []
  hasPrevious.value = false
  docFormat.value = 'markdown'
  typstError.value = ''
  saveState.value = 'idle'
  freeTierMessage.value = ''
  pendingMarkdown.value = null
  resetShareState()

  if (editor.value) {
    editor.value.commands.setContent('', { contentType: 'markdown' })
  }

  publicDraftTitle.value = title.value
  publicDraftMarkdown.value = markdown.value

  await refreshPreview()
}

async function createDocument(format: DocumentFormat = 'markdown') {
  if (isPublicMode.value) {
    await createLocalDocument()
    return
  }

  await createDocumentAuthenticated(format)
}

async function exportPdf() {
  if (!canExportPdf.value || !previewRef.value) {
    return
  }

  const html2pdfModule = await import('html2pdf.js')
  const html2pdf = (html2pdfModule.default || html2pdfModule) as any
  const wasDark = document.documentElement.classList.contains('dark')

  try {
    if (wasDark) {
      document.documentElement.classList.remove('dark')
      await refreshPreview()
      await nextTick()
    }

    let attempts = 0
    while (attempts < 40) {
      const mermaidBlocks = previewRef.value.querySelectorAll('.mermaid').length
      const mermaidSvgs = previewRef.value.querySelectorAll('.mermaid svg').length

      if (mermaidBlocks === mermaidSvgs) {
        break
      }

      attempts += 1
      await new Promise((resolve) => setTimeout(resolve, 100))
      await nextTick()
    }

    await html2pdf()
      .set({
        margin: [12, 12],
        filename: `${title.value || 'document'}.pdf`,
        html2canvas: {
          scale: 2,
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .from(previewRef.value)
      .save()

  } finally {
    if (wasDark) {
      document.documentElement.classList.add('dark')
      await refreshPreview()
    }
  }
}

async function exportTypstPdf() {
  if (!currentDocId.value || exportingPdf.value) {
    return
  }

  exportingPdf.value = true
  typstError.value = ''

  try {
    await flushSaveQueue()

    const response = await $fetch.raw<Blob>('/api/export/pdf', {
      method: 'POST',
      body: { documentId: currentDocId.value },
      responseType: 'blob'
    })

    const blob = response._data
    if (!(blob instanceof Blob)) {
      throw new Error('Unexpected PDF response')
    }

    const safeName = (title.value || 'document').trim().replace(/[\\/:*?"<>|]+/g, '_')
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeName || 'document'}.pdf`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  } catch (error: any) {
    const detail = error?.data?.data?.detail ?? error?.data?.detail
    typstError.value = detail
      ? `Compilation failed: ${detail}`
      : (error?.statusMessage || error?.message || 'PDF export failed')
  } finally {
    exportingPdf.value = false
  }
}

function exportPdfForCurrentDoc() {
  if (docFormat.value === 'typst') {
    void exportTypstPdf()
    return
  }

  void exportPdf()
}

function onTypstSourceInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  markdown.value = value

  if (isAuthenticatedMode.value && currentDocId.value) {
    scheduleSave(value)
  }
}

function insertMermaidBlock() {
  editor.value?.chain().focus().insertContent({
    type: 'mermaidBlock',
    attrs: {
      code: 'graph TD\n  A[Start] --> B[End]'
    }
  }).run()
}

function insertSvgBlock() {
  editor.value?.chain().focus().insertContent({
    type: 'svgBlock',
    attrs: {
      code: '<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="60" cy="30" r="20" fill="currentColor" />\n</svg>'
    }
  }).run()
}

function insertHtmlBlock() {
  editor.value?.chain().focus().insertContent({
    type: 'htmlBlock',
    attrs: {
      html: '<div style="display:flex;gap:8px">\n  <div style="flex:1;padding:8px;background:#e5e7eb;border-radius:6px">Column A</div>\n  <div style="flex:1;padding:8px;background:#e5e7eb;border-radius:6px">Column B</div>\n</div>'
    }
  }).run()
}

async function prepareDocumentMutation() {
  if (activeSave) {
    await activeSave
  }
  saveGeneration += 1
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
    saveTimer.value = null
  }
  pendingMarkdown.value = null
}

async function saveCheckpoint() {
  if (!isAuthenticatedMode.value || !currentDocId.value || checkpointBusy.value) return
  const label = window.prompt('Checkpoint label (optional)', '')
  if (label === null) return
  checkpointBusy.value = true
  checkpointMessage.value = ''
  try {
    const result = await $fetch<{ checkpoints: NonNullable<DocItem['checkpoints']>, revision: number }>(`/api/documents/${currentDocId.value}/checkpoints`, {
      method: 'POST', body: { label, baseRevision: revision.value, clientRequestId: crypto.randomUUID() }
    })
    checkpoints.value = result.checkpoints
    revision.value = result.revision
  } catch (error: any) {
    checkpointMessage.value = error?.data?.statusMessage || error?.message || 'Checkpoint failed'
  } finally { checkpointBusy.value = false }
}

async function restoreCheckpoint(id: string) {
  if (!currentDocId.value || checkpointBusy.value) return
  checkpointBusy.value = true
  checkpointMessage.value = ''
  try {
    await prepareDocumentMutation()
    await $fetch(`/api/documents/${currentDocId.value}/checkpoints/${id}/restore`, { method: 'POST', body: { baseRevision: revision.value } })
    await loadDocument(currentDocId.value)
  } catch (error: any) {
    checkpointMessage.value = error?.data?.statusMessage || error?.message || 'Restore failed'
  } finally { checkpointBusy.value = false }
}

async function restorePrevious() {
  if (!currentDocId.value || !hasPrevious.value || checkpointBusy.value) return
  checkpointBusy.value = true
  checkpointMessage.value = ''
  try {
    await prepareDocumentMutation()
    await $fetch(`/api/documents/${currentDocId.value}/restore-previous`, { method: 'POST', body: { baseRevision: revision.value } })
    await loadDocument(currentDocId.value)
  } catch (error: any) {
    checkpointMessage.value = error?.data?.statusMessage || error?.message || 'Undo failed'
  } finally { checkpointBusy.value = false }
}

async function deleteCheckpoint(id: string) {
  if (!currentDocId.value || checkpointBusy.value) return
  checkpointBusy.value = true
  try {
    const result = await $fetch<{ checkpoints: NonNullable<DocItem['checkpoints']>, revision: number }>(`/api/documents/${currentDocId.value}/checkpoints/${id}`, { method: 'DELETE', body: { baseRevision: revision.value } })
    checkpoints.value = result.checkpoints
    revision.value = result.revision
  } catch (error: any) { checkpointMessage.value = error?.data?.statusMessage || error?.message || 'Delete checkpoint failed' }
  finally { checkpointBusy.value = false }
}

async function deleteCurrentDocument() {
  if (!isAuthenticatedMode.value || !currentDocId.value || checkpointBusy.value) return
  if (!window.confirm('Delete this document permanently?')) return
  checkpointBusy.value = true
  try {
    await prepareDocumentMutation()
    await $fetch(`/api/documents/${currentDocId.value}`, { method: 'DELETE' })
    currentDocId.value = ''
    checkpoints.value = []
    hasPrevious.value = false
    await listDocuments()
    if (docs.value.length > 0 && docs.value[0]) await loadDocument(docs.value[0].id)
    else await createLocalDocument()
  } catch (error: any) { checkpointMessage.value = error?.data?.statusMessage || error?.message || 'Delete failed' }
  finally { checkpointBusy.value = false }
}

function insertParagraphBelowCurrentBlock() {
  editor.value?.chain().focus().command(({ state, dispatch }) => {
    const { $from } = state.selection
    const depth = $from.depth > 0 ? $from.depth : 0
    const insertPos = depth > 0 ? $from.after(depth) : state.doc.content.size
    const paragraph = state.schema.nodes.paragraph?.create()

    if (!paragraph) {
      return false
    }

    const tr = state.tr.insert(insertPos, paragraph)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))
    dispatch?.(tr.scrollIntoView())
    return true
  }).run()
}

function insertCodeBlock() {
  if (!editor.value) {
    return
  }

  if (!editor.value.isActive('codeBlock') && !editor.value.isActive('mermaidBlock')) {
    editor.value.chain().focus().setCodeBlock({ language: 'javascript' }).run()
    return
  }

  editor.value.chain().focus().command(({ state, dispatch }) => {
    const { $from } = state.selection
    const depth = $from.depth > 0 ? $from.depth : 0
    const insertPos = depth > 0 ? $from.after(depth) : state.doc.content.size
    const codeBlockNode = state.schema.nodes.codeBlock?.create({ language: 'javascript' })

    if (!codeBlockNode) {
      return false
    }

    const tr = state.tr.insert(insertPos, codeBlockNode)
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)))
    dispatch?.(tr.scrollIntoView())
    return true
  }).run()
}

function insertTable3x3() {
  const snippet = [
    '| Column 1 | Column 2 | Column 3 |',
    '| --- | --- | --- |',
    '| Row 1 |  |  |',
    '| Row 2 |  |  |',
    '| Row 3 |  |  |'
  ].join('\n')

  editor.value?.chain().focus().insertContent({
    type: 'markdownTable',
    content: [{ type: 'text', text: snippet }]
  }).run()
}

function triggerMarkdownUpload() {
  if (isPublicMode.value || docFormat.value === 'typst') {
    return
  }

  uploadInputRef.value?.click()
}

function toggleAiGhost() {
  if (isPublicMode.value) {
    return
  }

  aiGhostEnabled.value = !aiGhostEnabled.value
  editor.value?.commands.setAiGhostTextEnabled(aiGhostEnabled.value)
}

function togglePreview() {
  showPreview.value = !showPreview.value
  if (import.meta.client) {
    window.localStorage.setItem('show-preview-pane', showPreview.value ? '1' : '0')
  }
}

async function onMarkdownFileSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  const content = normalizeMarkdownForStorage(await file.text())
  markdown.value = content

  if (docFormat.value === 'typst') {
    if (isAuthenticatedMode.value && currentDocId.value) {
      scheduleSave(content)
    }

    if (input) {
      input.value = ''
    }
    return
  }

  if (editor.value) {
    const { clean, directives } = extractAlignment(content)
    isApplyingContent.value = true
    try {
      editor.value.commands.setContent(expandBlankRunsForParse(clean), { contentType: 'markdown' })
      applyAlignmentDirectives(editor.value, directives)
    } finally {
      isApplyingContent.value = false
    }
    // Do NOT re-serialize after setContent — keep markdown.value equal to the
    // normalized uploaded content. Re-serializing here would let TipTap mutate
    // the content before the first user edit, adding phantom blank lines.
  }

  if (isAuthenticatedMode.value && currentDocId.value) {
    scheduleSave(markdown.value)
  }
  await refreshPreview()

  if (input) {
    input.value = ''
  }
}

function downloadSource() {
  if (!import.meta.client || isPublicMode.value) {
    return
  }

  const isTypst = docFormat.value === 'typst'
  const blob = new Blob([markdown.value], {
    type: isTypst ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeName = (title.value || 'document').trim().replace(/[\\/:*?"<>|]+/g, '_')

  anchor.href = url
  anchor.download = `${safeName || 'document'}${isTypst ? '.typ' : '.md'}`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function setLink() {
  if (!editor.value) {
    return
  }
  const previous = editor.value.getAttributes('link').href as string | undefined
  const href = window.prompt('Link URL', previous || 'https://')
  if (href === null) {
    return
  }
  if (href.trim() === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
}

function initializeEditor() {
  // Initial content goes through the same pipeline as loadDocument: strip the
  // alignment marker and expand blank-line runs from older saves into the
  // canonical lossless form before the markdown parser sees them.
  const { clean: initialClean, directives } = extractAlignment(normalizeMarkdownForStorage(markdown.value))
  editor.value = new Editor({
    contentType: 'markdown',
    content: expandBlankRunsForParse(initialClean),
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: {
          markdownLinks: true
        }
      }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: false
        }
      }),
      HtmlBlock,
      SvgBlock,
      MermaidBlock,
      CodeBlockShiki,
      MarkdownTableBlock,
      AiGhostText,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right'],
        defaultAlignment: 'left'
      })
    ],
    editorProps: {
      transformPastedHTML: () => '',
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')
        if (typeof text !== 'string' || text.length === 0) {
          return false
        }

        event.preventDefault()
        const { from, to } = view.state.selection
        const table = getPastedMarkdownTable(text)
        if (table) {
          const tableType = view.state.schema.nodes.markdownTable
          if (tableType) {
            const tableNode = tableType.create(null, view.state.schema.text(table))
            view.dispatch(view.state.tr.replaceSelectionWith(tableNode).scrollIntoView())
            return true
          }
        }
        view.dispatch(view.state.tr.insertText(text, from, to))
        return true
      }
    },
    onUpdate: ({ editor: current }) => {
      // Programmatic content application (load/upload/restore) must never
      // trigger a save: saving on load was the loop that progressively degraded
      // documents over refreshes.
      if (isApplyingContent.value) {
        return
      }
      markdown.value = serializeWithAlignment(current as any)
      if (isAuthenticatedMode.value) {
        scheduleSave(markdown.value)
      } else {
        publicDraftTitle.value = title.value
        publicDraftMarkdown.value = markdown.value
        saveState.value = 'idle'
      }
      void refreshPreview()
    }
  })

  if (directives.length > 0 && editor.value) {
    isApplyingContent.value = true
    try {
      applyAlignmentDirectives(editor.value as any, directives)
    } finally {
      isApplyingContent.value = false
    }
  }
}

async function initializePublicMode() {
  docs.value = []
  currentDocId.value = ''
  title.value = publicDraftTitle.value
  markdown.value = publicDraftMarkdown.value
  docFormat.value = 'markdown'
  typstError.value = ''
  saveState.value = 'idle'
  freeTierMessage.value = ''
  userTier.value = 'free'
  pendingMarkdown.value = null
  resetShareState()

  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
    saveTimer.value = null
  }

  if (editor.value) {
    const { clean, directives } = extractAlignment(normalizeMarkdownForStorage(markdown.value))
    isApplyingContent.value = true
    try {
      editor.value.commands.setContent(expandBlankRunsForParse(clean), { contentType: 'markdown' })
      applyAlignmentDirectives(editor.value, directives)
    } finally {
      isApplyingContent.value = false
    }
    // Do NOT re-serialize: keep markdown.value equal to the already-normalized
    // public-draft content to prevent load-time drift.
  }

  await refreshPreview()
}

async function initializeAuthenticatedMode() {
  freeTierMessage.value = ''
  saveState.value = 'idle'
  pendingMarkdown.value = null

  await listDocuments()

  if (docs.value.length === 0) {
    await createDocumentAuthenticated()
    return
  }

  const firstDoc = docs.value[0]
  if (firstDoc) {
    await loadDocument(firstDoc.id)
  }
}

async function syncModeState() {
  if (!isLoaded.value) {
    return
  }

  const nextModeKey = isSignedIn.value ? `auth:${userId.value || 'unknown'}` : 'public'
  if (nextModeKey === activeModeKey) {
    return
  }

  const previousModeKey = activeModeKey
  activeModeKey = nextModeKey

  if (!isSignedIn.value) {
    if (previousModeKey.startsWith('auth:') || previousModeKey === '') {
      await initializePublicMode()
    } else {
      saveState.value = 'idle'
      freeTierMessage.value = ''
      userTier.value = 'free'
    }
    return
  }

  await initializeAuthenticatedMode()
}

onMounted(async () => {
  title.value = publicDraftTitle.value
  markdown.value = publicDraftMarkdown.value
  initializeEditor()
  if (import.meta.client) {
    aiGhostEnabled.value = window.localStorage.getItem('ai-ghost-enabled') !== '0'
    const savedPreview = window.localStorage.getItem('show-preview-pane')
    if (savedPreview !== null) {
      showPreview.value = savedPreview !== '0'
    }
  }
  onThemeChanged = () => {
    void refreshPreview()
  }
  window.addEventListener('theme-changed', onThemeChanged)
  await syncModeState()
})

onBeforeUnmount(() => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  if (isPublicMode.value) {
    publicDraftTitle.value = title.value
    publicDraftMarkdown.value = markdown.value
  }

  if (onThemeChanged) {
    window.removeEventListener('theme-changed', onThemeChanged)
  }

  editor.value?.destroy()
})

watch(currentDocId, async (id, previousId) => {
  if (!id || id === previousId || isPublicMode.value) {
    return
  }

  await loadDocument(id)
})

watch(title, (nextTitle) => {
  if (isPublicMode.value) {
    publicDraftTitle.value = nextTitle
  }
})

watch([isLoaded, isSignedIn, userId], async () => {
  await syncModeState()
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-1.5rem)] flex-col gap-3">
    <header class="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-if="!isPublicMode"
            class="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs font-medium dark:border-neutral-700 dark:bg-neutral-950"
          >
            <template v-if="mode === 'free'">Free</template>
            <template v-else-if="mode === 'starter'">Starter</template>
            <template v-else>Pro</template>
          </span>
          <span
            v-if="isPublicMode"
            class="text-xs text-amber-700 dark:text-amber-300"
          >
            Sign in to save changes
          </span>
        </div>

      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div
          class="inline-flex w-fit rounded-md border border-neutral-300 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950"
          role="radiogroup"
          aria-label="Editor format"
        >
          <button
            type="button"
            role="radio"
            :aria-checked="docFormat === 'markdown'"
            class="rounded px-3 py-1 text-sm transition-colors"
            :class="docFormat === 'markdown'
              ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'"
            @click="setDocumentFormat('markdown')"
          >
            Markdown
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="docFormat === 'typst'"
            class="rounded px-3 py-1 text-sm transition-colors"
          :class="docFormat === 'typst'
              ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'"
            :disabled="!isAuthenticatedMode"
            :title="isAuthenticatedMode ? 'Use Typst format' : 'Sign in to use Typst'"
            @click="setDocumentFormat('typst')"
          >
            Typst
          </button>
        </div>

        <select
          v-if="isAuthenticatedMode"
          v-model="currentDocId"
          class="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option v-for="doc in docs" :key="doc.id" :value="doc.id">
            {{ doc.title || 'Untitled Document' }} · {{ doc.format === 'typst' ? 'Typst' : 'MD' }}
          </option>
        </select>

        <input
          v-model="title"
          type="text"
          class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >

        <button
          type="button"
          v-if="docFormat === 'markdown'"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canCreateDocument"
          title="New Markdown document"
          @click="createDocument('markdown')"
        >
          <UiIcon name="plus" />
          <span class="sr-only">New Markdown document</span>
        </button>

        <button
          v-if="isAuthenticatedMode && docFormat === 'typst'"
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canCreateDocument"
          title="Create a Typst (.typ) document compiled to PDF on export"
          @click="createDocument('typst')"
        >
          <UiIcon name="plus" />
          <span class="sr-only">New Typst document</span>
        </button>

        <button
          v-if="isAuthenticatedMode && currentDocId"
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-neutral-700"
          :disabled="checkpointBusy"
          title="Create checkpoint"
          @click="saveCheckpoint"
        >
          <UiIcon name="bookmark" />
          <span class="sr-only">Create checkpoint</span>
        </button>

        <button
          v-if="isAuthenticatedMode && currentDocId && hasPrevious"
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-neutral-700"
          :disabled="checkpointBusy"
          title="Undo last save"
          @click="restorePrevious"
        >
          <UiIcon name="undo" />
          <span class="sr-only">Undo last save</span>
        </button>

        <button
          v-if="isAuthenticatedMode && currentDocId"
          type="button"
          class="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
          :disabled="checkpointBusy"
          title="Delete document"
          @click="deleteCurrentDocument"
        >
          <UiIcon name="trash" />
          <span class="sr-only">Delete document</span>
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canExportPdf || exportingPdf"
          title="Export PDF"
          @click="exportPdfForCurrentDoc"
        >
          <UiIcon name="file" />
          <span class="sr-only">{{ exportingPdf ? 'Exporting PDF' : 'Export PDF' }}</span>
        </button>

        <button
          v-if="canShare"
          type="button"
          class="rounded-md border px-3 py-1 text-sm"
          :class="isShared
            ? 'border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300'
            : 'border-neutral-300 dark:border-neutral-700'"
          :title="isShared ? 'Sharing enabled' : 'Share document'"
          @click="shareOpen = !shareOpen"
        >
          <UiIcon name="share" />
          <span class="sr-only">{{ isShared ? 'Shared' : 'Share' }}</span>
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode || docFormat === 'typst'"
          title="Upload Markdown file"
          @click="triggerMarkdownUpload"
        >
          <UiIcon name="upload" />
          <span class="sr-only">Upload Markdown</span>
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode"
          :title="`Download ${docFormat === 'typst' ? 'Typst' : 'Markdown'} source`"
          @click="downloadSource"
        >
          <UiIcon name="download" />
          <span class="sr-only">Download {{ docFormat === 'typst' ? 'Typst' : 'Markdown' }}</span>
        </button>

        <button
          v-if="docFormat === 'markdown'"
          type="button"
          class="rounded-md border px-3 py-1 text-sm transition-colors"
          :class="showPreview
            ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
            : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'"
          :title="showPreview ? 'Hide side-by-side preview pane' : 'Show side-by-side preview pane'"
          @click="togglePreview"
        >
          <UiIcon name="eye" />
          <span class="sr-only">{{ showPreview ? 'Hide preview' : 'Show preview' }}</span>
        </button>

        <input
          ref="uploadInputRef"
          type="file"
          accept=".md,text/markdown"
          class="hidden"
          @change="onMarkdownFileSelected"
        >

        <span class="text-xs text-neutral-500">{{ saveState }}</span>
      </div>

      <div
        v-if="canShare && shareOpen"
        class="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      >
        <template v-if="isShared">
          <span class="w-full text-xs text-neutral-500 dark:text-neutral-400">
            Anyone with the link can view the rendered document — it updates automatically when you edit.
          </span>
          <div class="contents">
            <input
              :value="shareUrl"
              type="text"
              readonly
              class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              @focus="($event.target as HTMLInputElement).select()"
            >
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
              @click="copyShareUrl"
            >
              {{ shareCopied ? 'Copied!' : 'Copy' }}
            </button>
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
              title="Turn off sharing. The same URL is restored if you re-enable it."
              :disabled="shareBusy"
              @click="postShare(false)"
            >
              Disable
            </button>
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
              title="Generate a new URL. The old link stops working permanently."
              :disabled="shareBusy"
              @click="postShare(true, true)"
            >
              {{ shareBusy ? '…' : 'Rotate' }}
            </button>
          </div>
          <div class="contents">
            <span class="text-xs text-neutral-500 dark:text-neutral-400">/p/</span>
            <input
              v-model="shareSlug"
              type="text"
              class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            >
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
              title="Change the share link to this custom slug."
              :disabled="shareBusy"
              @click="postShare(true, false, shareSlug)"
            >
              {{ shareBusy ? '…' : 'Update slug' }}
            </button>
          </div>
        </template>
        <template v-else>
          <span class="w-full text-xs text-neutral-500 dark:text-neutral-400">
            Sharing is off. When enabled, anyone with the link can view the rendered document — it updates automatically when you edit.
          </span>
          <div class="contents">
            <label class="w-full text-xs text-neutral-500 dark:text-neutral-400">
              Custom link (optional)
            </label>
            <div class="contents">
              <span class="text-xs text-neutral-400">/p/</span>
              <input
                v-model="shareSlug"
                type="text"
                placeholder="doc1"
                class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              >
            </div>
            <button
                type="button"
                class="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
                :disabled="shareBusy"
                @click="postShare(true, false, shareSlug)"
              >
                {{ shareBusy ? '…' : 'Enable share link' }}
            </button>
          </div>
        </template>
        <span
          v-if="shareMessage"
          class="text-xs text-red-600 dark:text-red-400"
        >
          {{ shareMessage }}
        </span>
      </div>

      <div
        v-if="freeTierMessage"
        class="text-xs text-amber-700 dark:text-amber-300"
      >
        {{ freeTierMessage }}
      </div>

      <div
        v-if="typstError"
        class="whitespace-pre-wrap text-xs text-red-700 dark:text-red-300"
      >
        {{ typstError }}
      </div>
      <details v-if="isAuthenticatedMode && currentDocId && checkpoints.length > 0" class="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
        <summary class="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-neutral-500">
          Checkpoints <span class="normal-case tracking-normal">({{ checkpoints.length }})</span>
        </summary>
        <div v-for="checkpoint in checkpoints" :key="checkpoint.id" class="flex items-center justify-between gap-2 border-t border-neutral-200 py-1 dark:border-neutral-800">
          <span class="min-w-0 truncate">{{ checkpoint.label || 'Unnamed checkpoint' }}</span>
          <span class="flex shrink-0 gap-1">
            <button type="button" class="rounded border px-2 py-0.5 text-xs" :disabled="checkpointBusy" @click="restoreCheckpoint(checkpoint.id)">Restore</button>
            <button type="button" class="rounded border px-2 py-0.5 text-xs text-red-700" :disabled="checkpointBusy" @click="deleteCheckpoint(checkpoint.id)">Delete</button>
          </span>
        </div>
      </details>
      <div v-if="checkpointMessage" class="text-xs text-red-600 dark:text-red-400">{{ checkpointMessage }}</div>
    </header>

    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-3"
      :class="docFormat === 'markdown' && showPreview ? 'lg:grid-cols-2' : ''"
    >
      <section class="min-h-0 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div
          v-if="docFormat === 'markdown'"
          class="mb-2 flex flex-wrap gap-2"
        >
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertCodeBlock"
          >
            Code Block
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertMermaidBlock"
          >
            Mermaid
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertSvgBlock"
          >
            SVG
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertHtmlBlock"
          >
            HTML
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertParagraphBelowCurrentBlock"
          >
            Text Below
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
            @click="insertTable3x3"
          >
            Table
          </button>

          <button
            type="button"
            class="rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            :class="aiGhostEnabled
              ? 'border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-neutral-100 dark:bg-neutral-800 dark:text-neutral-100'
              : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'"
            :disabled="isPublicMode"
            :title="isPublicMode
              ? 'Sign in to use AI autocomplete'
              : (aiGhostEnabled ? 'AI autocomplete on (Tab to accept, Esc to dismiss)' : 'AI autocomplete off')"
            @click="toggleAiGhost"
          >
            AI
          </button>
        </div>

        <div
          v-if="editor && docFormat === 'markdown'"
          class="flex flex-wrap items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <button
            type="button"
            class="rounded px-2 py-1 font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('bold') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Bold"
            @click="editor.chain().focus().toggleBold().run()"
          >
            B
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 italic hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('italic') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Italic"
            @click="editor.chain().focus().toggleItalic().run()"
          >
            I
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 line-through hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('strike') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Strikethrough"
            @click="editor.chain().focus().toggleStrike().run()"
          >
            S
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 font-mono text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('code') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Inline code"
            @click="editor.chain().focus().toggleCode().run()"
          >
            `code`
          </button>

          <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

          <button
            type="button"
            class="rounded px-2 py-1 text-xs font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('heading', { level: 1 }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Heading 1"
            @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
          >
            H1
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('heading', { level: 2 }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Heading 2"
            @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
          >
            H2
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 text-xs font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('heading', { level: 3 }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Heading 3"
            @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
          >
            H3
          </button>

          <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('bulletList') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Bullet list"
            @click="editor.chain().focus().toggleBulletList().run()"
          >
            List
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('orderedList') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Numbered list"
            @click="editor.chain().focus().toggleOrderedList().run()"
          >
            Numbered
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('blockquote') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Blockquote"
            @click="editor.chain().focus().toggleBlockquote().run()"
          >
            Quote
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            title="Horizontal rule"
            @click="editor.chain().focus().setHorizontalRule().run()"
          >
            HR
          </button>

          <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive('link') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Add or edit link"
            @click="setLink()"
          >
            Link
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 disabled:opacity-50 dark:hover:bg-neutral-800"
            :class="editor.isActive('link') ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            :disabled="!editor.isActive('link')"
            title="Remove link"
            @click="editor.chain().focus().unsetLink().run()"
          >
            Unlink
          </button>

          <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive({ textAlign: 'left' }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Align left"
            @click="editor.chain().focus().setTextAlign('left').run()"
          >
            Left
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive({ textAlign: 'center' }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Align center"
            @click="editor.chain().focus().setTextAlign('center').run()"
          >
            Center
          </button>
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            :class="editor.isActive({ textAlign: 'right' }) ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500'"
            title="Align right"
            @click="editor.chain().focus().setTextAlign('right').run()"
          >
            Right
          </button>
        </div>

        <ClientOnly>
          <EditorContent
            v-if="editor && docFormat === 'markdown'"
            :editor="editor"
            class="editor-content prose prose-neutral max-w-none overflow-y-auto rounded-md border border-neutral-200 p-3 dark:prose-invert dark:border-neutral-700"
          />
          <textarea
            v-else-if="docFormat === 'typst'"
            :value="markdown"
            spellcheck="false"
            class="min-h-[24rem] w-full resize-y overflow-y-auto rounded-md border border-neutral-200 bg-white p-3 font-mono text-sm leading-relaxed outline-none dark:border-neutral-700 dark:bg-neutral-950"
            placeholder="= Your Typst document&#10;&#10;Write Typst source here, then press PDF to compile it."
            @input="onTypstSourceInput"
          />
        </ClientOnly>
      </section>

      <section
        v-if="docFormat === 'markdown' && showPreview"
        class="min-h-0 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div
          ref="previewRef"
          class="preview-content prose prose-neutral max-w-none overflow-y-auto p-3 dark:prose-invert"
          v-html="previewHtml"
        />
      </section>
    </div>
  </div>
</template>
