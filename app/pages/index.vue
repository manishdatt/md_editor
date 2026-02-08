<script setup lang="ts">
import EditorWorkspace from '~/components/editor/EditorWorkspace.vue'

useSeoMeta({
  title: 'Editor',
  description: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.',
  ogTitle: 'Markdown Editor',
  ogDescription: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.',
  twitterTitle: 'Markdown Editor',
  twitterDescription: 'Write Markdown with Mermaid diagrams, code highlighting, and PDF export.'
})
</script>

<template>
  <EditorWorkspace />
</template>
