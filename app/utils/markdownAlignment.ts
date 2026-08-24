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
// empty paragraphs so they survive round-trips, joined by `\n\n` block
// separators: "para1\n\n&nbsp;\n\n&nbsp;\n\npara2" = two empty lines, while a
// plain "para1\n\npara2" separator is NOT an intentional empty line.
// Encode the difference so the preview can tell them apart: every run of
// blank-ish lines becomes `markers + 1` plain blank lines (markers = number of
// `&nbsp;` lines in the run). A pure separator stays 1 blank line (= 0 gaps);
// each empty paragraph adds exactly one blank line (= 1 gap). The preview side
// (blankLinesToSpacers) mirrors this by rendering B consecutive blanks as B-1
// visible spacers. Keeps stored markdown clean of `&nbsp;` while preserving
// how many empty lines the author typed. Fenced code blocks are untouched;
// inline `&nbsp;` inside text lines is preserved.
function normalizeBlankLineMarkers(markdown: string): string {
  let inFence = false
  let runBlanks = 0
  let runMarkers = 0
  const out: string[] = []
  const flushRun = () => {
    if (runBlanks === 0 && runMarkers === 0) {
      return
    }
    const keep = runMarkers + 1
    for (let i = 0; i < keep; i++) {
      out.push('')
    }
    runBlanks = 0
    runMarkers = 0
  }
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      flushRun()
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') {
      runBlanks += 1
      continue
    }
    if (trimmed.replace(/&nbsp;/g, '').replace(/\u00A0/g, '') === '') {
      runMarkers += 1
      continue
    }
    flushRun()
    out.push(line)
  }
  flushRun()
  return out.join('\n')
}

const LIST_ITEM_LINE_RE = /^\s*([-*+]|\d{1,9}[.)])\s/

// Stored documents encode B consecutive blank lines as B-1 intentional empty
// paragraphs (see normalizeBlankLineMarkers). The markdown loader rebuilds
// empty paragraphs by COUNTING `\n\n` separators in whitespace runs
// (parseImplicitEmptyParagraphs), which is lossy for plain blank-line runs —
// typed spacing decays on every save/load cycle. Call this BEFORE setContent:
// it re-expands each run into the library's canonical lossless form (explicit
// `&nbsp;` marker paragraphs), so the parser rebuilds exactly B-1 empty
// paragraphs. The stored file itself is never touched. Fences are skipped and
// loose-list separators (blank line between two list items) are left alone.
export function expandBlankRunsForParse(markdown: string): string {
  const lines = markdown.split('\n')
  let inFence = false
  let lastContentLine: string | null = null
  const out: string[] = []

  const emitRun = (runLength: number, nextContentLine: string | null) => {
    const insideList = Boolean(
      lastContentLine
      && nextContentLine
      && LIST_ITEM_LINE_RE.test(lastContentLine)
      && LIST_ITEM_LINE_RE.test(nextContentLine)
    )
    if (insideList) {
      for (let i = 0; i < runLength; i++) {
        out.push('')
      }
      return
    }
    const empties = Math.max(runLength - 1, 0)
    // One retained blank line separates the previous block from the first
    // marker (markdown needs it), then each `&nbsp;` marker is followed by its
    // own blank line — reproducing the serializer's canonical layout exactly:
    // "para1\n\n&nbsp;\n\n&nbsp;\n\npara2".
    out.push('')
    for (let e = 0; e < empties; e++) {
      out.push('&nbsp;')
      out.push('')
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
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
        if (/^\s*```/.test(lines[j])) {
          break
        }
        if (lines[j].trim() !== '') {
          nextContentLine = lines[j]
          break
        }
      }
      emitRun(runEnd - i, nextContentLine)
      i = runEnd - 1
      continue
    }
    lastContentLine = line
    out.push(line)
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
