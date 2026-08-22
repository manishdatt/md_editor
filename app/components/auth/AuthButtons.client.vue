<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '~/lib/auth-client'

const sessionState = authClient.useSession()
const authError = ref('')

async function signInWith(provider: 'github' | 'google') {
  authError.value = ''
  try {
    const result = await authClient.signIn.social({ provider, callbackURL: '/' })
    if (result?.error) {
      authError.value = result.error.message || `Sign in with ${provider} failed`
      return
    }
    if (result?.data?.url) {
      window.location.href = result.data.url
    }
  } catch (err: any) {
    const detail = err?.data?.message || err?.data?.error || err?.message || ''
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
