import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import SvgNodeView from '~/components/editor/SvgNodeView.vue'

export const SvgBlock = Node.create({
  name: 'svgBlock',

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
    return [{ tag: 'div[data-type="svg-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'svg-block',
        class: 'svg-block'
      }),
      String(node.attrs.code || '')
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(SvgNodeView)
  },

  markdownTokenName: 'code',

  parseMarkdown(token, helpers) {
    if (token.lang !== 'svg') {
      return []
    }

    return helpers.createNode('svgBlock', {
      code: token.text || ''
    })
  },

  renderMarkdown(node) {
    const code = String(node.attrs?.code || '')
    const suffix = code.endsWith('\n') ? '' : '\n'
    return `\`\`\`svg\n${code}${suffix}\`\`\``
  }
})
