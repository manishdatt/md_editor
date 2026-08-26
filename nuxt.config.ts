export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
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
        { rel: 'icon', type: 'image/svg+xml', href: '/logo_bioinfoguru.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Laila:wght@400;600;700&display=swap' }
      ],
      meta: [
        { name: 'description', content: 'Markdown editor with Mermaid, syntax highlighting, and PDF export.' },
        { name: 'theme-color', content: '#0a0a0a' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'shbd' },
        { name: 'twitter:card', content: 'summary' }
      ],
      // Tailwind Play CDN (preflight disabled) so utility classes authored inside
      // raw-HTML blocks style correctly at runtime. Build-time Tailwind only scans
      // source files, so dynamically inserted HTML needs a runtime generator.
      script: [
        { innerHTML: 'window.tailwind={config:{corePlugins:{preflight:false}}};', tagPosition: 'head' },
        { src: 'https://cdn.tailwindcss.com', tagPosition: 'head' }
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
    aiProvider: process.env.NUXT_AI_PROVIDER || 'nvidia',
    geminiApiKey: process.env.NUXT_GEMINI_API_KEY || '',
    geminiModel: process.env.NUXT_GEMINI_MODEL || 'gemini-3.5-flash-lite',
    nvidiaApiKey: process.env.NUXT_NVIDIA_API_KEY || '',
    nvidiaModel: process.env.NUXT_NVIDIA_MODEL || 'openai/gpt-oss-20b',
    pdfServiceUrl: process.env.NUXT_PDF_SERVICE_URL || '',
    pdfServiceKey: process.env.NUXT_PDF_SERVICE_KEY || '',
    adminEmails: process.env.ADMIN_EMAILS || '',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://shbd.bioinfo.guru'
    }
  },
  css: ['~/assets/css/tailwind.css'],
  vite: {
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'
    }
  },
  devtools: { enabled: true }
})
