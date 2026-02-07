import CodeBlock from '@tiptap/extension-code-block'

export const CodeBlockShiki = CodeBlock.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      defaultLanguage: 'javascript'
    }
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
    if (token.lang === 'mermaid') {
      return []
    }

    if (token.raw?.startsWith('```') === false && token.codeBlockStyle !== 'indented') {
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
  }
})
