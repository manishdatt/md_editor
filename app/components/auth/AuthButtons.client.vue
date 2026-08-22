<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

const { data: session } = authClient.useSession()

function signInWith(provider: 'github' | 'google') {
  authClient.signIn.social({ provider, callbackURL: '/' })
}

function signOut() {
  authClient.signOut()
}
</script>

<template>
  <template v-if="!session">
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
      {{ session.user.name || session.user.email }}
    </span>
    <button
      type="button"
      class="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
      @click="signOut"
    >
      Sign out
    </button>
  </template>
</template>
