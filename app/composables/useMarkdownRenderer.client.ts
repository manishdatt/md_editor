import { useShikiHighlighter } from '~/composables/useShikiHighlighter.client'
import { extractAlignment, normalizeMarkdownForStorage, type AlignmentDirective } from '~/utils/markdownAlignment'
import { sanitizeHtml } from '~/utils/sanitizeHtml'
import { gemoji } from 'gemoji'

let mermaidInstancePromise: Promise<any> | null = null

// Full shortcode -> emoji lookup built once from the gemoji dataset (~1870
// entries). `names` includes GitHub-style aliases (+1, -1, thumbsup,
// white_check_mark, ...), so every common `:name:` works without a hardcoded
// list. Unknown shortcodes are left untouched by emojifyText.
const emojiShortcodes = new Map<string, string>()
for (const entry of gemoji) {
  for (const name of entry.names) {
    emojiShortcodes.set(name.toLowerCase(), entry.emoji)
  }
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

// Shortcode names may contain underscores, and text typed in the TipTap editor
// reaches this renderer with them escaped by the markdown serializer
// (`:white_check_mark:` serializes to `:white\_check\_mark:`). Match both
// forms; unknown shortcodes are returned untouched.
const EMOJI_SHORTCODE_RE = /:(([a-z0-9+_-]|\\_)+):/gi

function emojifyText(value: string) {
  return value.replace(EMOJI_SHORTCODE_RE, (full, rawName: string) => {
    const name = rawName.replace(/\\_/g, '_').toLowerCase()
    return emojiShortcodes.get(name) || full
  })
}

// Emojify runs BEFORE markdown parsing, not per-token afterwards: the lexer
// splits escaped underscores (`white\_check`) into separate text/escape tokens
// and intraword emphasis tokenization can fragment names, so a full `:name:`
// is often no longer present in any single post-parse token. Fence blocks and
// inline code spans are skipped so code keeps its literal content.
function emojifyMarkdown(markdown: string): string {
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) {
        return line
      }
      return line
        .split(/(`+[^`\n]*`+)/)
        .map((part, index) => (index % 2 === 1 ? part : emojifyText(part)))
        .join('')
    })
    .join('\n')
}

// Quarto raw-HTML fence (` ```{=html} `) and a simpler `rawhtml` alias render
// their body as live HTML instead of a highlighted code block.
function isRawHtmlFence(language: string): boolean {
  const lang = String(language || '').trim().toLowerCase()
  return lang === '{=html}' || lang === 'rawhtml' || lang === 'htmlraw'
}

// Markdown itself treats repeated blank lines as one block separator. During
// rendering only, convert the additional authored gaps into explicit spacer
// elements. This keeps persisted Markdown canonical while making preview and
// PDF spacing deterministic.
const LIST_ITEM_LINE_RE = /^\s*([-*+]|\d{1,9}[.)])\s/

function renderBlankLineGaps(markdown: string): string {
  const lines = markdown.split('\n')
  let inFence = false
  let lastContentLine: string | null = null
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      lastContentLine = line
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    if (line.trim() === '') {
      let runEnd = i
      while (runEnd < lines.length && lines[runEnd].trim() === '') {
        runEnd += 1
      }
      let nextContentLine: string | null = null
      for (let j = runEnd; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextContentLine = lines[j]
          break
        }
      }
      const insideList = Boolean(
        lastContentLine
        && nextContentLine
        && LIST_ITEM_LINE_RE.test(lastContentLine)
        && LIST_ITEM_LINE_RE.test(nextContentLine)
      )
      const gaps = Math.max(runEnd - i - 1, 0)
      if (!insideList) {
        for (let g = 0; g < gaps; g++) {
          out.push('<div class="markdown-spacer" aria-hidden="true"></div>')
          out.push('')
        }
        out.push('')
      } else {
        for (let k = i; k < runEnd; k++) {
          out.push('')
        }
      }
      i = runEnd - 1
      continue
    }
    lastContentLine = line
    out.push(line)
  }
  return out.join('\n')
}

// Split markdown into top-level block chunks (blank-line separated, fence
// aware), PRESERVING the exact blank-line runs between chunks: those runs
// encode intentional vertical spacing (see blankLinesToSpacers) and must not
// collapse when chunks are reassembled by wrapAlignedBlocks.
interface TopLevelChunk {
  text: string
  separatorBefore: string
}

function splitTopLevelChunks(markdown: string): { chunks: TopLevelChunk[], trailingSeparator: string } {
  const chunks: TopLevelChunk[] = []
  const lines = markdown.split('\n')
  let fence = false
  let current: string[] = []
  let pendingSeparator = ''
  const flush = () => {
    if (current.length > 0) {
      chunks.push({ text: current.join('\n'), separatorBefore: pendingSeparator })
      current = []
      pendingSeparator = ''
    }
  }
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      current.push(line)
      continue
    }
    if (!fence && line.trim() === '') {
      // The separator must reproduce the source bytes: the newline that ends
      // the previous content line (only for the FIRST blank after content)
      // plus one newline per blank line.
      const endsContentLine = current.length > 0
      flush()
      if (endsContentLine) {
        pendingSeparator += '\n'
      }
      pendingSeparator += '\n'
      continue
    }
    current.push(line)
  }
  flush()
  return { chunks, trailingSeparator: pendingSeparator }
}

// Wrap aligned blocks in styled divs for display. This is purely presentational
// and runs only on the preview input — it NEVER touches persisted content, so
// it cannot corrupt documents across renders (unlike the previous whole-doc
// markdown-rewriting pipeline). Blank-line runs between chunks are re-emitted
// verbatim so authored spacing survives alignment wrapping.
function wrapAlignedBlocks(markdown: string, directives: AlignmentDirective[]): string {
  if (directives.length === 0) {
    return markdown
  }
  const { chunks, trailingSeparator } = splitTopLevelChunks(markdown)
  const alignByIndex = new Map(directives.map((d) => [d.index, d.align]))
  let out = ''
  chunks.forEach((chunk, index) => {
    const align = alignByIndex.get(index)
    const text = align && !/^\s*(```|~~~)/.test(chunk.text)
      ? `<div style="text-align:${align}">\n\n${chunk.text}\n\n</div>`
      : chunk.text
    out += chunk.separatorBefore + text
  })
  return out + trailingSeparator
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

    // Emojify first (pre-parse): the markdown lexer fragments escaped
    // underscores into separate tokens, so per-token replacement misses
    // shortcodes like :white\_check\_mark:. Canonicalize legacy `&nbsp;`
    // markers before parsing so stored content renders exactly like the
    // editor's normalized live preview.
    const { clean, directives } = extractAlignment(normalizeMarkdownForStorage(emojifyMarkdown(markdown)))
    const displayMarkdown = renderBlankLineGaps(wrapAlignedBlocks(clean, directives))

    return sanitizeHtml(String(marked.parse(displayMarkdown, {
      gfm: true,
      breaks: false,
      renderer
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
