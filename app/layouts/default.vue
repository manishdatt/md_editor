<script setup lang="ts">
import { onMounted, ref } from 'vue'

type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')

function applyTheme(nextTheme: Theme) {
  if (!import.meta.client) {
    return
  }

  theme.value = nextTheme
  document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  localStorage.setItem('theme', nextTheme)
  window.dispatchEvent(new Event('theme-changed'))
}

function toggleTheme() {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark' || stored === 'light') {
    applyTheme(stored)
    return
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  applyTheme(prefersDark ? 'dark' : 'light')
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header class="sticky top-0 z-40 border-b border-neutral-300 bg-white/95 backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
      <div class="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-2 sm:px-6">
        <NuxtLink to="/" class="flex items-center gap-2">
          <img src="/logo_bioinfoguru.svg" alt="Logo" class="h-7 w-7">
          <span class="text-2xl font-semibold tracking-tight" style="font-family: 'Laila', ui-sans-serif, system-ui, sans-serif">शब्द</span>
        </NuxtLink>

        <nav class="flex items-center gap-3" aria-label="Main navigation">
          <NuxtLink
            to="/pricing"
            class="text-xs text-neutral-600 transition-colors hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white"
          >
            Pricing
          </NuxtLink>
          <NuxtLink
            to="/guide"
            class="text-xs text-neutral-600 transition-colors hover:text-neutral-950 hover:underline dark:text-neutral-300 dark:hover:text-white"
          >
            Guide
          </NuxtLink>
          <button
            type="button"
            class="rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700"
            :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <svg
              v-if="theme === 'dark'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              class="h-4 w-4"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              class="h-4 w-4"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3c0 .21-.01.42-.01.63A7 7 0 0 0 18.37 10.8c.21 0 .42 0 .63-.01Z" />
            </svg>
          </button>

          <AuthButtons />
        </nav>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-7xl flex-1 flex-col p-3 sm:p-6">
      <slot />
    </main>

    <footer class="border-t border-neutral-300 dark:border-neutral-700">
      <div class="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1 px-3 py-4 text-xs text-neutral-500 sm:flex-row sm:px-6 dark:text-neutral-400">
        <span>&copy; {{ new Date().getFullYear() }} <span style="font-family: 'Geo', sans-serif; color: #9c51e0;">bioinfo.guru</span></span>
        <div class="flex items-center gap-4">
          <a href="/privacy.html" class="hover:underline">Privacy Policy</a>
          <a href="/terms.html" class="hover:underline">Terms of Service</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Geo&display=swap');
</style>
