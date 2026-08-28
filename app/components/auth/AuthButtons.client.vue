<script setup lang="ts">
import { computed } from 'vue'
import { authClient } from '~/lib/auth-client'

// Signed-out users get a single "Sign in" CTA that routes to /signin where
// both OAuth providers live. Signed-in users see their identity + sign out.
// The CTA is hidden while already on /signin (redundant there).
const sessionState = authClient.useSession()
const route = useRoute()
const onSignInPage = computed(() => route.path === '/signin')
const planLabel = computed(() => {
  const tier = String((sessionState.value?.data?.user as any)?.tier || 'free').toLowerCase()
  return `${tier === 'starter' ? 'Starter' : tier === 'pro' ? 'Pro' : 'Free'} plan`
})

function signOut() {
  authClient.signOut()
}
</script>

<template>
  <div class="flex items-center gap-2">
    <template v-if="!sessionState.data?.user">
      <NuxtLink
        v-if="!onSignInPage"
        to="/signin"
        class="rounded-md bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Sign in
      </NuxtLink>
    </template>

    <template v-else>
      <span
        class="text-sm text-neutral-600 outline-none underline-offset-2 hover:underline focus-visible:underline dark:text-neutral-300"
        tabindex="0"
        :title="planLabel"
        :aria-label="`${sessionState.data.user.name || sessionState.data.user.email}, ${planLabel}`"
      >
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
  </div>
</template>
