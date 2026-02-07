import { Extension } from '@tiptap/core'

export const RawHtmlText = Extension.create({
  name: 'rawHtmlText',

  markdownTokenName: 'html',

  parseMarkdown(token, helpers) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    return raw ? helpers.createTextNode(raw) : []
  }
})
