export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const requestUrl = getRequestURL(event)
  const siteUrl = String(runtimeConfig.public.siteUrl || requestUrl.origin).replace(/\/+$/, '')
  const lastmod = new Date().toISOString()

  const routes = ['/', '/guide']
  const urls = routes
    .map((path) => [
      '<url>',
      `<loc>${siteUrl}${path}</loc>`,
      `<lastmod>${lastmod}</lastmod>`,
      '</url>'
    ].join(''))
    .join('')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>'
  ].join('')

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  })
})
