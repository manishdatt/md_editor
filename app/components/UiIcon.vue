<script setup lang="ts">
defineProps<{
  name: 'plus' | 'save' | 'trash' | 'download' | 'upload' | 'share' | 'undo' | 'bookmark' | 'file' | 'eye' | 'link'
  size?: string
}>()
</script>

<template>
  <svg
    :width="size || '16'"
    :height="size || '16'"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-if="name === 'plus'" d="M12 5v14M5 12h14" />
    <template v-else-if="name === 'save'">
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v5h8V4M8 20v-6h8v6" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 4v11M8 11l4 4 4-4M5 20h14" />
    </template>
    <template v-else-if="name === 'upload'">
      <path d="M12 20V9M8 13l4-4 4 4M5 4h14" />
    </template>
    <template v-else-if="name === 'share'">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
    </template>
    <path v-else-if="name === 'undo'" d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" />
    <template v-else-if="name === 'bookmark'">
      <path d="M6 4h12v16l-6-3-6 3z" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M6 3h8l4 4v14H6zM14 3v5h5" />
    </template>
    <template v-else-if="name === 'eye'">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </template>
    <path v-else-if="name === 'link'" d="M10 13.5a4 4 0 0 0 5.7.2l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1M14 10.5a4 4 0 0 0-5.7-.2l-2 2A4 4 0 0 0 12 18l1.1-1.1" />
  </svg>
</template>
