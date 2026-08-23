// Real-extension round-trip test (TipTap + actual app extensions).
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import HardBreak from '@tiptap/extension-hard-break'
import TextAlign from '@tiptap/extension-text-align'
import { Markdown } from '@tiptap/markdown'
import { RawHtmlText } from './app/extensions/rawHtmlText'
import { parseAlignment, normalizeHardBreaks, docToMarkdownWithAlignment, applyAlignmentDirectives } from './app/utils/markdownAlignment'

const CONTENT = `## Introduction to Python Web Apps

Build web apps with Python. <br>
Use Flask, FastAPI, or Django for backends.

<br>
Start here with a Shift+Enter at the start of a line.

\`\`\`python
org-mode + Quarto = powerful.
\`\`\`

<br>
Another break at start, then [link](https://example.com).
`
const RAW = '## Heading with break\n\nFirst line. <br>\nSecond line with break.\n\n<br>\nStart with a break at the very start of a line.\n'

function makeEditor() {
  return new Editor({
    element: document.getElementById('app'),
    extensions: [
      Document, Paragraph, Text,
      Heading.configure({ levels: [1, 2, 3] }),
      HardBreak.extend({ renderMarkdown: () => '<br>\n' }),
      Markdown.configure({ html: true, hardBreak: false, link: { markdownLinks: true } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      RawHtmlText
    ],
    content: '<p>Hello</p>'
  })
}

function reload(editor, md) {
  const { clean, directives } = parseAlignment(md)
  require('fs').writeFileSync('test_clean.txt', clean)
  editor.commands.setContent(clean, { contentType: 'markdown' })
  applyAlignmentDirectives(editor, directives, editor.getJSON())
}

function countBreaks(json) {
  let n = 0
  const walk = (node) => {
    if (!node) return
    if (node.type === 'hardBreak') n++
    ;(node.content || []).forEach(walk)
  }
  ;(json.content || []).forEach(walk)
  return n
}

function breaksAtStartOfAnyPara(json) {
  return (json.content || []).some(p => p.type === 'paragraph' && p.content && p.content[0] && p.content[0].type === 'hardBreak')
}

function docHeadingsCentered(doc) {
  let found = false
  doc.forEach((n) => { if (n.type.name === 'heading' && n.attrs && n.attrs.textAlign === 'center') found = true })
  return found
}

const editor = makeEditor(); console.log('markdown mgr?', !!editor.markdown, 'parse?', typeof (editor.markdown && editor.markdown.parse))
editor.commands.setContent(CONTENT, { contentType: 'markdown' })
// Mimic the app: select the heading, then center it.
editor.commands.setTextSelection(1)
editor.commands.setTextAlign('center')
const hd = editor.state.doc.firstChild
console.log('HEADING attrs:', JSON.stringify(hd && hd.attrs), 'type:', hd && hd.type.name)
const md = docToMarkdownWithAlignment(editor)
console.log('SERIALIZED:\n' + md + '\n---')

// RELOAD 1
reload(editor, md)
require('fs').writeFileSync('test_doc.json', JSON.stringify(editor.getJSON(), null, 1))
console.log('TEST-SIDE heading attrs:', JSON.stringify(editor.state.doc.firstChild && editor.state.doc.firstChild.attrs), 'type:', editor.state.doc.firstChild && editor.state.doc.firstChild.type.name)
const j1 = editor.getJSON()
const center1 = docHeadingsCentered(editor.state.doc)
const breaks1 = countBreaks(j1)
const startBreak1 = breaksAtStartOfAnyPara(j1)
console.log('RELOAD1: heading centered?', center1, '| total breaks?', breaks1, '| start-of-line break?', startBreak1)

// RELOAD 2 (re-serialize then reload)
const md2 = docToMarkdownWithAlignment(editor)
reload(editor, md2)
const j2 = editor.getJSON()
const center2 = docHeadingsCentered(editor.state.doc)
const breaks2 = countBreaks(j2)
const startBreak2 = breaksAtStartOfAnyPara(j2)
console.log('RELOAD2: heading centered?', center2, '| total breaks?', breaks2, '| start-of-line break?', startBreak2)

// RAW content test (markdown with <br> at start of line)
editor.commands.setContent(RAW, { contentType: 'markdown' })
const mdR = docToMarkdownWithAlignment(editor)
reload(editor, mdR)
const jR = editor.getJSON()
console.log('RAW round-trip: start-of-line break?', breaksAtStartOfAnyPara(jR), '| total breaks?', countBreaks(jR))

console.log('RESULT:', (center1 && center2 && breaks1 === 3 && breaks2 === 3 && countBreaks(jR) === 2) ? 'PASS' : 'FAIL')
editor.destroy()
