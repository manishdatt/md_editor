function normalizeBlankLineMarkers(markdown: string): string {
  let inFence = false
  let runBlanks = 0
  let runMarkers = 0
  const out: string[] = []
  const flushRun = () => {
    if (runBlanks === 0 && runMarkers === 0) {
      return
    }
    const keep = runMarkers + 1
    for (let i = 0; i < keep; i++) {
      out.push('')
    }
    runBlanks = 0
    runMarkers = 0
  }
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      flushRun()
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') {
      runBlanks += 1
      continue
    }
    if (trimmed.replace(/&nbsp;/g, '').replace(/\u00A0/g, '') === '') {
      runMarkers += 1
      continue
    }
    flushRun()
    out.push(line)
  }
  flushRun()
  return out.join('\n')
}
module.exports = { normalizeBlankLineMarkers };