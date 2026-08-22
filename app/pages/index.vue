<script setup lang="ts">
useSeoMeta({
  title: 'shbd',
  description: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.',
  ogTitle: 'shbd',
  ogDescription: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.',
  twitterTitle: 'shbd',
  twitterDescription: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.'
})
</script>

<template>
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
