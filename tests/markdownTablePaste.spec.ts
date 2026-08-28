import { describe, expect, it } from 'vitest'
import { getPastedMarkdownTable } from '../app/utils/markdownTablePaste'

describe('Markdown table paste detection', () => {
  it('accepts a complete GFM table and normalizes line endings', () => {
    expect(getPastedMarkdownTable('| A | B |\r\n| --- | --- |\r\n| 1 | 2 |')).toBe(
      '| A | B |\n| --- | --- |\n| 1 | 2 |'
    )
  })

  it('accepts copied tables with escaped leading pipes and HTML spaces', () => {
    expect(getPastedMarkdownTable('| col 1 | Col 2 | col 3 |\n\\| --- | --- | --- |&#x20;\n\\| Name| 23  | 45|')).toBe(
      '| col 1 | Col 2 | col 3 |\n| --- | --- | --- | \n| Name| 23  | 45|'
    )
  })

  it('rejects ordinary pipe text and incomplete table syntax', () => {
    expect(getPastedMarkdownTable('one | two')).toBeNull()
    expect(getPastedMarkdownTable('| A | B |\nplain text')).toBeNull()
  })

  it('rejects fenced content so code stays plain text', () => {
    expect(getPastedMarkdownTable('```md\n| A | B |\n| --- | --- |\n```')).toBeNull()
  })
})
