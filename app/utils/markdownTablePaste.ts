import { marked } from 'marked'

/** Return the clipboard payload only when it is exactly one valid GFM table. */
export function getPastedMarkdownTable(value: string): string | null {
  const candidate = String(value || '')
    .replace(/\r\n?/g, '\n')
    // Some Markdown-capable sources escape the leading pipe when copying
    // table text. It is only safe to remove that escape at line start; pipes
    // inside cells may be intentional literal content.
    .replace(/^\s*\\\|/gm, line => line.replace('\\|', '|'))
    // Preserve the intended whitespace when clipboard text contains the
    // commonly emitted HTML space entity.
    .replace(/&#x20;/gi, ' ')
    .trim()
  if (!candidate || candidate.includes('```') || candidate.includes('~~~')) {
    return null
  }

  const lines = candidate.split('\n')
  if (lines.length < 2 || lines.some(line => line.trim() === '')) {
    return null
  }

  const tokens = marked.lexer(candidate, { gfm: true })
  return tokens.length === 1 && tokens[0]?.type === 'table' ? candidate : null
}
