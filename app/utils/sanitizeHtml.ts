import DOMPurify from 'dompurify'

// Shared HTML sanitizer for raw-HTML blocks/fences and inline HTML. Permits
// layout/formatting tags plus style/class/id (Tailwind utility classes rely on
// `class`) but forbids scripting, event handlers, and page-wide <style> so the
// public share surface stays safe.
const HTML_SANITIZE_CONFIG: any = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'target', 'rel', 'style', 'class', 'id', 'width', 'height'],
  FORBID_TAGS: ['script', 'style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'object', 'embed', 'link', 'meta', 'base', 'noscript', 'template'],
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
    'onchange', 'onsubmit', 'oninput', 'onkeydown', 'onkeyup', 'onkeypress',
    'onpointerdown', 'onpointerup', 'onwheel', 'oncontextmenu'
  ]
}

let ready = false
function ensure() {
  if (ready) return
  DOMPurify.addHook('uponSanitizeElement', (node: any, data: any) => {
    const tag = String(data?.tagName || '').toLowerCase()
    // Only allow network iframes (no javascript:/data: embeds) to avoid script
    // execution on the public share page.
    if (tag === 'iframe' || tag === 'object' || tag === 'embed') {
      const src = node.getAttribute?.('src') || node.getAttribute?.('data-src') || ''
      if (src && !/^https?:\/\//i.test(src)) {
        node.parentNode?.removeChild(node)
      }
    }
  })
  ready = true
}

export function sanitizeHtml(html: string): string {
  ensure()
  return DOMPurify.sanitize(html, HTML_SANITIZE_CONFIG) as string
}
