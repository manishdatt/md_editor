import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'

let mermaidInstancePromise: Promise<any> | null = null

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

export function useMarkdownRenderer() {
  const { ensureHighlighter, highlightCode, normalizeLanguage } = useShikiHighlighter()

  async function renderToHtml(markdown: string) {
    await ensureHighlighter()

    const { marked } = await import('marked')
    const renderer = new marked.Renderer()

    renderer.code = ({ text, lang }: any) => {
      const source = String(text || '')
      const language = String(lang || '').trim().toLowerCase()

      if (language === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(source)}</div>`
      }

      return highlightCode(source, normalizeLanguage(language || 'text'))
    }

    renderer.html = (token: any) => {
      const html = typeof token === 'string' ? token : String(token?.text || '')
      return escapeHtml(html)
    }

    return String(marked.parse(markdown, {
      gfm: true,
      breaks: false,
      renderer
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
