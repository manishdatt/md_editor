import CodeBlock from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockNodeView from '~/components/editor/CodeBlockNodeView.vue'

export const CodeBlockShiki = CodeBlock.extend({
  addOptions() {
    return {
      ...(this.parent?.() || {}),
      defaultLanguage: 'javascript'
    } as any
  },

  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage,
        parseHTML: (element) => {
          const classNames = [...(element.firstElementChild?.classList || [])]
          const language = classNames
            .find((className) => className.startsWith('language-'))
            ?.replace('language-', '')

          return language || this.options.defaultLanguage
        },
        rendered: false
      }
    }
  },

  parseMarkdown(token, helpers) {
    // svg/mermaid fences belong to their dedicated blocks
    const language = String(token.lang || '').trim().toLowerCase()
    const normalizedLanguage = language.replace(/^\{/, '').replace(/\}$/, '')
    if (normalizedLanguage === 'mermaid' || normalizedLanguage === 'svg' || normalizedLanguage === '=html' || normalizedLanguage === 'html' || normalizedLanguage === 'rawhtml' || normalizedLanguage === 'htmlraw') {
      return []
    }

    const raw = String(token.raw || '')
    if (!raw.startsWith('```') && !raw.startsWith('~~~') && token.codeBlockStyle !== 'indented') {
      return []
    }

    return helpers.createNode(
      'codeBlock',
      { language: token.lang || this.options.defaultLanguage },
      token.text ? [helpers.createTextNode(token.text)] : []
    )
  },

  renderMarkdown(node, h) {
    const language = String(node.attrs?.language || this.options.defaultLanguage || 'text')
    const content = node.content ? h.renderChildren(node.content) : ''
    const suffix = content.endsWith('\n') ? '' : '\n'

    return `\`\`\`${language}\n${content}${suffix}\`\`\``
  },

  addNodeView() {
    return VueNodeViewRenderer(CodeBlockNodeView as any)
  }
})
