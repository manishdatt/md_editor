<script setup lang="ts">
import { computed, onMounted } from 'vue'

definePageMeta({ layout: false })

const route = useRoute()
const token = computed(() => String(route.params.token || ''))
const docTitle = useState<string>('shared-doc-title', () => '')

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
        <img src="/logo_bioinfoguru.svg" alt="shbd" class="h-6 w-6">
        <span class="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100" style="font-family: 'Laila', ui-sans-serif, system-ui, sans-serif">शब्द</span>
        <span class="text-xs">· shared document</span>
      </div>

      <SharedDocPreview :token="token" @loaded="docTitle = $event" />
    </main>
  </div>
</template>
