<script setup lang="ts">
// Admin panel. Authorization is enforced server-side (ADMIN_EMAILS allowlist
// on /api/admin/*); this page is noindexed so it is not discoverable.
useSeoMeta({
  title: 'Admin',
  robots: 'noindex, nofollow'
})
</script>

<template>
  <ClientOnly>
    <AdminPanel />
    <template #fallback>
      <div class="mx-auto w-full max-w-7xl px-4 py-8">
        <div class="animate-pulse space-y-4">
          <div class="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div v-for="n in 4" :key="n" class="h-24 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
          </div>
          <div class="h-64 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>
    </template>
  </ClientOnly>
</template>
