import type { Editor } from '@tiptap/vue-3'

const ALIGN_VALUES = ['left', 'center', 'right'] as const
export type AlignValue = (typeof ALIGN_VALUES)[number]

const MARKER_RE = /^<!--\s*align:\s*(left|center|right)\s*-->$/

// TipTap serializes a Shift+Enter on an empty line as a line containing only two
// A blank line in markdown is just a block separator and collapses to nothing,
// so a Shift+Enter on an empty line appears to "do nothing" in the preview.
// Render such blank lines as a visible hard break. Two legacy cases reach us:
//   - a line that is only whitespace (older saves serialized the break as
//     trailing spaces, i.e. "  \n")
//   - a line that is only a backslash (an earlier broken fix serialized the
//     break as "\"+newline)
// We emit "<br>" as its own block FOLLOWED BY a separator blank line. This is
// critical: a bare "<br>" line is a markdown HTML block that otherwise merges
// with the following line, swallowing a heading/list/paragraph into one blob.
// We also split runs of "<br>" and "<br>" prefixes so following blocks keep
// their block status. Inline "<br>" (e.g. "text<br>text") is left untouched.
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
    const t = line.trim()
    // Whitespace-only line or a lone backslash: a blank-line break.
    if (t === '' || t === '\\') {
      out.push('<br>')
      out.push('')
      continue
    }
    // A line that is only one or more "<br>": split into separate breaks,
    // each followed by a separator blank line.
    if (/^(?:<br>\s*)+$/i.test(t)) {
      const count = (t.match(/<br>/gi) || []).length
      for (let k = 0; k < count; k++) {
        out.push('<br>')
        out.push('')
      }
      continue
    }
    // A line starting with one or more "<br>" then other content
    // (e.g. "<br><br>### Heading"): emit the breaks first, then the rest.
    const leading = t.match(/^(?:<br>\s*)+/i)
    if (leading) {
      const count = (leading[0].match(/<br>/gi) || []).length
      for (let k = 0; k < count; k++) {
        out.push('<br>')
        out.push('')
      }
      out.push(line.slice(leading[0].length))
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
