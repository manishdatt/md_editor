<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'

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
  state.value = 'loading'

  try {
    const data = await $fetch<PublicDoc>(`/api/public/doc/${encodeURIComponent(props.token)}`)
    doc.value = data
    previewHtml.value = await renderToHtml(data.content, { hardenLinks: true })
    emit('loaded', data.title)
    state.value = 'ready'

    await nextTick()
    if (previewRef.value) {
      await renderMermaidIn(previewRef.value)
    }
  } catch (err: any) {
    const status = err?.response?.status || err?.statusCode || err?.status
    state.value = status === 404 ? 'notfound' : 'error'
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
      <h1 class="mb-4 text-2xl font-semibold tracking-tight">
        {{ doc.title || 'Untitled Document' }}
      </h1>
      <div
        ref="previewRef"
        class="preview-content prose prose-neutral max-w-none dark:prose-invert"
        v-html="previewHtml"
      />
    </article>
  </div>
</template>
