import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

interface GhostPluginState {
  enabled: boolean
  suggestion: string | null
  pos: number
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiGhostText: {
      setAiGhostTextEnabled: (enabled: boolean) => ReturnType
    }
  }
}

const ghostPluginKey = new PluginKey<GhostPluginState>('aiGhostText')

const STORAGE_KEY = 'ai-ghost-enabled'
const PREFIX_CHARS = 4000
const SUFFIX_CHARS = 1000
const DEBOUNCE_MS = 700
const CACHE_LIMIT = 50
const LEAF_PLACEHOLDER = '\uFFFC'
const SKIP_PARENTS = new Set(['mermaidBlock', 'markdownTable'])

function readEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  const value = window.localStorage.getItem(STORAGE_KEY)
  return value === null ? true : value === '1'
}

function writeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
}

function extractContext(view: EditorView): { prefix: string, suffix: string, pos: number } | null {
  const { state } = view
  const selection = state.selection
  if (!selection.empty) {
    return null
  }

  const pos = selection.from
  const parentName = selection.$from.parent.type.name
  if (SKIP_PARENTS.has(parentName)) {
    return null
  }

  const doc = state.doc
  const start = Math.max(0, pos - PREFIX_CHARS)
  const end = Math.min(doc.content.size, pos + SUFFIX_CHARS)
  const prefix = doc.textBetween(start, pos, '\n', LEAF_PLACEHOLDER)
  const suffix = doc.textBetween(pos, end, '\n', LEAF_PLACEHOLDER)

  if (prefix.trim().length === 0) {
    return null
  }

  return { prefix, suffix, pos }
}

function createGhostPlugin(): Plugin<GhostPluginState> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let token = 0
  let blocked = false
  const cache = new Map<string, string>()

  function clearTimer(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function abort(): void {
    controller?.abort()
    controller = null
  }

  function clearSuggestion(view: EditorView): void {
    clearTimer()
    abort()
    token += 1
    const current = ghostPluginKey.getState(view.state)
    if (current?.suggestion) {
      view.dispatch(view.state.tr.setMeta(ghostPluginKey, { type: 'clear' }))
    }
  }

  async function fetchSuggestion(view: EditorView, myToken: number): Promise<void> {
    const context = extractContext(view)
    if (!context) {
      return
    }

    const cacheKey = `${context.prefix}\u0000${context.suffix}`
    const cached = cache.get(cacheKey)

    let suggestion: string
    if (cached !== undefined) {
      suggestion = cached
    } else {
      controller = new AbortController()
      try {
        const response = await fetch('/api/ai/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: context.prefix, suffix: context.suffix }),
          signal: controller.signal
        })

        if (!response.ok) {
          if (response.status === 401 || response.status === 429) {
            blocked = true
          }
          return
        }

        const data = await response.json() as { suggestion?: string }
        suggestion = (data.suggestion ?? '').trimEnd()

        if (suggestion) {
          cache.set(cacheKey, suggestion)
          if (cache.size > CACHE_LIMIT) {
            const oldest = cache.keys().next().value
            if (oldest !== undefined) {
              cache.delete(oldest)
            }
          }
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return
        }
        return
      } finally {
        controller = null
      }
    }

    if (myToken !== token) {
      return
    }
    if (!suggestion) {
      return
    }

    const now = extractContext(view)
    if (!now || now.pos !== context.pos || now.prefix !== context.prefix) {
      return
    }

    view.dispatch(
      view.state.tr.setMeta(ghostPluginKey, {
        type: 'set',
        suggestion,
        pos: context.pos
      })
    )
  }

  function schedule(view: EditorView): void {
    if (blocked) {
      return
    }
    clearTimer()
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      const myToken = token
      void fetchSuggestion(view, myToken)
    }, DEBOUNCE_MS)
  }

  return new Plugin<GhostPluginState>({
    key: ghostPluginKey,
    state: {
      init() {
        return { enabled: readEnabled(), suggestion: null, pos: 0 }
      },
      apply(tr, value) {
        const meta = tr.getMeta(ghostPluginKey) as
          | { type: string, suggestion?: string, pos?: number, value?: boolean }
          | undefined

        if (meta?.type === 'enable') {
          return { ...value, enabled: Boolean(meta.value), suggestion: meta.value ? value.suggestion : null }
        }
        if (meta?.type === 'clear') {
          return { ...value, suggestion: null, pos: 0 }
        }
        if (meta?.type === 'set') {
          return { ...value, suggestion: meta.suggestion ?? null, pos: meta.pos ?? 0 }
        }
        if (tr.docChanged || tr.selectionSet) {
          return { ...value, suggestion: null, pos: 0 }
        }
        return value
      }
    },
    props: {
      decorations(state) {
        const pluginState = ghostPluginKey.getState(state)
        if (!pluginState?.suggestion) {
          return DecorationSet.empty
        }
        const pos = pluginState.pos
        if (pos === 0 || pos > state.doc.content.size) {
          return DecorationSet.empty
        }

        const widget = Decoration.widget(
          pos,
          () => {
            const span = document.createElement('span')
            span.className = 'ai-ghost-text'
            span.textContent = pluginState.suggestion ?? ''
            return span
          },
          { side: 1 }
        )

        return DecorationSet.create(state.doc, [widget])
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Tab' && event.key !== 'Escape') {
          return false
        }
        const pluginState = ghostPluginKey.getState(view.state)
        if (!pluginState?.suggestion) {
          return false
        }

        if (event.key === 'Escape') {
          clearSuggestion(view)
          return true
        }

        event.preventDefault()
        const suggestion = pluginState.suggestion
        const pos = pluginState.pos
        clearTimer()
        abort()
        token += 1
        view.dispatch(view.state.tr.insertText(suggestion, pos, pos))
        schedule(view)
        return true
      }
    },
    view() {
      return {
        update(view, prevState) {
          const pluginState = ghostPluginKey.getState(view.state)
          if (!pluginState?.enabled) {
            return
          }
          if (view.composing) {
            return
          }

          const prevPluginState = ghostPluginKey.getState(prevState)
          if (!prevPluginState?.enabled && pluginState.enabled) {
            schedule(view)
            return
          }

          if (prevState.doc.eq(view.state.doc) && prevState.selection.eq(view.state.selection)) {
            return
          }

          schedule(view)
        }
      }
    }
  })
}

export const AiGhostText = Extension.create({
  name: 'aiGhostText',

  addProseMirrorPlugins() {
    return [createGhostPlugin()]
  },

  addCommands() {
    return {
      setAiGhostTextEnabled: (enabled: boolean) => ({ editor }) => {
        writeEnabled(enabled)
        editor.view.dispatch(
          editor.state.tr.setMeta(ghostPluginKey, { type: 'enable', value: enabled })
        )
        return true
      }
    }
  }
})
