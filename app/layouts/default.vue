<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nuxt/components'

type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')

function applyTheme(nextTheme: Theme) {
  if (!import.meta.client) {
    return
  }

  theme.value = nextTheme
  document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  localStorage.setItem('theme', nextTheme)
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
  <div class="min-h-screen bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
    <header class="sticky top-0 z-40 border-b border-neutral-300 bg-white/95 backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
      <div class="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-2 sm:px-6">
        <NuxtLink to="/" class="flex items-center gap-2">
          <img src="/logo_bioinfoguru.svg" alt="Logo" class="h-7 w-7">
          <span class="text-sm font-semibold">MD Editor</span>
        </NuxtLink>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
            @click="toggleTheme"
          >
            {{ theme === 'dark' ? 'Light' : 'Dark' }}
          </button>

          <SignedOut>
            <SignInButton mode="modal">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
              >
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
              >
                Sign Up
              </button>
            </SignUpButton>
          </SignedOut>

          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>

    <main class="mx-auto flex min-h-[calc(100vh-3.25rem)] w-full max-w-7xl flex-col p-3 sm:p-6">
      <slot />
    </main>
  </div>
</template>
