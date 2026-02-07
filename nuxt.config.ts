export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  compatibilityVersion: 4,
  modules: ['@nuxthub/core', '@nuxtjs/tailwindcss'],
  nitro: {
    preset: 'cloudflare_pages'
  },
  css: ['~/assets/css/tailwind.css'],
  hub: {
    db: 'sqlite'
  },
  devtools: { enabled: true }
})
