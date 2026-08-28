import { describe, expect, it } from 'vitest'
import {
  expandBlankRunsForParse,
  getSemanticEditorBlocks,
  isStructuralEmptyParagraph,
  normalizeMarkdownForStorage,
  serializeWithAlignment
} from '../app/utils/markdownAlignment'

function paragraph(text = '', textAlign = '') {
  return {
    type: { name: 'paragraph' },
    content: { size: text.length },
    attrs: { textAlign }
  }
}

function node(type: string, textAlign = '') {
  return {
    type: { name: type },
    content: { size: 0 },
    attrs: { textAlign }
  }
}

function editorWith(children: any[], markdown: string) {
  return {
    state: {
      doc: {
        forEach(callback: (child: any, offset: number, index: number) => void) {
          children.forEach((child, index) => callback(child, 0, index))
        }
      }
    },
    getMarkdown: () => markdown
  } as any
}

describe('markdown alignment and spacing boundaries', () => {
  it('uses the existing empty-paragraph predicate only for structural artifacts', () => {
    expect(isStructuralEmptyParagraph(paragraph())).toBe(true)
    expect(isStructuralEmptyParagraph(paragraph('authored'))).toBe(false)
    expect(isStructuralEmptyParagraph(node('svgBlock'))).toBe(false)
  })

  it('does not let an empty paragraph between SVG and heading shift alignment', () => {
    const editor = editorWith([
      node('svgBlock'),
      paragraph(),
      paragraph('Heading', 'center')
    ], '```svg\n<svg />\n```\n\n## Heading')

    expect(getSemanticEditorBlocks(editor).map(block => block.node.type.name)).toEqual([
      'svgBlock',
      'paragraph'
    ])
    expect(serializeWithAlignment(editor)).toContain('"1":"center"')
  })

  it('preserves an explicit spacer as a semantic non-paragraph node', () => {
    const editor = editorWith([
      node('svgBlock'),
      node('htmlBlock'),
      node('markdownSpacer'),
      paragraph('Heading', 'center')
    ], '```svg\n<svg />\n```\n\n```{=html}\n<div />\n```\n\n<div class="markdown-spacer"></div>\n\n## Heading')

    expect(getSemanticEditorBlocks(editor).map(block => block.node.type.name)).toEqual([
      'svgBlock',
      'htmlBlock',
      'markdownSpacer',
      'paragraph'
    ])
    expect(serializeWithAlignment(editor)).toContain('"3":"center"')
  })

  it('keeps normalization idempotent for explicit spacers', () => {
    const source = 'Before\n\n<div class="markdown-spacer"></div>\n\nAfter'
    const normalized = normalizeMarkdownForStorage(source)
    expect(normalizeMarkdownForStorage(normalized)).toBe(normalized)
  })

  it('does not duplicate the separator before a trailing alignment marker', () => {
    const source = [
      '## Test',
      '',
      '',
      'hi',
      '',
      '<div class="markdown-spacer"></div>',
      '',
      '<!-- alignment: {"0":"center"} -->'
    ].join('\n')

    expect(normalizeMarkdownForStorage(source)).toBe([
      '## Test',
      '',
      '',
      'hi',
      '',
      '<div class="markdown-spacer"></div>',
      '',
      '<!-- alignment: {"0":"center"} -->'
    ].join('\n'))
  })

  it('does not expand the structural separator after a closed SVG or HTML fence', () => {
    const svg = '```svg\n<svg />\n```\n\n## Heading'
    const html = '```{=html}\n<div />\n```\n\n## Heading'

    expect(expandBlankRunsForParse(svg)).toBe('```svg\n<svg />\n```\n## Heading')
    expect(expandBlankRunsForParse(html)).toBe('```{=html}\n<div />\n```\n## Heading')
  })

  it('canonicalizes repeated ordinary blank lines before headings after raw blocks', () => {
    const source = [
      '```svg',
      '<svg />',
      '```',
      '',
      '',
      '',
      '### First heading',
      '',
      '',
      '',
      '### Second heading',
      '',
      '',
      '',
      '### Third heading'
    ].join('\n')

    expect(normalizeMarkdownForStorage(source)).toBe([
      '```svg',
      '<svg />',
      '```',
      '',
      '### First heading',
      '',
      '### Second heading',
      '',
      '### Third heading'
    ].join('\n'))
  })

  it('preserves explicit spacers before headings', () => {
    const source = [
      '```svg',
      '<svg />',
      '```',
      '',
      '<div class="markdown-spacer"></div>',
      '',
      '### Heading'
    ].join('\n')

    expect(normalizeMarkdownForStorage(source)).toBe([
      '```svg',
      '<svg />',
      '```',
      '',
      '<div class="markdown-spacer"></div>',
      '',
      '### Heading'
    ].join('\n'))
  })

  it('never exposes editor-only nbsp markers in parse input or stored Markdown', () => {
    const source = '## Test\n\n\nhi\n&nbsp;\n&nbsp;'

    expect(expandBlankRunsForParse(source)).not.toContain('&nbsp;')
    expect(normalizeMarkdownForStorage(source)).not.toContain('&nbsp;')
    expect(normalizeMarkdownForStorage(source)).toBe('## Test\n\n\nhi')
  })
})
