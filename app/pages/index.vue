<script setup lang="ts">
useSeoMeta({
  title: 'shbd',
  description: 'A versatile Markdown editor armed with AI prowess.',
  ogTitle: 'shbd',
  ogDescription: 'A versatile Markdown editor armed with AI prowess.',
  twitterTitle: 'shbd',
  twitterDescription: 'A versatile Markdown editor armed with AI prowess.'
})
</script>

<template>
  <section class="mb-3 flex flex-col items-center gap-2 text-center sm:mb-6">
    <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">shbd</h1>
    <p class="max-w-xl text-sm text-neutral-600 sm:text-base dark:text-neutral-400">
      A versatile editor armed with AI prowess.
    </p>
  </section>

  <ClientOnly>
    <EditorWorkspace />
    <template #fallback>
      <div class="flex min-h-[calc(100vh-1.5rem)] flex-col gap-3">
        <div class="h-[4.5rem] animate-pulse rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" />
        <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
          <div class="min-h-[24rem] animate-pulse rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900" />
          <div class="hidden min-h-[24rem] animate-pulse rounded-lg border border-neutral-300 bg-white lg:block dark:border-neutral-700 dark:bg-neutral-900" />
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
