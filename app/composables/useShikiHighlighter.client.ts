import { shallowRef } from 'vue'

const highlighter = shallowRef<any>(null)
const highlighterPromise = shallowRef<Promise<any> | null>(null)

const languageAliases: Record<string, string> = {
  cjs: 'javascript',
  html5: 'html',
  js: 'javascript',
  mjs: 'javascript',
  md: 'markdown',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  yml: 'yaml'
}

const supportedLanguages = new Set([
  'text',
  'plaintext',
  'bash',
  'css',
  'html',
  'javascript',
  'json',
  'markdown',
  'sql',
  'typescript',
  'vue',
  'yaml'
])

function withLanguageClasses(html: string, language: string) {
  const langClass = `language-${language}`
  return html
    .replace('<pre class="', `<pre class="${langClass} `)
    .replace('<code>', `<code class="${langClass}">`)
}

async function ensureHighlighter() {
  if (highlighter.value) {
    return highlighter.value
  }

  if (!highlighterPromise.value) {
    highlighterPromise.value = (async () => {
      const shiki = await import('shiki')
      highlighter.value = await shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [...supportedLanguages]
      })
      return highlighter.value
    })()
  }

  return highlighterPromise.value
}

export function useShikiHighlighter() {
  function normalizeLanguage(language: string) {
    const normalized = language.trim().toLowerCase()
    const resolved = languageAliases[normalized] || normalized

    return supportedLanguages.has(resolved) ? resolved : 'plaintext'
  }

  function highlightCode(code: string, language: string) {
    if (!highlighter.value) {
      return `<pre class="language-${language}"><code class="language-${language}">${code
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')}</code></pre>`
    }

    const lang = normalizeLanguage(language || 'text')
    const html = highlighter.value.codeToHtml(code, {
      lang,
      themes: {
        light: 'github-light',
        dark: 'github-dark'
      }
    })

    return withLanguageClasses(html, lang)
  }

  return {
    ensureHighlighter,
    highlightCode,
    normalizeLanguage
  }
}
