<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'
import { normalizeMarkdownForStorage } from '~/utils/markdownAlignment'

type PublicDoc = {
  title: string
  content: string
  updated_at: number
}

const props = defineProps<{ token: string }>()
const emit = defineEmits<{ loaded: [title: string] }>()

const state = ref<'loading' | 'ready' | 'notfound' | 'error'>('loading')
const doc = ref<PublicDoc | null>(null)
const previewHtml = ref('')
const previewRef = ref<HTMLElement | null>(null)

const { renderToHtml, renderMermaidIn } = useMarkdownRenderer()

onMounted(async () => {
  // Prefer document already fetched during SSR (serialized in the Nuxt
  // payload) so we render instantly without a loading skeleton.
  const initial = useState<PublicDoc | null>(`shared-initial-doc-${props.token}`, () => null)
  const initialDoc = initial.value

  const render = async (docData: PublicDoc) => {
    doc.value = docData
    // Normalize before rendering: the public page receives raw database content
    // which may still contain legacy &nbsp; markers or unnormalized blank lines.
    // The editor path normalizes via serializeWithAlignment before it reaches
    // renderToHtml; we must do the same here explicitly.
    const normalizedContent = normalizeMarkdownForStorage(docData.content)
    previewHtml.value = await renderToHtml(normalizedContent, { hardenLinks: true })
    emit('loaded', docData.title)
    state.value = 'ready'

    await nextTick()
    if (previewRef.value) {
      await renderMermaidIn(previewRef.value)
    }
  }

  if (initialDoc) {
    await render(initialDoc)
  }

  // Revalidate against the live API so the view stays current.
  try {
    const fresh = await $fetch<PublicDoc>(`/api/public/doc/${encodeURIComponent(props.token)}`)
    if (!initialDoc || fresh.content !== initialDoc.content || fresh.title !== initialDoc.title) {
      await render(fresh)
    }
  } catch (err: any) {
    if (!initialDoc) {
      const status = err?.response?.status || err?.statusCode || err?.status
      state.value = status === 404 ? 'notfound' : 'error'
    }
  }
})
</script>

<template>
  <div>
    <div
      v-if="state === 'loading'"
      class="animate-pulse rounded-lg border border-neutral-200 bg-white p-6 sm:p-8 dark:border-neutral-800 dark:bg-neutral-900"
      aria-label="Loading shared document"
    >
      <div class="mb-4 h-7 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div class="mb-2 h-4 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
      <div class="mb-2 h-4 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div class="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
    </div>

    <div
      v-else-if="state === 'notfound'"
      class="rounded-lg border border-neutral-200 bg-white p-6 text-center sm:p-8 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h1 class="mb-2 text-xl font-semibold">This link is invalid or was revoked</h1>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        Ask the document owner for a new share link.
      </p>
    </div>

    <div
      v-else-if="state === 'error'"
      class="rounded-lg border border-neutral-200 bg-white p-6 text-center sm:p-8 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h1 class="mb-2 text-xl font-semibold">Something went wrong</h1>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        The document could not be loaded. Please try again in a moment.
      </p>
    </div>

    <article
      v-else-if="doc"
      class="rounded-lg border border-neutral-200 bg-white p-6 sm:p-8 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div
        ref="previewRef"
        class="preview-content prose prose-neutral max-w-none dark:prose-invert"
        v-html="previewHtml"
      />
    </article>
  </div>
</template>
