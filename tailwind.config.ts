import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: [
    './app/**/*.{vue,ts}',
    './server/**/*.ts',
    './nuxt.config.ts'
  ],
  theme: {
    extend: {}
  },
  plugins: [typography]
} satisfies Config
