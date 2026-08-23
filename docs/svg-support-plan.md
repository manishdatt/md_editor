# Inline SVG Support in the Editor

Status: implemented (2026-08-23) · Created: 2026-08-23 · Revised: 2026-08-23 (review fixes applied) · Companion to: `docs/public-share-links-plan.md`

Goal: let authors write SVG markup **inside a fenced ` ```svg ` block** and have it render
live in the editor, appear in the preview pane, appear in the client-side PDF export, and
(for shared docs) render on the public `/p/<token>` page — **without** opening an
arbitrary-HTML XSS hole.

---

## 0. Research: is there a native Tiptap extension for this?

**No.** Full extension registry checked (`github.com/ueberdosis/tiptap/packages`) plus npm
community search — nothing for inline SVG markup. Closest official node:

- `@tiptap/extension-image` — only renders `<img src="…">` from an external URL. It cannot
  accept inline SVG markup, has no fenced-markdown support, and no sanitization.

A custom `svgBlock` node extension mirroring the existing `MermaidBlock` is therefore the
correct (and only) approach. This plan implements that.

## 1. Current state (verified)

| Concern | Where | Notes |
|---|---|---|
| Editor | `app/components/editor/EditorWorkspace.client.vue` | Tiptap, `contentType: 'markdown'`, `@tiptap/markdown` |
| Extensions | `initializeEditor()` (~lines 515-529) | StarterKit (no codeBlock), Markdown, RawHtmlText, **CodeBlockShiki**, MarkdownTableBlock, **MermaidBlock**, AiGhostText |
| Raw HTML | `app/extensions/rawHtmlText.ts` | ⚠️ **Does NOT render HTML.** It parses markdown `html` tokens into **text nodes** (`createTextNode`) purely so raw markup survives round-trip editing. Raw `<svg>` today shows as literal/escaped text in both the editor pane and the preview pane — it is NOT rendered anywhere. |
| Preview + public rendering | `app/composables/useMarkdownRenderer.client.ts` → `renderToHtml()` | The preview pane (`v-html="previewHtml"`), the PDF export (`exportPdf()` rasterizes `previewRef`), and the public share page (`SharedDocPreview`) all flow through this ONE marked pipeline. `renderer.html = escapeHtml` (raw HTML is escaped), `renderer.code` routes ` ```mermaid ` to a div already. |
| Code-fence dispatch | `@tiptap/markdown` | `code` tokens go to extensions **in registration order, first non-empty `parseMarkdown` wins**. `CodeBlockShiki.parseMarkdown` currently only skips `mermaid`. |
| Mermaid block pattern | `app/extensions/mermaidBlock.ts` | `Node` + `VueNodeViewRenderer` + `parseMarkdown` on ```` ```mermaid ```` + `renderMarkdown` round-trip → ideal template, shape verified exact |
| PDF export (markdown) | `EditorWorkspace.client.vue` `exportPdf()` | html2pdf.js rasterizes `previewRef` DOM — **inline** SVG captures fine; `<foreignObject>` and most SVG filter effects do NOT (html2canvas limits) |

**Finding:** nothing renders SVG today. The feature must be added in TWO places that share
the requirement: (a) a Tiptap node for the editor pane, and (b) a ` ```svg ` branch in
`renderToHtml()` for the preview pane / PDF / public page. (b) is the one that actually
satisfies "SVG appears in the PDF".

## 2. Approach chosen

**Dedicated ` ```svg ` fenced block** (recommended). Rejected alternative: rely on raw
inline `<svg>` passthrough — it does not render today, would need raw-HTML rendering to be
enabled (broad XSS surface), and is inconsistent with the controlled-block style used for
Mermaid and tables.

One sanctioned path, everywhere:

```
```svg
<svg viewBox="0 0 100 100">…</svg>
```
```

- Editor pane: `svgBlock` Tiptap node + `SvgNodeView` (sanitized `v-html`).
- Preview pane / PDF / public `/p/<token>`: ` ```svg ` branch in `renderToHtml()` with the
  SAME DOMPurify sanitization.
- Raw HTML outside a fence stays **escaped everywhere** (unchanged contract — matches the
  share-link plan's UI-level-hiding stance; do not widen it).

## 3. Design

### 3.1 New extension — `app/extensions/svgBlock.ts`
Copy `mermaidBlock.ts` nearly verbatim, swapping the language tag and NodeView. The shape
below is verified against the real extension:

```ts
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import SvgNodeView from '~/components/editor/SvgNodeView.vue'

export const SvgBlock = Node.create({
  name: 'svgBlock',
  group: 'block',
  atom: true,
  isolating: true,
  addAttributes() { return { code: { default: '' } } },
  parseHTML() { return [{ tag: 'div[data-type="svg-block"]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'svg-block',
      class: 'svg-block'
    }), String(node.attrs.code || '')] // text child is escaped by Tiptap — source only
  },
  addNodeView() { return VueNodeViewRenderer(SvgNodeView) },
  markdownTokenName: 'code',
  parseMarkdown(token, helpers) {
    if (token.lang !== 'svg') return []
    return helpers.createNode('svgBlock', { code: token.text || '' })
  },
  renderMarkdown(node) {
    const code = String(node.attrs?.code || '')
    const suffix = code.endsWith('\n') ? '' : '\n'
    return '```svg\n' + code + suffix + '```'
  }
})
```

### 3.2 New component — `app/components/editor/SvgNodeView.vue`
Sanitized render via `v-html` (DOMPurify loaded lazily, like `marked`):

```vue
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
const props = defineProps<{ node?: any }>()
const code = computed(() => props.node?.attrs?.code || '')
const safe = ref('')
watchEffect(async () => {
  const DOMPurify = (await import('dompurify')).default
  safe.value = DOMPurify.sanitize(code.value, { USE_PROFILES: { svg: true, svgFilters: true } })
})
</script>

<template>
  <div class="svg-block" v-html="safe" />
</template>
```

### 3.3 Preview/PDF/public branch — `app/composables/useMarkdownRenderer.client.ts`
**This is the task that makes the PDF export and public page work.** Mirror the existing
mermaid branch in `renderToHtml()`:

```ts
renderer.code = ({ text, lang }: any) => {
  const language = String(lang || '').trim().toLowerCase()
  if (language === 'mermaid') return `<div class="mermaid">${escapeHtml(source)}</div>`
  if (language === 'svg') return `<div class="svg-block">${sanitizeSvg(text)}</div>`  // NEW
  return highlightCode(source, normalizeLanguage(language || 'text'), options?.themeMode || 'auto')
}

// sanitizeSvg: lazy dompurify import; USE_PROFILES svg + svgFilters
```

The public share page (`SharedDocPreview`) uses `renderToHtml()` — this branch
**automatically** gives it identical sanitized SVG. No extra pass needed there.

### 3.4 Code-fence dispatch guard — `app/extensions/codeBlockShiki.ts`
`CodeBlockShiki` is registered **before** `SvgBlock` and only skips `mermaid`, so it would
claim ` ```svg ` fences and Shiki-highlight them. Add:

```ts
if (token.lang === 'mermaid' || token.lang === 'svg') return []
```

AND register `SvgBlock` **before** `CodeBlockShiki` in `initializeEditor()` (belt and
braces — mirror how MermaidBlock is positioned).

### 3.5 Register — `EditorWorkspace.client.vue`
`extensions: [StarterKit…, Markdown, RawHtmlText, SvgBlock, CodeBlockShiki, MermaidTableBlock… ]`
(SvgBlock adjacent to MermaidBlock, before CodeBlockShiki.) Optional: toolbar "SVG" button
mirroring the Mermaid insert button for discoverability.

### 3.6 Raw HTML policy (replaces old §3.4)
Raw HTML **stays escaped everywhere** (editor preview, PDF, public page) — this is the
deliberate contract, not a gap. The fenced ` ```svg ` block is the only sanctioned way to
render SVG, private or public. Do NOT sanitize-and-render `RawHtmlText` output on shared
pages.

### 3.7 Dependency
`npm i dompurify` (v3, ships its own TS types). NOT `isomorphic-dompurify` — its jsdom
fallback is unnecessary weight for browser-only consumers and risks leaking into the
Cloudflare worker bundle. All consumers are `.client` files.

### 3.8 Styling
Add minimal `.svg-block` CSS (`app/assets/css/tailwind.css`): centered, `max-width: 100%`,
`overflow-x: auto` — mirroring the `.mermaid` look.

## 4. PDF / export fidelity
- `exportPdf()` rasterizes `previewRef` via html2canvas. **Inline** SVG from §3.3 is
  captured fine.
- `<foreignObject>` inside SVG is stripped by DOMPurify's svg profile anyway, and
  html2canvas doesn't support it — acceptable.
- SVG **filter effects** (`svgFilters: true` keeps them allowed) may be lost/approximated
  in html2canvas rasterization — document the caveat.
- **External-URL SVG** (`<img src="https://…/x.svg">` or `<image href="…">` cross-origin)
  can taint the canvas. Recommend inline/embedded SVG or data-URIs.
- Typst `.typ` documents: out of scope (markdown-only, matches the share scope). Typst
  users embed SVGs as files via `image("file.svg")`.

## 5. Tasks

| # | Task | File(s) |
|---|---|---|
| 1 | Create `SvgBlock` extension | `app/extensions/svgBlock.ts` (new) |
| 2 | Create `SvgNodeView` (sanitized render) | `app/components/editor/SvgNodeView.vue` (new) |
| 3 | **` ```svg ` branch in `renderToHtml()`** (preview + PDF + public) | `app/composables/useMarkdownRenderer.client.ts` |
| 4 | Skip-guard for `svg` fences | `app/extensions/codeBlockShiki.ts` |
| 5 | Register extension (before CodeBlockShiki) + optional toolbar button | `app/components/editor/EditorWorkspace.client.vue` |
| 6 | Add DOMPurify dependency | `package.json` → `npm i dompurify` |
| 7 | `.svg-block` styles | `app/assets/css/tailwind.css` |
| 8 | Guide docs for ```` ```svg ```` | `app/pages/guide.vue` (optional) |

## 6. Testing checklist

- [ ] ```` ```svg ```` block renders an SVG in the **editor pane** (SvgNodeView)
- [ ] Same SVG renders in the **preview pane** (renderToHtml branch — not escaped text)
- [ ] Same SVG appears in the **PDF export** (download, open, verify visible)
- [ ] Edits to the block update previews live
- [ ] Malicious SVG (`<svg onload=alert(1)>`, embedded `<script>`, `xlink:href="javascript:…"`)
      is stripped by DOMPurify in BOTH the NodeView and the marked branch
- [ ] On public `/p/<token>`: fenced SVG renders; **raw inline `<svg>` (no fence) stays
      escaped text** (contract locked in)
- [ ] Fence reaches `SvgBlock`, not `CodeBlockShiki` (registration-order regression guard)
- [ ] Round-trip: content saved → reloaded → ` ```svg ` block intact (markdown serialization)
- [ ] External-URL SVG docs note present (taint caveat)

## 7. Out of scope / notes
- Typst `.typ` documents: inline-SVG via this block does not apply; use file-based
  `image()` in Typst separately.
- If product later wants general HTML widgets, introduce them as their own controlled
  blocks rather than opening raw-HTML rendering on shared pages.
