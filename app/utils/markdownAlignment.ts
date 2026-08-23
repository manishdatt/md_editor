import type { Editor } from '@tiptap/vue-3'

const ALIGN_VALUES = ['left', 'center', 'right'] as const
export type AlignValue = (typeof ALIGN_VALUES)[number]

const MARKER_RE = /^<!--\s*align:\s*(left|center|right)\s*-->$/

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

  return { clean: cleaned.join('\n'), directives }
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
