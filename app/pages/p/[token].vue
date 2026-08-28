<script setup lang="ts">
import { computed, onMounted } from 'vue'
import SharedDocPreview from '~/components/public/SharedDocPreview.client.vue'

definePageMeta({ layout: 'empty' })

const route = useRoute()
const token = computed(() => String(route.params.token || ''))
const docTitle = useState<string>('shared-doc-title', () => '')

// Fetch on the server so the client receives the document in the Nuxt payload
// and can render it immediately (no loading-skeleton flash). A background
// revalidation in the component keeps the view live.
const { data } = await useFetch<{ title: string, content: string, updated_at: number } | null>(
  () => `/api/public/doc/${token.value}`
)
useState(`shared-initial-doc-${token.value}`, () => data.value ?? null)

useSeoMeta({
  robots: 'noindex, nofollow',
  title: () => docTitle.value || 'Shared document | shbd'
})

// Minimal theme init (the default layout that usually provides this is
// intentionally not used on the public share page)
onMounted(() => {
  const stored = window.localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = stored ? stored === 'dark' : prefersDark
  document.documentElement.classList.toggle('dark', isDark)
})
</script>

<template>
  <div class="min-h-screen bg-neutral-100 px-3 py-6 text-neutral-900 sm:px-6 dark:bg-neutral-950 dark:text-neutral-100">
    <main class="mx-auto w-full max-w-3xl">
      <div class="mb-4 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <NuxtLink
          to="/"
          class="flex items-center gap-2 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
          aria-label="Go to shbd home"
        >
          <img src="/logo_bioinfoguru.svg" alt="" class="h-6 w-6">
          <span class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100" style="font-family: 'Laila', ui-sans-serif, system-ui, sans-serif">शब्द</span>
        </NuxtLink>
        <span class="text-xs">· shared document</span>
      </div>

      <ClientOnly>
        <SharedDocPreview :token="token" @loaded="docTitle = $event" />
        <template #fallback>
          <div
            class="animate-pulse rounded-lg border border-neutral-200 bg-white p-6 sm:p-8 dark:border-neutral-800 dark:bg-neutral-900"
            aria-label="Loading shared document"
          >
            <div class="mb-4 h-7 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div class="mb-2 h-4 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
            <div class="mb-2 h-4 w-5/6 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div class="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </template>
      </ClientOnly>
    </main>
  </div>
</template>
