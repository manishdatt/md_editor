import { Extension } from '@tiptap/core'

export const RawHtmlText = Extension.create({
  name: 'rawHtmlText',

  markdownTokenName: 'html',

  parseMarkdown(token, helpers) {
    const raw = typeof token.raw === 'string' ? token.raw : ''
    // A literal `<br>` (or `<br/>`) is a hard break, not text to display. Turn
    // it into a real `hardBreak` node so Shift+Enter round-trips in the editor
    // instead of rendering as visible "<br>" text.
    if (/^\s*<br\s*\/?>\s*$/i.test(raw)) {
      return { type: 'hardBreak' }
    }
    return raw ? helpers.createTextNode(raw) : []
  }
})
