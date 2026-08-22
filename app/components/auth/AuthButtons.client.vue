<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '~/lib/auth-client'

const sessionState = authClient.useSession()
const authError = ref('')

async function signInWith(provider: 'github' | 'google') {
  authError.value = ''
  try {
    console.log('[signInWith] Initiating social sign-in for:', provider)
    const result = await authClient.signIn.social({
      provider,
      callbackURL: '/',
      // Handle the redirect below so errors and malformed responses are
      // surfaced instead of being swallowed by the client's auto-redirect.
      disableRedirect: true
    })
    console.log('[signInWith] Result returned:', result)

    if (result?.error) {
      console.error('[signInWith] Full error:', JSON.stringify(result.error))
      authError.value = result.error.message || (result.error as any)?.statusText || `Sign in with ${provider} failed (${result.error.status})`
      return
    }

    const redirectUrl = (result as any)?.data?.url || (result as any)?.url || (result as any)?.data?.redirectUrl
    if (redirectUrl) {
      console.log('[signInWith] Manual redirecting to:', redirectUrl)
      window.location.assign(redirectUrl)
    } else {
      console.error('[signInWith] OAuth response did not contain a redirect URL:', result)
      authError.value = `Sign in with ${provider} did not return a redirect URL`
    }
  } catch (err: any) {
    console.error('[signInWith] Caught error:', err)
    const detail = err?.data?.message || err?.data?.error || err?.data?.detail || err?.message || String(err)
    authError.value = detail ? `Failed: ${detail}` : `Failed to initiate ${provider} sign in`
  }
}

function signOut() {
  authClient.signOut()
}
</script>

<template>
  <div class="flex items-center gap-2">
    <template v-if="!sessionState.data?.user">
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        @click="signInWith('github')"
      >
        GitHub
      </button>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        @click="signInWith('google')"
      >
        Google
      </button>
    </template>

    <template v-else>
      <span class="text-sm text-neutral-600 dark:text-neutral-300">
        {{ sessionState.data.user.name || sessionState.data.user.email }}
      </span>
      <button
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
        @click="signOut"
      >
        Sign out
      </button>
    </template>

    <span v-if="authError" class="text-xs text-red-600 dark:text-red-400">
      {{ authError }}
    </span>
  </div>
</template>
