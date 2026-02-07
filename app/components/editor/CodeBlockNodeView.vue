<script setup lang="ts">
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { computed } from 'vue'

const props = defineProps<{
  node: { attrs: { language?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
}>()

const language = computed(() => String(props.node.attrs.language ?? 'text'))

function applyLanguage(value: string) {
  const nextLanguage = (value || 'text').trim().toLowerCase() || 'text'
  props.updateAttributes({ language: nextLanguage })
}

function onLanguageInput(event: Event) {
  applyLanguage((event.target as HTMLInputElement).value)
}
</script>

<template>
  <NodeViewWrapper class="my-3 rounded-md border border-neutral-300 bg-neutral-900 p-2 dark:border-neutral-700">
    <div class="mb-2 flex items-center gap-2">
      <label class="text-[11px] font-medium uppercase tracking-wide text-neutral-300">Lang</label>
      <input
        :value="language"
        type="text"
        class="w-28 rounded-md border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-100"
        @input="onLanguageInput"
      >
    </div>

    <pre class="m-0 bg-transparent p-0"><code><NodeViewContent as="code" class="block whitespace-pre font-mono text-sm text-neutral-100 caret-white outline-none" /></code></pre>
  </NodeViewWrapper>
</template>
