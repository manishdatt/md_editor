<script setup lang="ts">
import { ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<{
  node: { attrs: { code?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
}>()

function onTextInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  props.updateAttributes({ code: target.value })
}
</script>

<template>
  <NodeViewWrapper class="my-4 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
    <div class="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">Mermaid</div>

    <textarea
      :value="String(props.node.attrs.code ?? '')"
      rows="8"
      spellcheck="false"
      class="w-full rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
      @input="onTextInput"
    />
  </NodeViewWrapper>
</template>
