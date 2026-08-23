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
    // Paragraph separator — keep intact (prevents runaway <br> growth).
      if (line === '') {
        out.push('')
        continue
      }
      const t = line.trim()
      // A line that is only <br> token(s): a standalone break. Never leave it on
      // its own line — the markdown-it HTML-block parser drops a lone `<br>` block
      // and `RawHtmlText` can't place a bare `hardBreak` node. Glue it onto the
      // previous non-empty line as a trailing inline break (which round-trips
      // reliably). Drop it when it sits immediately after a code fence.
      if (/^(?:<br\s*\/?>\s*)+$/i.test(t)) {
        if (/^```\s*$/.test(out[out.length - 1] || '')) {
          continue
        }
        const count = (t.match(/<br>/gi) || []).length
        // Glue onto the last non-empty line (skipping any blank separator lines
        // between the break and the previous block) so the break stays inline.
        let li = out.length - 1
        while (li >= 0 && out[li] === '') li--
        if (li >= 0) {
          out[li] = out[li] + '<br>'.repeat(count)
        } else {
          for (let k = 0; k < count; k++) {
            out.push('<br>')
          }
        }
        continue
      }
      // Whitespace-only line: only a real Markdown hard break (two or more
      // trailing spaces) is preserved; any other whitespace-only line is a
      // legacy artifact and is dropped.
      if (t === '') {
        if (/\s{2,}$/.test(line)) {
          out.push(line)
        }
        continue
      }
    // Line starting with one or more <br>: keep the break glued to the rest of
    // the line (inline) so it parses as a real break instead of a dropped block.
    const leading = t.match(/^(?:<br\s*\/?>\s*)+/i)
    if (leading) {
      const count = (leading[0].match(/<br>/gi) || []).length
      const rest = line.slice(leading[0].length)
      out.push('<br>'.repeat(count) + rest)
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
      // No blank line between the marker and the block: a leading blank line
      // would become a spurious block-0 in the editor, shifting the alignment
      // directive onto the wrong block (centering lost on refresh).
      blocks.push(`<!-- align:${align} -->\n${md}`)
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
  const rawLines = markdown.split('\n')
  const cleaned: string[] = []
  const directives: AlignmentDirective[] = []
  let fence = false
  let inBlock = false
  let nextRealIndex = 0
  // A marker defers its target to the *next real block* after it. This makes
  // alignment robust to any lines (blank lines, breaks) sitting between the
  // marker and its block — previously those lines shifted the directive onto
  // the wrong block, so centering was lost on refresh.
  let pendingAlign: AlignValue | null = null

  const startBlock = (line: string) => {
    const blockIndex = nextRealIndex
    nextRealIndex += 1
    if (pendingAlign !== null) {
      directives.push({ index: blockIndex, align: pendingAlign })
      pendingAlign = null
    }
    inBlock = true
    cleaned.push(line)
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (/^\s*```/.test(line)) {
      fence = !fence
      startBlock(line)
      continue
    }

    const marker = !fence ? line.match(MARKER_RE) : null
    if (marker) {
      pendingAlign = marker[1] as AlignValue
      inBlock = false
      continue
    }

    const trimmed = line.trim()
    // HTML-escaped form of a Shift+Enter break. The markdown serializer escapes a
    // leading `<br>` to `&lt;br&gt;`, so on load this is a real break, not literal
    // text. Restore it to a `<br>` line (kept, but not counted as a top-level
    // block) so `normalizeHardBreaks` can glue it and round-trip it.
    if (/^&lt;br\s*\/?&gt;$/i.test(trimmed)) {
      cleaned.push('<br>')
      continue
    }
    // Whitespace-only line: a Markdown hard break (Shift+Enter) serializes as a
    // line ending in two or more spaces, which is only whitespace. Keep those as
    // real blocks so the break survives the round-trip; other whitespace-only
    // lines are legacy artifacts and are dropped.
    if (trimmed === '' && line !== '') {
      if (/\s{2,}$/.test(line)) {
        startBlock(line)
      }
      continue
    }
    // Standalone real break (`<br>`): a genuine Shift+Enter break. Keep the line
    // (so `normalizeHardBreaks` can glue it to an adjacent line and round-trip
    // it as an inline break) but do NOT count it as a top-level block — otherwise
    // the alignment directive indices shift and centering is lost.
    if (!fence && /^<br\s*\/?>$/i.test(trimmed)) {
      cleaned.push(line)
      continue
    }

    if (!fence && trimmed === '') {
      if (inBlock) {
        inBlock = false
      }
      cleaned.push('')
      continue
    }

    startBlock(line)
  }

  return { clean: normalizeHardBreaks(restoreMarkdownSyntax(cleaned.join('\n'))), directives }
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
      // Stored literal `<br>` text (HTML-escaped by the markdown serializer when
      // it was typed/pasted) should round-trip as a real break, not as visible
      // `<br>` characters.
      lines[i] = lines[i].replace(/&lt;br\s*\/?&gt;/gi, '<br>')
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
    // Select *inside* the block (its first content position) so `setTextAlign`
    // reliably targets this node. `setTextNodeSelection(pos)` fails for the
    // first block because `pos` (0) precedes the text node, which silently
    // dropped alignment on refresh.
    try {
      editor.chain().setTextSelection(pos + 1).setTextAlign(align).run()
    } catch {
      // Ignore failures for individual blocks (e.g. atom blocks).
    }
  }
}
