import type { Editor } from '@tiptap/vue-3'
import type { Node as PMNode } from '@tiptap/pm/model'

const ALIGN_VALUES = ['left', 'center', 'right'] as const
export type AlignValue = (typeof ALIGN_VALUES)[number]

export interface AlignmentDirective {
  index: number
  align: AlignValue
}

// Alignment persists as ONE marker line at the END of the document, e.g.
//   <!-- alignment: {"0":"center","3":"right"} -->
// Indices reference top-level editor blocks. A single trailing line never
// interleaves with content, so markdown parsing/serializing can't mangle it
// (the previous per-block markers and text-normalization passes were the
// source of progressive content corruption across save/load cycles).
const TRAILING_MARKER_RE = /^\s*<!--\s*alignment:\s*(\{[^\n]*\})\s*-->\s*$/
const LEGACY_MARKER_RE = /^<!--\s*align:\s*(left|center|right)\s*-->$/

// TipTap's markdown serializer emits `&nbsp;` (or a raw non-breaking space) for
// empty paragraphs so they survive round-trips. Those lines are pure blank-line
// markers: they pollute the markdown source and render inconsistently in print/PDF.
// Collapse them to genuine blank lines. The parser rebuilds empty paragraphs from
// blank lines (parseImplicitEmptyParagraphs), so the document round-trip stays intact.
// Consecutive blank lines are also collapsed to one so the stored markdown stays
// clean and blank lines map 1:1 to spacing in the preview/PDF. Fenced code blocks
// are left untouched so their literal content is never altered.
function normalizeBlankLineMarkers(markdown: string): string {
  let inFence = false
  let prevBlank = false
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      prevBlank = false
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const stripped = line
      .replace(/&nbsp;/g, '')
      .replace(/\u00A0/g, '')
      .trim()
    if (stripped === '') {
      if (prevBlank) {
        continue
      }
      prevBlank = true
      out.push('')
    } else {
      prevBlank = false
      out.push(line)
    }
  }
  return out.join('\n')
}

// Persist non-default alignment as a single trailing marker line appended to
// the standard Tiptap serialization. Lossless: the base markdown is produced
// entirely by the built-in serializer; the marker is recomputed from the
// current document state on every save.
export function serializeWithAlignment(editor: Editor): string {
  const base = normalizeBlankLineMarkers(editor.getMarkdown())
  const directives: Record<number, AlignValue> = {}
  editor.state.doc.forEach((node: PMNode, _offset: number, index: number) => {
    const align = (node.attrs?.textAlign as string | undefined) || ''
    if (align && align !== 'left' && (ALIGN_VALUES as readonly string[]).includes(align)) {
      directives[index] = align as AlignValue
    }
  })

  const entries = Object.entries(directives)
  if (entries.length === 0) {
    return base
  }

  return base.replace(/\n+$/, '') + `\n\n<!-- alignment: ${JSON.stringify(directives)} -->\n`
}

// Strip the (single trailing) alignment marker plus legacy per-block markers
// from older saves, and return clean markdown + which blocks get aligned.
// NO text normalization surgery here: every other line passes through
// untouched. Anything except markers stays byte-for-byte identical.
export function extractAlignment(markdown: string): { clean: string, directives: AlignmentDirective[] } {
  const directives: AlignmentDirective[] = []
  const lines = markdown.split('\n')
  const cleaned: string[] = []
  let fence = false
  let pendingAlign: AlignValue | null = null
  let blockIndex = 0
  let inBlock = false

  const claimBlock = (line: string) => {
    if (pendingAlign !== null) {
      directives.push({ index: blockIndex, align: pendingAlign })
      pendingAlign = null
    }
    blockIndex += 1
    inBlock = true
    cleaned.push(line)
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      claimBlock(line)
      continue
    }

    if (fence) {
      cleaned.push(line)
      continue
    }

    const trailing = line.match(TRAILING_MARKER_RE)
    if (trailing) {
      try {
        const map = JSON.parse(trailing[1]) as Record<string, string>
        for (const [idx, align] of Object.entries(map)) {
          const index = Number(idx)
          if (Number.isInteger(index) && index >= 0 && (ALIGN_VALUES as readonly string[]).includes(align)) {
            directives.push({ index, align: align as AlignValue })
          }
        }
      } catch {
        // Malformed marker: drop it silently.
      }
      continue
    }

    const legacy = line.match(LEGACY_MARKER_RE)
    if (legacy) {
      pendingAlign = legacy[1] as AlignValue
      inBlock = false
      continue
    }

    if (line.trim() === '') {
      if (inBlock) {
        inBlock = false
        cleaned.push('')
      } else {
        cleaned.push('')
      }
      continue
    }

    claimBlock(line)
  }

  return { clean: cleaned.join('\n'), directives }
}

// Re-apply extracted alignment directives as node attributes. Callers should
// suppress update listeners while this runs (it issues one transaction per
// directive); see the isApplyingContent guard in EditorWorkspace.
export function applyAlignmentDirectives(editor: Editor, directives: AlignmentDirective[]): void {
  if (!editor || directives.length === 0) {
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
      editor.chain().setTextSelection(pos + 1).setTextAlign(align).run()
    } catch {
      // Ignore failures for individual blocks (e.g. atom blocks).
    }
  }
}
