export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const requestUrl = getRequestURL(event)
  const siteUrl = String(runtimeConfig.public.siteUrl || requestUrl.origin).replace(/\/+$/, '')

  const content = [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${siteUrl}/sitemap.xml`
  ].join('\n')

  return new Response(content, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  })
})
