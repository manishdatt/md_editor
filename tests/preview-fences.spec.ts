import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keep the test environment light: avoid loading Shiki (heavy) and avoid
// requiring a DOM for DOMPurify by stubbing the two side-effecting helpers.
// We are asserting that `marked` routes ` ```{=html} ` / ` ```svg` ` fences to
// the live-HTML branch — i.e. the exact regression that shipped with the
// unpinned transitive `marked` (which silently stopped tokenizing fences).
vi.mock('~/composables/useShikiHighlighter.client', () => ({
  useShikiHighlighter: () => ({
    ensureHighlighter: () => Promise.resolve(),
    highlightCode: (src: string, lang: string) => `<code class="language-${lang}">${src}</code>`,
    normalizeLanguage: (l: string) => l,
  }),
}))

vi.mock('~/utils/sanitizeHtml', () => ({
  sanitizeHtml: (html: string) => html,
}))

import { useMarkdownRenderer } from '~/composables/useMarkdownRenderer.client'

describe('preview renders raw-HTML and SVG fences as live HTML', () => {
  let renderToHtml: (md: string) => Promise<string>

  beforeEach(() => {
    renderToHtml = useMarkdownRenderer().renderToHtml
  })

  it('renders ```{=html} as live HTML, not a code block', async () => {
    const html = await renderToHtml('```{=html}\n<div class="x">hi</div>\n```')
    expect(html).toContain('<div class="x">hi</div>')
    expect(html).not.toContain('<code')
    expect(html).not.toContain('&lt;div')
  })

  it('renders ```svg as live SVG, not a code block', async () => {
    const html = await renderToHtml('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')
    expect(html).toContain('<svg')
    expect(html).not.toContain('<code')
    expect(html).not.toContain('&lt;svg')
  })

  it('still renders ordinary code fences as highlighted code', async () => {
    const html = await renderToHtml('```js\nconst a = 1\n```')
    expect(html).toContain('<code')
  })

  it('renders ```{=html} immediately followed by a heading', async () => {
    const md = '```{=html}\n<div class="x">hi</div>\n```\n\n# Title'
    const html = await renderToHtml(md)
    expect(html).toContain('<div class="x">hi</div>')
    expect(html).toContain('Title')
    expect(html).not.toContain('<code')
  })
})
