<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { authClient } from '~/lib/auth-client'

const sessionState = authClient.useSession()
const isSignedIn = computed(() => Boolean(sessionState.value?.data?.user))
const isLoaded = computed(() => !sessionState.value?.isPending)

const pendingProvider = ref<'github' | 'google' | null>(null)
const authError = ref('')

// Already authenticated: nothing to do here.
watch(isLoaded, (loaded) => {
  if (loaded && isSignedIn.value) {
    window.location.assign('/')
  }
}, { immediate: true })

async function signInWith(provider: 'github' | 'google') {
  authError.value = ''
  pendingProvider.value = provider
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL: '/',
      // Handle the redirect below so errors and malformed responses are
      // surfaced instead of being swallowed by the client's auto-redirect.
      disableRedirect: true
    })

    if (result?.error) {
      authError.value = result.error.message || (result.error as any)?.statusText || `Sign in with ${provider} failed (${result.error.status})`
      pendingProvider.value = null
      return
    }

    const redirectUrl = (result as any)?.data?.url || (result as any)?.url || (result as any)?.data?.redirectUrl
    if (redirectUrl) {
      window.location.assign(redirectUrl)
    } else {
      authError.value = `Sign in with ${provider} did not return a redirect URL`
      pendingProvider.value = null
    }
  } catch (err: any) {
    const detail = err?.data?.message || err?.data?.error || err?.data?.detail || err?.message || String(err)
    authError.value = detail ? `Failed: ${detail}` : `Failed to initiate ${provider} sign in`
    pendingProvider.value = null
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
    <div class="w-full max-w-sm rounded-lg border border-neutral-300 bg-white p-8 dark:border-neutral-700 dark:bg-neutral-900">
      <div class="mb-6 flex flex-col items-center text-center">
        <NuxtLink to="/" aria-label="shbd home" class="mb-3">
          <img src="/logo_bioinfoguru.svg" alt="Logo" class="h-12 w-12" />
        </NuxtLink>
        <h1 class="text-2xl font-semibold">
          Sign in to
          <span class="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100" style="font-family: 'Laila', ui-sans-serif, system-ui, sans-serif">शब्द</span>
          (shbd)
        </h1>
        <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Sync your documents across devices, share read-only links, and export PDFs.
        </p>
      </div>

      <div v-if="authError" role="alert" class="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
        {{ authError }}
      </div>

      <div class="space-y-3">
        <button
          type="button"
          class="flex w-full items-center justify-center gap-3 rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          :disabled="pendingProvider !== null"
          @click="signInWith('google')"
        >
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {{ pendingProvider === 'google' ? 'Redirecting…' : 'Continue with Google' }}
        </button>

        <button
          type="button"
          class="flex w-full items-center justify-center gap-3 rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          :disabled="pendingProvider !== null"
          @click="signInWith('github')"
        >
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          {{ pendingProvider === 'github' ? 'Redirecting…' : 'Continue with GitHub' }}
        </button>
      </div>

      <div class="mt-6 text-center">
        <NuxtLink to="/" class="text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400">
          Continue without an account
        </NuxtLink>
        <p class="mt-3 text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
          By continuing you agree to the
          <a href="/privacy.html" class="underline underline-offset-2">Privacy Policy</a> and
          <a href="/terms.html" class="underline underline-offset-2">Terms of Service</a>.
        </p>
      </div>
    </div>
  </div>
</template>
