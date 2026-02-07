import { Node } from '@tiptap/core'

export const MarkdownTableBlock = Node.create({
  name: 'markdownTable',

  group: 'block',
  content: 'text*',
  marks: '',
  isolating: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'pre[data-type="markdown-table"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      {
        ...HTMLAttributes,
        'data-type': 'markdown-table',
        class: 'markdown-table-block'
      },
      ['code', 0]
    ]
  },

  markdownTokenName: 'table',

  parseMarkdown(token, helpers) {
    if (token.type !== 'table') {
      return []
    }

    const raw = String(token.raw || '').trimEnd()
    return helpers.createNode(
      'markdownTable',
      {},
      raw ? [helpers.createTextNode(raw)] : []
    )
  },

  renderMarkdown(node, helpers) {
    const raw = node.content ? helpers.renderChildren(node.content) : ''
    return raw.endsWith('\n') ? raw : `${raw}\n`
  }
})
