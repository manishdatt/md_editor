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
// endings, ordinary blank-line runs, and explicit `.markdown-spacer` elements
// for extra authored gaps. TipTap's `&nbsp;` empty-paragraph form is used only
// when feeding content into the parser and is never persisted.

const LIST_ITEM_LINE_RE = /^\s*([-*+]|\d{1,9}[.)])\s/

const EMPTY_PARAGRAPH_MARKER_RE = /^\s*(?:&nbsp;|\u00a0)\s*$/i
const MARKDOWN_SPACER_RE = /^\s*<div\s+class=["']markdown-spacer["'](?:\s+[^>]*)?>\s*<\/div>\s*$/i
const MARKDOWN_SPACER = '<div class="markdown-spacer"></div>'

export interface SemanticEditorBlock {
  node: PMNode
  childIndex: number
  sourceIndex: number
}

// TipTap may materialize a structural Markdown separator as an empty
// paragraph. It is not a source block and must not affect alignment indices.
// Keep this exact predicate in one place: broadening it would risk consuming
// intentional spacer/content nodes.
export function isStructuralEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0
}

// Enumerate editor children using the same semantic indexing contract used by
// the Markdown alignment marker. Non-paragraph nodes—including explicit HTML
// spacer nodes and SVG/HTML atoms—remain source blocks.
export function getSemanticEditorBlocks(editor: Pick<Editor, 'state'>): SemanticEditorBlock[] {
  const blocks: SemanticEditorBlock[] = []
  let sourceIndex = 0

  editor.state.doc.forEach((node: PMNode, _offset: number, childIndex: number) => {
    if (isStructuralEmptyParagraph(node)) {
      return
    }

    blocks.push({ node, childIndex, sourceIndex })
    sourceIndex += 1
  })

  return blocks
}

/**
 * Normalize content at the persistence boundary.
 *
 * This is deliberately idempotent. It converts legacy TipTap empty-paragraph
 * marker lines back to the explicit spacer representation, while leaving fenced
 * code and legitimate non-breaking spaces untouched.
 */
export function normalizeMarkdownForStorage(markdown: string): string {
  const normalized = String(markdown || '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const out: string[] = []
  let inFence = false
  let blankCount = 0
  let spacerSeparatorPending = false

  // Flush accumulated blank lines into `out`.
  const flush = () => {
    if (blankCount === 0) {
      return
    }
    // Canonical storage uses exactly one blank separator between ordinary
    // Markdown blocks. Additional authored vertical space must be represented
    // by an explicit markdownSpacer node, not by an unstable run of empty
    // paragraphs that TipTap may serialize differently on reload.
    out.push('')
    blankCount = 0
  }

  // Emit a markdown-spacer div surrounded by exactly one blank line on each
  // side. The blank lines are required so that `marked` (with gfm:true) treats
  // the div as a block-level HTML element rather than wrapping it in a <p>,
  // which would add unwanted paragraph margins on top of the spacer height.
  const emitSpacer = () => {
    // Discard any accumulated blanks — they will be replaced by the single
    // blank that we emit explicitly before the div.
    blankCount = 0
    // Ensure there is a blank before the spacer (but not if we are at the
    // very start of the document or immediately after another spacer).
    if (out.length > 0 && out[out.length - 1] !== '') {
      out.push('')
    }
    out.push(MARKDOWN_SPACER)
    // Always emit a blank after the spacer so the next content line starts a
    // new block rather than continuing the spacer's HTML context.
    out.push('')
    // The next source blank, when present, may be the structural separator
    // already represented by the blank above. Consume exactly one such blank
    // instead of turning it into an additional persisted blank line.
    spacerSeparatorPending = true
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
      if (spacerSeparatorPending) {
        spacerSeparatorPending = false
        continue
      }
      blankCount += 1
      continue
    }

    spacerSeparatorPending = false

    // Both the legacy &nbsp; form (from old TipTap saves) and the canonical
    // markdown-spacer form are converted to a properly-padded spacer div.
    if (EMPTY_PARAGRAPH_MARKER_RE.test(line)) {
      emitSpacer()
      continue
    }

    if (MARKDOWN_SPACER_RE.test(line)) {
      emitSpacer()
      continue
    }

    flush()
    out.push(line)
  }

  flush()

  // Strip a single trailing blank that emitSpacer() may have left at EOF so
  // documents do not grow a spurious trailing newline on every save cycle.
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop()
  }

  return out.join('\n')
}

// Stored documents encode B consecutive blank lines as B-1 intentional empty
// paragraphs (older blank-line-encoded saves and hand-authored files). The
// markdown loader rebuilds empty paragraphs by COUNTING `\n\n` separators in
// whitespace runs (parseImplicitEmptyParagraphs), which is lossy for plain
// blank-line runs. Call this BEFORE setContent: it re-expands each run into
// the library's internal lossless form (explicit `&nbsp;` marker paragraphs),
// so the parser rebuilds exactly B-1 empty paragraphs.
// IDEMPOTENT on canonical storage (single blank separators are untouched),
// so it is always safe to call. Fences are skipped and loose-list separators
// (blank line between two list items) are left alone.
export function expandBlankRunsForParse(markdown: string): string {
  // Pass 1: Preserve markdown-spacer divs as explicit spacer nodes, consuming
  // the surrounding structural blank lines that normalization emits. Turning
  // a spacer into &nbsp; here makes TipTap materialize it as an empty paragraph
  // and can expose the entity at the editor boundary.
  const sourceLines = markdown.split('\n')
  const lines: string[] = []
  let sourceInFence = false

  for (let si = 0; si < sourceLines.length; si++) {
    const srcLine = sourceLines[si] ?? ''
    if (/^\s*(```|~~~)/.test(srcLine)) {
      sourceInFence = !sourceInFence
      lines.push(srcLine)
      continue
    }
    if (!sourceInFence && MARKDOWN_SPACER_RE.test(srcLine)) {
      // Drop the blank line we emitted BEFORE the spacer (last entry in
      // `lines` is that blank, if it exists).
      const lastLine = lines[lines.length - 1]
      if (lastLine !== undefined && lastLine.trim() === '') {
        lines.pop()
      }
      lines.push(MARKDOWN_SPACER)
      // Skip the blank line that normalizeMarkdownForStorage emitted AFTER.
      const nextLine = sourceLines[si + 1]
      if (nextLine !== undefined && nextLine.trim() === '') {
        si += 1
      }
      continue
    }
    lines.push(srcLine)
  }

  // Pass 2: Expand runs of blank lines into &nbsp; marker paragraphs so that
  // TipTap's markdown parser reconstructs empty paragraphs correctly.
  let inFence = false
  let lastContentLine: string | null = null
  const out: string[] = []

  const emitRun = (runLength: number, nextContentLine: string | null) => {
    // A fenced block is already terminated by its closing fence. Keeping the
    // single separator after it is useful in source Markdown, but feeding it
    // to TipTap can materialize an extra empty paragraph after raw HTML/code.
    // Do not expand that separator in the editor parse input.
    const followsClosedFence = Boolean(lastContentLine && /^\s*(```|~~~)/.test(lastContentLine))
    if (runLength === 1 && followsClosedFence) {
      return
    }

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
    const line = lines[i] ?? ''
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
      while (runEnd < lines.length && (lines[runEnd] ?? '').trim() === '') {
        runEnd += 1
      }
      let nextContentLine: string | null = null
      for (let j = runEnd; j < lines.length; j++) {
        const checkLine = lines[j] ?? ''
        if (/^\s*(```|~~~)/.test(checkLine)) {
          break
        }
        if (checkLine.trim() !== '') {
          nextContentLine = checkLine
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
  for (const { node, sourceIndex } of getSemanticEditorBlocks(editor)) {
    const align = (node.attrs?.textAlign as string | undefined) || ''
    if (align && align !== 'left' && (ALIGN_VALUES as readonly string[]).includes(align)) {
      directives[sourceIndex] = align as AlignValue
    }
  }

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
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) {
        // A fenced code block is one top-level editor block. Count it when
        // the opening fence is encountered; the closing fence only completes
        // that same block and must not advance the alignment index.
        fence = true
        claimBlock(line)
      } else {
        fence = false
        inBlock = false
        cleaned.push(line)
      }
      continue
    }

    if (fence) {
      cleaned.push(line)
      continue
    }

    const trailing = line.match(TRAILING_MARKER_RE)
    if (trailing && trailing[1]) {
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
      }
      cleaned.push('')
      continue
    }

    if (inBlock) {
      // Continuation line within the same block (e.g. multi-line paragraph or element)
      cleaned.push(line)
    } else {
      claimBlock(line)
    }
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

  // Markdown parsing can materialize a blank separator as an empty paragraph
  // (notably after fenced raw-HTML blocks). Those paragraphs are not source
  // blocks and therefore are not represented in the trailing alignment map.
  // Ignore them when translating the persisted source index to a ProseMirror
  // child position; otherwise {"1":"center"} can be applied to the block
  // immediately before the intended heading.
  const sourceChildren = getSemanticEditorBlocks(editor)

  for (const { index, align } of directives) {
    const target = sourceChildren[index]
    if (!target) {
      continue
    }

    let pos = 0
    for (let j = 0; j < target.childIndex; j++) {
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
