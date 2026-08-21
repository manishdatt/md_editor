<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { CodeBlockShiki } from '~/extensions/codeBlockShiki'
import { MarkdownTableBlock } from '~/extensions/markdownTableBlock'
import { MermaidBlock } from '~/extensions/mermaidBlock'
import { RawHtmlText } from '~/extensions/rawHtmlText'
import { AiGhostText } from '~/extensions/aiGhostText'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'
import { authClient } from '~/lib/auth-client'

type DocumentFormat = 'markdown' | 'typst'

type DocItem = {
  id: string
  title: string
  content: string
  format?: DocumentFormat
  updated_at: number
}

type UserTier = 'free' | 'paid'
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

const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const pendingMarkdown = ref<string | null>(null)
let activeSave: Promise<void> | null = null
let activeModeKey = ''
let onThemeChanged: (() => void) | null = null

const { data: authSession, isPending } = authClient.useSession()
const isLoaded = computed(() => !isPending.value)
const isSignedIn = computed(() => Boolean(authSession.value?.user))
const userId = computed(() => authSession.value?.user?.id ?? '')
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
  return !(userTier.value === 'free' && docs.value.length >= 3)
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
  typstError.value = ''
  markdown.value = response.document.content

  // Typst source must never pass through the TipTap editor: its markdown
  // serializer would rewrite (and corrupt) the .typ syntax.
  if (editor.value && docFormat.value === 'markdown') {
    editor.value.commands.setContent(markdown.value, {
      contentType: 'markdown'
    })
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

  await $fetch('/api/documents/' + currentDocId.value, {
    method: 'PUT',
    body: {
      title: title.value,
      content
    }
  })

  saveState.value = 'saved'
  await listDocuments()
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
  previewHtml.value = await renderToHtml(markdown.value)
  await nextTick()

  if (previewRef.value) {
    await renderMermaidIn(previewRef.value)
  }
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
  docFormat.value = 'markdown'
  typstError.value = ''
  saveState.value = 'idle'
  freeTierMessage.value = ''
  pendingMarkdown.value = null

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
  aiGhostEnabled.value = !aiGhostEnabled.value
  editor.value?.commands.setAiGhostTextEnabled(aiGhostEnabled.value)
}

async function onMarkdownFileSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  const content = await file.text()
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
    editor.value.commands.setContent(content, { contentType: 'markdown' })
  }

  if (isAuthenticatedMode.value && currentDocId.value) {
    scheduleSave(content)
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

function initializeEditor() {
  editor.value = new Editor({
    contentType: 'markdown',
    content: markdown.value,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        codeBlock: false
      }),
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: false
        }
      }),
      RawHtmlText,
      CodeBlockShiki,
      MarkdownTableBlock,
      MermaidBlock,
      AiGhostText
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
        view.dispatch(view.state.tr.insertText(text, from, to))
        return true
      }
    },
    onUpdate: ({ editor: current }) => {
      markdown.value = current.getMarkdown()
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

  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
    saveTimer.value = null
  }

  if (editor.value) {
    editor.value.commands.setContent(markdown.value, { contentType: 'markdown' })
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

  await loadDocument(docs.value[0].id)
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
            class="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs font-medium dark:border-neutral-700 dark:bg-neutral-950"
          >
            <template v-if="mode === 'public'">Public</template>
            <template v-else-if="mode === 'free'">Free</template>
            <template v-else>Paid</template>
          </span>
          <span
            v-if="isPublicMode"
            class="text-xs text-amber-700 dark:text-amber-300"
          >
            Changes will not be saved
          </span>
        </div>

        <NuxtLink
          to="/guide"
          class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
        >
          Guide
        </NuxtLink>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          v-if="isAuthenticatedMode"
          v-model="currentDocId"
          class="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option v-for="doc in docs" :key="doc.id" :value="doc.id">
            {{ doc.title || 'Untitled Document' }}
          </option>
        </select>

        <input
          v-model="title"
          type="text"
          class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canCreateDocument"
          @click="createDocument('markdown')"
        >
          New
        </button>

        <button
          v-if="isAuthenticatedMode"
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canCreateDocument"
          title="Create a Typst (.typ) document compiled to PDF on export"
          @click="createDocument('typst')"
        >
          New Typst
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canExportPdf || exportingPdf"
          @click="exportPdfForCurrentDoc"
        >
          {{ exportingPdf ? 'PDF…' : 'PDF' }}
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode || docFormat === 'typst'"
          @click="triggerMarkdownUpload"
        >
          Upload .md
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode"
          @click="downloadSource"
        >
          {{ docFormat === 'typst' ? 'Download .typ' : 'Download .md' }}
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
    </header>

    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-3"
      :class="docFormat === 'typst' ? '' : 'lg:grid-cols-2'"
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
            class="rounded-md border px-2 py-1 text-xs"
            :class="aiGhostEnabled
              ? 'border-neutral-900 bg-neutral-100 text-neutral-900 dark:border-neutral-100 dark:bg-neutral-800 dark:text-neutral-100'
              : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'"
            :title="aiGhostEnabled ? 'AI autocomplete on (Tab to accept, Esc to dismiss)' : 'AI autocomplete off'"
            @click="toggleAiGhost"
          >
            AI
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
        v-if="docFormat === 'markdown'"
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
