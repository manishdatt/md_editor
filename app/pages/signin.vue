<script setup lang="ts">
useSeoMeta({
  title: 'Sign in'
})
</script>

<template>
  <ClientOnly>
    <AuthSignInPanel />
    <template #fallback>
      <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <div class="w-full max-w-sm animate-pulse rounded-lg border border-neutral-300 bg-white p-8 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="mx-auto mb-6 h-6 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div class="space-y-3">
            <div class="h-11 rounded-md bg-neutral-200 dark:bg-neutral-800" />
            <div class="h-11 rounded-md bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
