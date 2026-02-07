import CodeBlock from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockNodeView from '~/components/editor/CodeBlockNodeView.vue'

export const CodeBlockShiki = CodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: 'text',
        parseHTML: (element) => {
          const classNames = [...(element.firstElementChild?.classList || [])]
          const language = classNames
            .find((className) => className.startsWith('language-'))
            ?.replace('language-', '')

          return language || 'text'
        }
      },
      code: {
        default: ''
      }
    }
  },

  content: '',
  atom: true,

  parseHTML() {
    return [{ tag: 'pre' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = String(node.attrs.language || 'text')
    const code = String(node.attrs.code || '')

    return [
      'pre',
      HTMLAttributes,
      ['code', { class: `language-${language}` }, code]
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(CodeBlockNodeView)
  },

  parseMarkdown(token, helpers) {
    if (token.lang === 'mermaid') {
      return []
    }

    if (token.raw?.startsWith('```') === false && token.codeBlockStyle !== 'indented') {
      return []
    }

    return helpers.createNode('codeBlock', {
      language: token.lang || 'text',
      code: token.text || ''
    })
  },

  renderMarkdown(node) {
    const language = String(node.attrs?.language || 'text')
    const code = String(node.attrs?.code || '')
    const suffix = code.endsWith('\n') ? '' : '\n'

    return `\`\`\`${language}\n${code}${suffix}\`\`\``
  }
})
