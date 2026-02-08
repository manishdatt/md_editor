import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'

let mermaidInstancePromise: Promise<any> | null = null

const emojiShortcodes: Record<string, string> = {
  grinning: '😀',
  smile: '😄',
  smiley: '😃',
  laughing: '😆',
  wink: '😉',
  blush: '😊',
  thinking: '🤔',
  neutral_face: '😐',
  expressionless: '😑',
  crying: '😢',
  sob: '😭',
  angry: '😠',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  clap: '👏',
  raised_hands: '🙌',
  fire: '🔥',
  sparkles: '✨',
  tada: '🎉',
  rocket: '🚀',
  heart: '❤️',
  broken_heart: '💔',
  star: '⭐',
  white_check_mark: '✅',
  x: '❌',
  warning: '⚠️',
  bulb: '💡'
}

async function getMermaid() {
  if (!mermaidInstancePromise) {
    mermaidInstancePromise = import('mermaid').then((mod) => {
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        suppressErrorRendering: true
      })
      mermaid.parseError = () => undefined
      return mermaid
    })
  }

  return mermaidInstancePromise
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function emojifyText(value: string) {
  return value.replace(/:([a-z0-9_+-]+):/gi, (full, name: string) => {
    const key = name.toLowerCase()
    return emojiShortcodes[key] || full
  })
}

export function useMarkdownRenderer() {
  const { ensureHighlighter, highlightCode, normalizeLanguage } = useShikiHighlighter()

  async function renderToHtml(markdown: string, options?: { themeMode?: 'auto' | 'light' | 'dark' }) {
    await ensureHighlighter()

    const { marked } = await import('marked')
    const renderer = new marked.Renderer()

    renderer.code = ({ text, lang }: any) => {
      const source = String(text || '')
      const language = String(lang || '').trim().toLowerCase()

      if (language === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(source)}</div>`
      }

      return highlightCode(source, normalizeLanguage(language || 'text'), options?.themeMode || 'auto')
    }

    renderer.html = (token: any) => {
      const html = typeof token === 'string' ? token : String(token?.text || '')
      return escapeHtml(html)
    }

    return String(marked.parse(markdown, {
      gfm: true,
      breaks: false,
      renderer,
      walkTokens: (token: any) => {
        if (token?.type === 'text' && typeof token.text === 'string') {
          token.text = emojifyText(token.text)
        }
      }
    }))
  }

  async function renderMermaidIn(element: HTMLElement) {
    const mermaidNodes = [...element.querySelectorAll<HTMLElement>('.mermaid')]
    if (mermaidNodes.length === 0) {
      return
    }

    const mermaid = await getMermaid()
    await Promise.all(mermaidNodes.map(async (node, index) => {
      const source = node.textContent?.trim() || ''

      if (!source) {
        node.innerHTML = ''
        return
      }

      try {
        const { svg } = await mermaid.render(`mermaid-preview-${index}-${Date.now()}`, source)
        node.innerHTML = svg
      } catch {
        // Keep Mermaid source text when syntax is incomplete/invalid.
      }
    }))
  }

  return {
    renderToHtml,
    renderMermaidIn
  }
}
