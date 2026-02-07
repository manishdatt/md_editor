<script setup lang="ts">
import { NodeViewWrapper } from '@tiptap/vue-3'
import { computed } from 'vue'
import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'

const props = defineProps<{
  node: { attrs: { code?: string; language?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
}>()

const { highlightCode } = useShikiHighlighter()
const code = computed(() => String(props.node.attrs.code ?? ''))
const language = computed(() => String(props.node.attrs.language ?? 'text'))
const highlighted = computed(() => highlightCode(code.value, language.value))

function onCodeInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  props.updateAttributes({ code: target.value })
}

function onLanguageInput(event: Event) {
  const target = event.target as HTMLInputElement
  props.updateAttributes({ language: target.value.trim() || 'text' })
}
</script>

<template>
  <NodeViewWrapper class="my-4 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
    <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label class="text-xs font-medium uppercase tracking-wide text-neutral-500">Language</label>
      <input
        :value="language"
        type="text"
        class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        @input="onLanguageInput"
      >
    </div>

    <textarea
      :value="code"
      rows="8"
      spellcheck="false"
      class="mb-3 w-full rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
      @input="onCodeInput"
    />

    <div class="prose prose-sm max-w-none rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:prose-invert dark:border-neutral-700 dark:bg-neutral-950" v-html="highlighted" />
  </NodeViewWrapper>
</template>
