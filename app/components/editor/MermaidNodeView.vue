<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'

const props = defineProps<{
  node: { attrs: { code?: string } }
  getPos: () => number
  updateAttributes: (attrs: Record<string, unknown>) => void
}>()

const isFocused = ref(false)
const svgHost = ref<HTMLElement | null>(null)
const mermaidApi = shallowRef<any>(null)
const renderVersion = ref(0)

const nodeId = () => `mermaid-${String(props.getPos())}`

function codeValue() {
  return String(props.node.attrs.code ?? '')
}

async function ensureMermaid() {
  if (mermaidApi.value) {
    return mermaidApi.value
  }

  const mod = await import('mermaid')
  const mermaid = mod.default
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    suppressErrorRendering: true
  })
  mermaid.parseError = () => undefined
  mermaidApi.value = mermaid
  return mermaid
}

function clearSvg() {
  if (svgHost.value) {
    svgHost.value.innerHTML = ''
  }
}

async function renderSvg() {
  if (isFocused.value) {
    return
  }

  const version = ++renderVersion.value
  await nextTick()
  const host = svgHost.value

  if (!host) {
    return
  }

  const source = codeValue().trim()

  if (!source) {
    clearSvg()
    return
  }

  const mermaid = await ensureMermaid()
  if (version !== renderVersion.value) {
    return
  }

  try {
    const { svg } = await mermaid.render(nodeId(), source)
    if (version !== renderVersion.value || !svgHost.value) {
      return
    }
    svgHost.value.innerHTML = svg
  } catch {
    // Preserve the last valid SVG while users type incomplete Mermaid syntax.
  }
}

function onTextInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  props.updateAttributes({ code: target.value })
}

onMounted(() => {
  renderSvg()
})

watch(() => props.node.attrs.code, () => {
  renderSvg()
})

watch(isFocused, (value) => {
  if (!value) {
    renderSvg()
  }
})

onBeforeUnmount(() => {
  clearSvg()
})
</script>

<template>
  <NodeViewWrapper class="my-4 rounded-lg border border-neutral-300 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-xs font-medium uppercase tracking-wide text-neutral-500">Mermaid</span>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
        @click="isFocused = !isFocused"
      >
        {{ isFocused ? 'Preview' : 'Edit' }}
      </button>
    </div>

    <textarea
      v-if="isFocused"
      :value="String(props.node.attrs.code ?? '')"
      rows="8"
      spellcheck="false"
      class="w-full rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
      @input="onTextInput"
      @blur="isFocused = false"
    />

    <div
      v-else
      ref="svgHost"
      class="mermaid overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-950"
      @click="isFocused = true"
    />
  </NodeViewWrapper>
</template>
