<script setup lang="ts">
import { Editor, EditorContent } from '@tiptap/vue-3'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { CodeBlockShiki } from '~/extensions/codeBlockShiki'
import { MermaidBlock } from '~/extensions/mermaidBlock'
import { RawHtmlText } from '~/extensions/rawHtmlText'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'

type DocItem = {
  id: string
  title: string
  content: string
  updated_at: number
}

const editor = shallowRef<Editor | null>(null)

const docs = ref<DocItem[]>([])
const currentDocId = ref<string>('')
const title = ref('Untitled Document')
const markdown = ref('')
const previewHtml = ref('')
const previewRef = ref<HTMLElement | null>(null)

const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const saveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const pendingMarkdown = ref<string | null>(null)
let activeSave: Promise<void> | null = null

const canExportPdf = computed(() => Boolean(previewRef.value))

const { renderToHtml, renderMermaidIn } = useMarkdownRenderer()

function makeId() {
  return crypto.randomUUID()
}

async function listDocuments() {
  const response = await $fetch<{ documents: DocItem[] }>('/api/documents')
  docs.value = response.documents
}

async function loadDocument(id: string) {
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
  if (!currentDocId.value) {
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
  pendingMarkdown.value = content

  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  saveTimer.value = setTimeout(() => {
    void flushSaveQueue()
  }, 5000)
}

async function flushSaveQueue() {
  if (activeSave) {
    return
  }

  while (pendingMarkdown.value !== null) {
    const nextContent = pendingMarkdown.value
    pendingMarkdown.value = null

    if (typeof nextContent !== 'string') {
      continue
    }

    activeSave = saveDocument(nextContent)
      .catch(() => {
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

async function createDocument() {
  const id = makeId()
  const now = Date.now()
  const doc: DocItem = {
    id,
    title: 'Untitled Document',
    content: '',
    updated_at: now
  }

  await $fetch('/api/documents/' + id, {
    method: 'PUT',
    body: {
      title: doc.title,
      content: doc.content
    }
  })

  await listDocuments()
  await loadDocument(id)
}

async function exportPdf() {
  if (!canExportPdf.value || !previewRef.value) {
    return
  }

  await nextTick()

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

  const html2pdfModule = await import('html2pdf.js')
  const html2pdf = (html2pdfModule.default || html2pdfModule) as any

  await html2pdf()
    .set({
      margin: [12, 12],
      filename: `${title.value || 'document'}.pdf`,
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    })
    .from(previewRef.value)
    .save()
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
  const tableMarkdown = [
    '',
    '| Column 1 | Column 2 | Column 3 |',
    '| --- | --- | --- |',
    '| Row 1 |  |  |',
    '| Row 2 |  |  |',
    '| Row 3 |  |  |',
    ''
  ].join('\n')

  editor.value?.chain().focus().insertContent(tableMarkdown).run()
}

async function bootstrap() {
  await listDocuments()

  if (docs.value.length === 0) {
    await createDocument()
  } else {
    await loadDocument(docs.value[0].id)
  }

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
      MermaidBlock
    ],
    editorProps: {
      transformPastedHTML: () => ''
    },
    onUpdate: ({ editor: current }) => {
      markdown.value = current.getMarkdown()
      scheduleSave(markdown.value)
      void refreshPreview()
    }
  })
}

onMounted(async () => {
  await bootstrap()
})

onBeforeUnmount(() => {
  if (saveTimer.value) {
    clearTimeout(saveTimer.value)
  }

  editor.value?.destroy()
})

watch(currentDocId, async (id, previousId) => {
  if (!id || id === previousId) {
    return
  }

  await loadDocument(id)
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-1.5rem)] flex-col gap-3">
    <header class="flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center">
      <select
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
        class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        @click="createDocument"
      >
        New
      </button>

      <button
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        :disabled="!canExportPdf"
        @click="exportPdf"
      >
        PDF
      </button>

      <span class="text-xs text-neutral-500">{{ saveState }}</span>
    </header>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      <section class="min-h-0 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div class="mb-2 flex gap-2">
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
            Table 3x3
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
