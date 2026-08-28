import { Node, mergeAttributes } from '@tiptap/core'

const SPACER_HTML = '<div class="markdown-spacer"></div>'

export const MarkdownSpacer = Node.create({
  name: 'markdownSpacer',

  group: 'block',

  atom: true,

  isolating: true,

  parseHTML() {
    return [{ tag: 'div.markdown-spacer' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'markdown-spacer' })]
  },

  markdownTokenName: 'html',

  parseMarkdown(token, helpers) {
    const raw = String(token.raw || token.text || '').trim()
    if (!/^<div\s+class=["']markdown-spacer["']\s*><\/div>$/i.test(raw)) {
      return []
    }

    return helpers.createNode('markdownSpacer')
  },

  renderMarkdown() {
    return SPACER_HTML
  }
})
