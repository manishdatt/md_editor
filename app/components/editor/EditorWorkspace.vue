<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useAuth } from '@clerk/nuxt/composables'
import { CodeBlockShiki } from '~/extensions/codeBlockShiki'
import { MarkdownTableBlock } from '~/extensions/markdownTableBlock'
import { MermaidBlock } from '~/extensions/mermaidBlock'
import { RawHtmlText } from '~/extensions/rawHtmlText'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'

type DocItem = {
  id: string
  title: string
  content: string
  updated_at: number
}

type UserTier = 'free' | 'paid'
type AppMode = 'public' | UserTier

const publicDraftState: {
  title: string
  markdown: string
} = {
  title: 'Untitled Document',
  markdown: ''
}

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

const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const pendingMarkdown = ref<string | null>(null)
let activeSave: Promise<void> | null = null
let activeModeKey = ''
let onThemeChanged: (() => void) | null = null

const { isLoaded, isSignedIn, userId } = useAuth()
const { renderToHtml, renderMermaidIn } = useMarkdownRenderer()

const canExportPdf = computed(() => Boolean(previewRef.value))
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
  markdown.value = response.document.content

  if (editor.value) {
    editor.value.commands.setContent(markdown.value, {
      contentType: 'markdown'
    })
  }

  await refreshPreview()
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

async function createDocumentAuthenticated() {
  const id = makeId()
  const now = Date.now()
  const doc: DocItem = {
    id,
    title: 'Untitled Document',
    content: '',
    updated_at: now
  }

  try {
    await $fetch('/api/documents/' + id, {
      method: 'PUT',
      body: {
        title: doc.title,
        content: doc.content
      }
    })
  } catch (error: any) {
    if (error?.data?.code === 'FREE_TIER_LIMIT_REACHED' || error?.statusMessage === 'Free tier limit reached') {
      freeTierMessage.value = 'Free tier limit reached'
      return
    }
    throw error
  }

  await listDocuments()
  await loadDocument(id)
}

async function createLocalDocument() {
  docs.value = []
  currentDocId.value = ''
  title.value = 'Untitled Document'
  markdown.value = ''
  saveState.value = 'idle'
  freeTierMessage.value = ''
  pendingMarkdown.value = null

  if (editor.value) {
    editor.value.commands.setContent('', { contentType: 'markdown' })
  }

  publicDraftState.title = title.value
  publicDraftState.markdown = markdown.value

  await refreshPreview()
}

async function createDocument() {
  if (isPublicMode.value) {
    await createLocalDocument()
    return
  }

  await createDocumentAuthenticated()
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
  if (isPublicMode.value) {
    return
  }

  uploadInputRef.value?.click()
}

async function onMarkdownFileSelected(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]

  if (!file) {
    return
  }

  const content = await file.text()
  markdown.value = content

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

function downloadMarkdown() {
  if (!import.meta.client || isPublicMode.value) {
    return
  }

  const blob = new Blob([markdown.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeName = (title.value || 'document').trim().replace(/[\\/:*?"<>|]+/g, '_')

  anchor.href = url
  anchor.download = `${safeName || 'document'}.md`
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
      MermaidBlock
    ],
    editorProps: {
      transformPastedHTML: () => ''
    },
    onUpdate: ({ editor: current }) => {
      markdown.value = current.getMarkdown()
      if (isAuthenticatedMode.value) {
        scheduleSave(markdown.value)
      } else {
        publicDraftState.title = title.value
        publicDraftState.markdown = markdown.value
        saveState.value = 'idle'
      }
      void refreshPreview()
    }
  })
}

async function initializePublicMode() {
  docs.value = []
  currentDocId.value = ''
  title.value = publicDraftState.title
  markdown.value = publicDraftState.markdown
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
  initializeEditor()
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
    publicDraftState.title = title.value
    publicDraftState.markdown = markdown.value
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
    publicDraftState.title = nextTitle
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
          @click="createDocument"
        >
          New
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="!canExportPdf"
          @click="exportPdf"
        >
          PDF
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode"
          @click="triggerMarkdownUpload"
        >
          Upload .md
        </button>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700"
          :disabled="isPublicMode"
          @click="downloadMarkdown"
        >
          Download .md
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
    </header>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      <section class="min-h-0 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div class="mb-2 flex flex-wrap gap-2">
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
        </div>

        <ClientOnly>
          <EditorContent
            v-if="editor"
            :editor="editor"
            class="editor-content prose prose-neutral max-w-none overflow-y-auto rounded-md border border-neutral-200 p-3 dark:prose-invert dark:border-neutral-700"
          />
        </ClientOnly>
      </section>

      <section class="min-h-0 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div
          ref="previewRef"
          class="preview-content prose prose-neutral max-w-none overflow-y-auto p-3 dark:prose-invert"
          v-html="previewHtml"
        />
      </section>
    </div>
  </div>
</template>
