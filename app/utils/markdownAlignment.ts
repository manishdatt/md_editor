import type { Editor } from '@tiptap/vue-3'

const ALIGN_VALUES = ['left', 'center', 'right'] as const
export type AlignValue = (typeof ALIGN_VALUES)[number]

const MARKER_RE = /^<!--\s*align:\s*(left|center|right)\s*-->$/

// TipTap serializes a Shift+Enter (hard break) as `<br>`. A few legacy cases
// reach us as lines that are only whitespace (older saves used trailing spaces)
// or a lone backslash (a previous broken fix). Turn those into a single `<br>`.
//
// IMPORTANT: a *truly empty* line is a paragraph separator and must be left
// untouched. Converting it to `<br>` would turn every paragraph break into a
// hard break and, because the editor re-serializes `<br>` as `<br>` on save,
// the breaks would multiply on every save/load cycle (runaway `<br>` growth in
// the editor). We also never inject a trailing blank line after `<br>`.
export function normalizeHardBreaks(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      fence = !fence
      out.push(line)
      continue
    }
    if (fence) {
      out.push(line)
      continue
    }
    // Paragraph separator — keep intact.
    if (line === '') {
      out.push('')
      continue
    }
    const t = line.trim()
    // Legacy blank-line breaks: whitespace-only line or a lone backslash.
    if (t === '' || t === '\\') {
      out.push('<br>')
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

// Markdown has no native alignment syntax, so aligned blocks are prefixed with
// a comment marker. This survives the TipTap markdown round-trip (the comment is
// inert) while `parseAlignment` lets us re-apply the alignment after loading.
export function docToMarkdownWithAlignment(editor: Editor): string {
  const manager = editor.markdown?.manager ?? editor.markdown
  if (!manager) {
    return editor.getMarkdown()
  }

  const blocks: string[] = []
  editor.state.doc.forEach((node) => {
    const md = manager.renderNodeToMarkdown(node.toJSON())
    const align = (node.attrs?.textAlign as string | undefined) || ''
    if (align && align !== 'left' && (ALIGN_VALUES as readonly string[]).includes(align)) {
      blocks.push(`<!-- align:${align} -->\n\n${md}`)
    } else {
      blocks.push(md)
    }
  })
  return blocks.join('\n\n')
}

export interface AlignmentDirective {
  index: number
  align: AlignValue
}

// Remove alignment marker comments and report which top-level block index each
// directive applies to (0-based, matching the editor document's children).
export function parseAlignment(markdown: string): { clean: string, directives: AlignmentDirective[] } {
  const lines = markdown.split('\n')
  const cleaned: string[] = []
  const directives: AlignmentDirective[] = []
  let fence = false
  let inBlock = false
  let nextRealIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      fence = !fence
    }

    const marker = !fence ? line.match(MARKER_RE) : null
    if (marker) {
      // The next real (non-marker) block gets this alignment.
      directives.push({ index: nextRealIndex, align: marker[1] as AlignValue })
      inBlock = false
      continue
    }

    if (!fence && line.trim() === '') {
      if (inBlock) {
        inBlock = false
      }
      cleaned.push('')
      continue
    }

    if (!inBlock) {
      inBlock = true
      nextRealIndex += 1
    }
    cleaned.push(line)
  }

  return { clean: restoreMarkdownSyntax(normalizeHardBreaks(cleaned.join('\n'))), directives }
}

// When raw markdown syntax was typed as literal text (before markdown input
// rules were enabled, or in pasted content), TipTap escaped the special
// characters, e.g. `\[text\](url)`, `\*\*bold\*\*`, `\# heading`. Restore those
// escapes so the syntax parses correctly on load and in the preview. Applied
// only outside fenced code blocks.
export function restoreMarkdownSyntax(markdown: string): string {
  const lines = markdown.split('\n')
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      fence = !fence
      continue
    }
    if (!fence) {
      lines[i] = line.replace(/\\(?=[*_~#[\]()>])/g, '')
    }
  }
  return lines.join('\n')
}

export function applyAlignmentDirectives(editor: Editor, directives: AlignmentDirective[]): void {
  if (!editor) {
    return
  }
  for (const { index, align } of directives) {
    if (index < 0 || index >= editor.state.doc.childCount) {
      continue
    }
    let pos = 0
    for (let j = 0; j < index; j++) {
      const child = editor.state.doc.child(j)
      if (!child) {
        break
      }
      pos += child.nodeSize
    }
    try {
      editor.chain().setTextNodeSelection(pos).setTextAlign(align).run()
    } catch {
      // Ignore failures for individual blocks.
    }
  }
}
