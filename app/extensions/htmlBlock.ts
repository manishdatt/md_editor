import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import HtmlBlockView from '~/components/editor/HtmlBlockView.vue'

function isRawHtmlFence(language: string): boolean {
  const lang = String(language || '').trim().toLowerCase()
  const normalized = lang.replace(/^\{/, '').replace(/\}$/, '')
  return normalized === '=html' || normalized === 'html' || normalized === 'rawhtml' || normalized === 'htmlraw'
}

export const HtmlBlock = Node.create({
  name: 'htmlBlock',

  group: 'block',

  atom: true,

  isolating: true,

  addAttributes() {
    return {
      html: {
        default: ''
      }
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="html-block"]',
      getAttrs: (el: any) => ({ html: el.getAttribute('data-html') || '' })
    }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'html-block',
        'data-html': String(node.attrs.html || ''),
        class: 'html-block'
      }),
      ''
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(HtmlBlockView)
  },

  markdownTokenName: 'code',

  parseMarkdown(token, helpers) {
    if (!isRawHtmlFence(String(token.lang || ''))) {
      return []
    }

    return helpers.createNode('htmlBlock', {
      html: token.text || ''
    })
  },

  renderMarkdown(node) {
    const code = String(node.attrs?.html || '')
    const suffix = code.endsWith('\n') ? '' : '\n'
    return `\`\`\`{=html}\n${code}${suffix}\`\`\``
  }
})
