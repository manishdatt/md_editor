export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  compatibilityVersion: 4,
  modules: ['@nuxthub/core', '@nuxtjs/tailwindcss', '@clerk/nuxt'],
  clerk: {
    skipServerMiddleware: true
  },
  nitro: {
    preset: 'cloudflare_pages'
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en'
      },
      titleTemplate: '%s | bioinfo.guru',
      title: 'Markdown Editor | bioinfo.guru',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo_bioinfoguru.svg' }
      ],
      meta: [
        { name: 'description', content: 'Markdown editor with Mermaid, syntax highlighting, and PDF export.' },
        { name: 'theme-color', content: '#0a0a0a' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Markdown Editor' },
        { name: 'twitter:card', content: 'summary' }
      ]
    }
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://md.apps.bioinfo.guru'
    }
  },
  css: ['~/assets/css/tailwind.css'],
  hub: {
    db: 'sqlite'
  },
  devtools: { enabled: true }
})
