import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import MermaidNodeView from '~/components/editor/MermaidNodeView.vue'

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',

  group: 'block',
  atom: true,
  isolating: true,

  addAttributes() {
    return {
      code: {
        default: ''
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mermaid-block',
        class: 'mermaid'
      }),
      String(node.attrs.code || '')
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(MermaidNodeView)
  },

  markdownTokenName: 'code',

  parseMarkdown(token, helpers) {
    if (token.lang !== 'mermaid') {
      return []
    }

    return helpers.createNode('mermaidBlock', {
      code: token.text || ''
    })
  },

  renderMarkdown(node) {
    const code = String(node.attrs?.code || '')
    const suffix = code.endsWith('\n') ? '' : '\n'
    return `\`\`\`mermaid\n${code}${suffix}\`\`\``
  }
})
