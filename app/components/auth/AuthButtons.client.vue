<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '~/lib/auth-client'

const sessionState = authClient.useSession()
const authError = ref('')

async function signInWith(provider: 'github' | 'google') {
  authError.value = ''
  try {
    console.log('[signInWith] Requesting social sign-in for:', provider)
    const result = await authClient.signIn.social({ provider, callbackURL: '/' })
    console.log('[signInWith] Response result:', result)

    if (result?.error) {
      authError.value = result.error.message || `Sign in with ${provider} failed`
      return
    }

    const redirectUrl = (result as any)?.data?.url || (result as any)?.url || (result as any)?.data?.redirectUrl
    if (redirectUrl) {
      console.log('[signInWith] Redirecting browser to:', redirectUrl)
      window.location.href = redirectUrl
    } else {
      console.warn('[signInWith] No redirect URL found in response:', result)
    }
  } catch (err: any) {
    console.error('[signInWith] Exception:', err)
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
