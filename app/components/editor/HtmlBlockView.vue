<script setup lang="ts">
import { computed, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { sanitizeHtml } from '~/utils/sanitizeHtml'

const props = defineProps<{
  node: { attrs: { html?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}>()

const editing = ref(false)
const rendered = computed(() => sanitizeHtml(String(props.node.attrs.html ?? '')))
const isEmpty = computed(() => !String(props.node.attrs.html ?? '').trim())

function onTextInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  props.updateAttributes({ html: target.value })
}
</script>

<template>
  <NodeViewWrapper class="my-4 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wide text-neutral-500">HTML</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          @click="editing = !editing"
        >
          {{ editing ? 'Preview' : 'Edit' }}
        </button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
          @click="props.deleteNode"
        >
          Remove
        </button>
      </div>
    </div>

    <div
      v-if="!editing"
      class="html-block-preview min-h-[2rem] rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950"
      v-html="rendered"
    />
    <p v-if="!editing && isEmpty" class="text-xs text-neutral-500 dark:text-neutral-400">
      Empty HTML block — click “Edit” to add markup.
    </p>

    <textarea
      v-else
      :value="String(props.node.attrs.html ?? '')"
      rows="8"
      spellcheck="false"
      placeholder="<div style=&quot;display:flex;gap:8px&quot;><div style=&quot;flex:1&quot;>Column A</div><div style=&quot;flex:1&quot;>Column B</div></div>"
      class="w-full rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
      @input="onTextInput"
    />

    <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
      Renders live in the editor, preview pane and PDF export (sanitized). Use
      <code>```{=html}</code> fences to write raw HTML, e.g. columns or coloured text.
    </p>
  </NodeViewWrapper>
</template>
