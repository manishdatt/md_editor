<script setup lang="ts">
const route = useRoute()
const runtimeConfig = useRuntimeConfig()

const canonicalUrl = computed(() => {
  const siteUrl = String(runtimeConfig.public.siteUrl || 'https://md-editor.pages.dev').replace(/\/+$/, '')
  return `${siteUrl}${route.path || '/'}`
})

useHead({
  link: [
    {
      rel: 'canonical',
      href: canonicalUrl
    }
  ],
  meta: [
    {
      property: 'og:url',
      content: canonicalUrl
    }
  ]
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
