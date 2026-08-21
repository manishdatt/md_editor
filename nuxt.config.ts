export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  compatibilityVersion: 4,
  modules: ['@nuxtjs/tailwindcss'],
  nitro: {
    preset: 'cloudflare_pages'
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en'
      },
      titleTemplate: '%s | bioinfo.guru',
      title: 'shbd | bioinfo.guru',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo_bioinfoguru.svg' }
      ],
      meta: [
        { name: 'description', content: 'Markdown editor with Mermaid, syntax highlighting, and PDF export.' },
        { name: 'theme-color', content: '#0a0a0a' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'shbd' },
        { name: 'twitter:card', content: 'summary' }
      ]
    }
  },
  runtimeConfig: {
    tursoUrl: process.env.TURSO_URL || '',
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || '',
    betterAuthUrl: process.env.BETTER_AUTH_URL || '',
    githubClientId: process.env.GITHUB_CLIENT_ID || '',
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    aiProvider: process.env.NUXT_AI_PROVIDER || 'gemini',
    geminiApiKey: process.env.NUXT_GEMINI_API_KEY || '',
    geminiModel: process.env.NUXT_GEMINI_MODEL || 'gemini-2.5-flash-lite',
    nvidiaApiKey: process.env.NUXT_NVIDIA_API_KEY || '',
    nvidiaModel: process.env.NUXT_NVIDIA_MODEL || 'meta/llama-3.1-8b-instruct',
    pdfServiceUrl: process.env.NUXT_PDF_SERVICE_URL || '',
    pdfServiceKey: process.env.NUXT_PDF_SERVICE_KEY || '',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://shbd.bioinfo.guru'
    }
  },
  css: ['~/assets/css/tailwind.css'],
  devtools: { enabled: true }
})
