import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'
import { normalizeHardBreaks, restoreMarkdownSyntax } from '~/utils/markdownAlignment'

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

const ALIGN_MARKER_RE = /^<!--\s*align:\s*(left|center|right)\s*-->$/

// Convert `<!-- align:X -->` markers (emitted by the editor) into styled block
// elements so alignment renders in the preview and on shared pages. Inner
// markdown is rendered to inline HTML first so formatting is preserved.
function applyAlignmentMarkers(markdown: string, marked: any, renderer?: any): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  let pending: string | null = null
  let fence = false

  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      fence = !fence
    }

    const marker = !fence ? line.match(ALIGN_MARKER_RE) : null
    if (marker) {
      pending = marker[1]
      i += 1
      continue
    }

    if (pending) {
      const blockLines: string[] = []
      while (i < lines.length) {
        const cur = lines[i]
        if (/^\s*```/.test(cur)) {
          fence = !fence
        }
        if (!fence && cur.trim() === '' && blockLines.length > 0) {
          break
        }
        blockLines.push(cur)
        i += 1
      }
      const text = blockLines.join('\n').trim()
      if (text) {
        // Never wrap fenced code blocks in an alignment tag.
        if (text.startsWith('```') || text.startsWith('~~~')) {
          out.push(text)
          pending = null
          continue
        }
        const heading = text.match(/^(#{1,6})\s+([\s\S]*)$/)
        const inlineOptions = renderer ? { renderer, gfm: true } : { gfm: true }
        if (heading) {
          const level = heading[1].length
          const inner = marked.parseInline(heading[2], inlineOptions)
          out.push(`<h${level} style="text-align:${pending}">${inner}</h${level}>`)
        } else {
          const inner = marked.parseInline(text, inlineOptions)
          out.push(`<p style="text-align:${pending}">${inner}</p>`)
        }
      }
      pending = null
      continue
    }

    out.push(line)
    i += 1
  }

  return out.join('\n')
}

export function useMarkdownRenderer() {
  const { ensureHighlighter, highlightCode, normalizeLanguage } = useShikiHighlighter()

  async function renderToHtml(markdown: string, options?: { themeMode?: 'auto' | 'light' | 'dark', hardenLinks?: boolean }) {
    const { marked } = await import('marked')
    const renderer = new marked.Renderer()

    // Pre-import DOMPurify only when an svg fence exists so regular documents
    // don't pay the module cost. SVG content comes from the document author
    // (or, on shared pages, an untrusted author), so it must be sanitized
    // before reaching the DOM.
    const needsSvgSanitizer = /^```svg\s*$/im.test(markdown)
    let sanitize: ((svg: string) => string) | null = null
    if (needsSvgSanitizer) {
      const DOMPurify = (await import('dompurify')).default
      sanitize = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
    }

    // Only load the (heavy) Shiki highlighter when the document actually has a
    // fenced code block. Loading it unconditionally blocked rendering for docs
    // with no code (and could hang the public share page on a cold load where
    // Shiki's wasm/grammar bundle stalls). Warm it, but never let a failure
    // break rendering — highlightCode degrades to escaped HTML when needed.
    const hasCodeFence = /^[ \t]*```/m.test(markdown) || /^[ \t]*~~~/m.test(markdown)
    if (hasCodeFence) {
      await ensureHighlighter().catch(() => undefined)
    }

    renderer.code = ({ text, lang }: any) => {
      const source = String(text || '')
      const language = String(lang || '').trim().toLowerCase()

      if (language === 'mermaid') {
        return `<div class="mermaid">${escapeHtml(source)}</div>`
      }

      if (language === 'svg') {
        return `<div class="svg-block">${sanitize ? sanitize(source) : escapeHtml(source)}</div>`
      }

      // highlightCode returns escaped HTML when the highlighter isn't ready.
      return highlightCode(source, normalizeLanguage(language || 'text'), options?.themeMode || 'auto')
    }

    renderer.html = (token: any) => {
      const html = typeof token === 'string' ? token : String(token?.text || '')
      // Allow only alignment wrappers we emit ourselves; everything else is escaped
      // to keep the public share surface safe.
      if (/^<(p|h[1-6]) style="text-align:(left|center|right)">[\s\S]*<\/\1>$/.test(html.trim())) {
        return html
      }
      // Allow <br> (and runs of them from consecutive blank lines) so Shift+Enter
      // blank lines render on the preview and shared pages. <br> has no attributes,
      // so it is safe to pass through unchanged.
      if (/^(?:<br\s*\/?>\s*)+$/i.test(html.trim())) {
        return html
      }
      return escapeHtml(html)
    }

    if (options?.hardenLinks) {
      // Public anonymous surface: marked does not sanitize hrefs, so strip
      // javascript:/data:/vbscript: protocols and force safe link attributes.
      // Regular function (not arrow) so `this` binds to the Renderer at call
      // time and `this.parser` is available, matching marked's default link().
      renderer.link = function (this: any, { href, title, tokens }: any) {
        const text = this?.parser ? this.parser.parseInline(tokens) : String(tokens?.[0]?.text || '')
        const url = String(href || '').trim()
        const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#'
        let encoded = '#'
        if (safe !== '#') {
          try {
            encoded = encodeURI(safe).replace(/%25/g, '%')
          } catch {
            encoded = '#'
          }
        }
        const titleAttr = title ? ` title="${escapeHtml(String(title)).replaceAll('"', '&quot;')}"` : ''
        return `<a href="${encoded}"${titleAttr} target="_blank" rel="noopener nofollow ugc">${text}</a>`
      }
    }

    const alignedMarkdown = applyAlignmentMarkers(restoreMarkdownSyntax(normalizeHardBreaks(markdown)), marked, options?.hardenLinks ? renderer : undefined)

    return String(marked.parse(alignedMarkdown, {
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
