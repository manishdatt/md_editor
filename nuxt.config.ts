export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  compatibilityVersion: 4,
  modules: ['@nuxthub/core', '@nuxtjs/tailwindcss', '@clerk/nuxt'],
  nitro: {
    preset: 'cloudflare_pages'
  },
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo_bioinfoguru.svg' }
      ]
    }
  },
  css: ['~/assets/css/tailwind.css'],
  hub: {
    db: 'sqlite'
  },
  devtools: { enabled: true }
})
