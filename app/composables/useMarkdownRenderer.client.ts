import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'
import { extractAlignment, type AlignmentDirective } from '~/utils/markdownAlignment'
import { sanitizeHtml } from '~/utils/sanitizeHtml'

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

// Quarto raw-HTML fence (` ```{=html} `) and a simpler `rawhtml` alias render
// their body as live HTML instead of a highlighted code block.
function isRawHtmlFence(language: string): boolean {
  const lang = String(language || '').trim().toLowerCase()
  return lang === '{=html}' || lang === 'rawhtml' || lang === 'htmlraw'
}

// Markdown blank lines collapse to a single block separation when parsed, so
// they carry no reliable vertical space in HTML/PDF. Turn each blank line into an
// explicit <br> so the author's blank-line spacing survives into the rendered
// preview and the exported PDF. A <br> (not a <div>) is used on purpose: a raw
// <div> opens an HTML block that swallows the following heading/list until the
// next blank line. Fenced code/HTML/SVG blocks are skipped so their literal
// content is never altered.
function blankLinesToSpacers(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) {
        return line
      }
      if (line.trim() === '') {
        return '<br>'
      }
      return line
    })
    .join('\n')
}

// Split markdown into top-level block chunks (blank-line separated, fence aware).
// Display-only: used to wrap aligned blocks in styled divs for the preview.
function splitTopLevelBlocks(markdown: string): string[] {
  const chunks: string[] = []
  const lines = markdown.split('\n')
  let fence = false
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join('\n'))
      current = []
    }
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      current.push(line)
      continue
    }
    if (!fence && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return chunks
}

// Wrap aligned blocks in styled divs for display. This is purely presentational
// and runs only on the preview input — it NEVER touches persisted content, so
// it cannot corrupt documents across renders (unlike the previous whole-doc
// markdown-rewriting pipeline).
function wrapAlignedBlocks(markdown: string, directives: AlignmentDirective[]): string {
  if (directives.length === 0) {
    return markdown
  }
  const chunks = splitTopLevelBlocks(markdown)
  const alignByIndex = new Map(directives.map((d) => [d.index, d.align]))
  return chunks
    .map((chunk, index) => {
      const align = alignByIndex.get(index)
      if (!align || /^\s*(```|~~~)/.test(chunk)) {
        return chunk
      }
      return `<div style="text-align:${align}">\n\n${chunk}\n\n</div>`
    })
    .join('\n\n')
}

export function useMarkdownRenderer() {
  const { ensureHighlighter, highlightCode, normalizeLanguage } = useShikiHighlighter()

  async function renderToHtml(markdown: string, options?: { themeMode?: 'auto' | 'light' | 'dark', hardenLinks?: boolean }) {
    const { marked } = await import('marked')
    const renderer = new marked.Renderer()

    // HTML (including raw fences / inline HTML) is sanitized by DOMPurify at the
    // end of the pipeline. The svg fence reuses the same sanitizer.
    const sanitize = sanitizeHtml

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
        return `<div class="svg-block">${sanitize(source)}</div>`
      }

      // Quarto-style raw HTML fence: emit the body as live (sanitized) HTML
      // rather than a highlighted code block.
      if (isRawHtmlFence(language)) {
        return sanitize(source)
      }

      // highlightCode returns escaped HTML when the highlighter isn't ready.
      return highlightCode(source, normalizeLanguage(language || 'text'), options?.themeMode || 'auto')
    }

    // Raw HTML in markdown (inline tags or blocks) is passed through verbatim;
    // the whole document is sanitized by DOMPurify at the end of renderToHtml,
    // which keeps safe formatting/markup (divs, spans, style, class) while
    // stripping scripts and event handlers. Alignment wrappers and <br> from
    // blank lines are preserved by the same sanitizer.
    renderer.html = (token: any) => {
      const html = typeof token === 'string' ? token : String(token?.text || '')
      return html
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

    // Alignments live in a single trailing marker line, stripped by
    // extractAlignment. Blocks are wrapped for display only; the markdown text
    // itself is never rewritten for style. (Previous normalize/restore passes
    // rewrote the whole document and were a corruption source.)
    const { clean, directives } = extractAlignment(markdown)
    const displayMarkdown = blankLinesToSpacers(wrapAlignedBlocks(clean, directives))

    return sanitizeHtml(String(marked.parse(displayMarkdown, {
      gfm: true,
      breaks: false,
      renderer,
      walkTokens: (token: any) => {
        if (token?.type === 'text' && typeof token.text === 'string') {
          token.text = emojifyText(token.text)
        }
      }
    })))
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
