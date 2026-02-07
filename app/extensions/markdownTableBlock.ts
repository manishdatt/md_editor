import { Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

export const MarkdownTableBlock = Node.create({
  name: 'markdownTable',

  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  whitespace: 'pre',
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
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) {
            return null
          }

          let tr = newState.tr
          let changed = false

          const emptyNodes: Array<{ from: number, to: number }> = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) {
              return
            }

            if (node.textContent.trim().length === 0) {
              emptyNodes.push({ from: pos, to: pos + node.nodeSize })
            }
          })

          for (let i = emptyNodes.length - 1; i >= 0; i -= 1) {
            const range = emptyNodes[i]
            tr = tr.delete(range.from, range.to)
            changed = true
          }

          return changed ? tr : null
        }
      })
    ]
  }
})
