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

// STORAGE FORMAT: documents are persisted as canonical Markdown with LF line
// endings and ordinary blank-line runs. TipTap's `&nbsp;` empty-paragraph form
// is used only when feeding content into the parser, because the parser needs
// explicit empty paragraphs to reconstruct repeated spacing. It must never be
// emitted as the long-term storage format.

const LIST_ITEM_LINE_RE = /^\s*([-*+]|\d{1,9}[.)])\s/

const EMPTY_PARAGRAPH_MARKER_RE = /^\s*(?:&nbsp;|\u00a0)\s*$/i

/**
 * Normalize content at the persistence boundary.
 *
 * This is deliberately idempotent. It converts legacy TipTap empty-paragraph
 * marker lines back to ordinary blank-line runs, while leaving fenced code and
 * legitimate non-breaking spaces untouched.
 */
export function normalizeMarkdownForStorage(markdown: string): string {
  const normalized = String(markdown || '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const out: string[] = []
  let inFence = false
  let blankCount = 0
  let markerCount = 0

  const flush = () => {
    if (blankCount === 0 && markerCount === 0) {
      return
    }

    const count = markerCount > 0 ? markerCount + 1 : blankCount
    for (let i = 0; i < count; i += 1) {
      out.push('')
    }
    blankCount = 0
    markerCount = 0
  }

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush()
      inFence = !inFence
      out.push(line)
      continue
    }

    if (inFence) {
      out.push(line)
      continue
    }

    if (line.trim() === '') {
      blankCount += 1
      continue
    }

    if (EMPTY_PARAGRAPH_MARKER_RE.test(line)) {
      markerCount += 1
      continue
    }

    flush()
    out.push(line)
  }

  flush()
  return out.join('\n')
}

// Stored documents encode B consecutive blank lines as B-1 intentional empty
// paragraphs (older blank-line-encoded saves and hand-authored files). The
// markdown loader rebuilds empty paragraphs by COUNTING `\n\n` separators in
// whitespace runs (parseImplicitEmptyParagraphs), which is lossy for plain
// blank-line runs. Call this BEFORE setContent: it re-expands each run into
// the library's canonical lossless form (explicit `&nbsp;` marker
// paragraphs), so the parser rebuilds exactly B-1 empty paragraphs.
// IDEMPOTENT on canonical storage (single blank separators are untouched),
// so it is always safe to call. Fences are skipped and loose-list separators
// (blank line between two list items) are left alone.
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
// the canonical Markdown serialization. The alignment marker is recomputed
// from the current document state on every save.
export function serializeWithAlignment(editor: Editor): string {
  const base = normalizeMarkdownForStorage(editor.getMarkdown())
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
  let sawMarker = false

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
      sawMarker = true
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

  // Removing the trailing marker line leaves the separator blank(s) that
  // preceded it dangling at EOF, which the preview would render as one
  // phantom spacer at the bottom of the document. Drop them — but only when
  // a marker was actually removed, so authorial trailing spacing in
  // marker-free documents is preserved byte-for-byte.
  if (sawMarker) {
    while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') {
      cleaned.pop()
    }
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
