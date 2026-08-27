<script setup lang="ts">
import { computed, ref } from 'vue'

useSeoMeta({
  title: 'Pricing & Plans',
  description: 'Flexible plans for creators, developers, and writers. Choose between Free, Starter, and Pro tiers.',
  ogTitle: 'shbd Pricing & Plans',
  ogDescription: 'Flexible plans for creators, developers, and writers. Choose between Free, Starter, and Pro tiers.',
  twitterTitle: 'shbd Pricing & Plans',
  twitterDescription: 'Flexible plans for creators, developers, and writers. Choose between Free, Starter, and Pro tiers.'
})

const billingCycle = ref<'monthly' | 'annually'>('monthly')

const starterPrice = computed(() => (billingCycle.value === 'annually' ? 2990 : 299))
const proPrice = computed(() => (billingCycle.value === 'annually' ? 6990 : 699))
const cycleLabel = computed(() => (billingCycle.value === 'annually' ? '/ year' : '/ month'))
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-4 py-8">
    <div class="mb-8 flex items-center justify-between">
      <NuxtLink
        to="/"
        class="inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        ← Back to Editor
      </NuxtLink>
      <NuxtLink
        to="/guide"
        class="text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        User Guide
      </NuxtLink>
    </div>

    <div class="mb-8 text-center">
      <h1 class="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-100">
        Simple, Transparent Pricing
      </h1>
      <p class="mt-3 text-base text-neutral-600 dark:text-neutral-400">
        Choose the plan that fits your writing and publishing workflow.
      </p>

      <!-- Monthly / Annually billing options -->
      <div class="mt-6 flex justify-center">
        <div
          class="inline-flex rounded-md border border-neutral-300 bg-neutral-50 p-0.5 dark:border-neutral-700 dark:bg-neutral-950"
          role="radiogroup"
          aria-label="Billing cycle"
        >
        <button
          type="button"
          role="radio"
          :aria-pressed="billingCycle === 'monthly'"
          :aria-checked="billingCycle === 'monthly'"
          class="rounded px-3 py-1 text-sm font-medium transition-colors"
          :class="billingCycle === 'monthly'
            ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
            : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'"
          @click="billingCycle = 'monthly'"
        >
          Monthly
        </button>
        <button
          type="button"
          role="radio"
          :aria-pressed="billingCycle === 'annually'"
          :aria-checked="billingCycle === 'annually'"
          class="flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium transition-colors"
          :class="billingCycle === 'annually'
            ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
            : 'text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800'"
          @click="billingCycle = 'annually'"
        >
          Annually
        </button>
        </div>
      </div>
    </div>

    <!-- Pricing Grid -->
    <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
      <!-- Free Plan -->
      <div class="flex flex-col justify-between rounded-xl border border-neutral-300 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Free</h2>
            <span class="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">Basic</span>
          </div>
          <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Perfect for quick notes and lightweight documents.</p>
          <div class="mt-6 flex items-baseline">
            <span class="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">₹0</span>
            <span class="ml-1 text-sm text-neutral-500 dark:text-neutral-400">/ forever</span>
          </div>

          <ul class="mt-6 space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Up to 3 saved documents
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> 2 MB total storage
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Full Markdown & Emoji support
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Live HTML & Mermaid diagrams
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> PDF export & local file downloads
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Custom share link slugs (`/p/custom-name`)
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Server-side Typst PDF compilation
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> AI inline autocomplete enabled
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Public document sharing links
            </li>
          </ul>
        </div>

        <div class="mt-8">
          <NuxtLink
            to="/signin"
            class="block w-full rounded-lg border border-neutral-300 bg-white py-2.5 text-center text-sm font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Get Started
          </NuxtLink>
        </div>
      </div>

      <!-- Starter Plan -->
      <div class="relative flex flex-col justify-between rounded-xl border-2 border-neutral-900 bg-white p-6 shadow-md dark:border-neutral-100 dark:bg-neutral-900">
        <div class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-3 py-0.5 text-[11px] font-semibold tracking-wide uppercase text-white dark:bg-neutral-100 dark:text-neutral-900">
          Popular
        </div>

        <div>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Starter</h2>
            <div class="flex items-center gap-2">
              <span
                v-if="billingCycle === 'annually'"
                class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >
                2 Months Free
              </span>
              <span class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">Growth</span>
            </div>
          </div>
          <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Great for active writers, students, and research teams.</p>
          <div class="mt-6 flex items-baseline">
            <span class="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">₹{{ starterPrice.toLocaleString('en-IN') }}</span>
            <span class="ml-1 text-sm text-neutral-500 dark:text-neutral-400">{{ cycleLabel }}</span>
          </div>

          <ul class="mt-6 space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
            <li class="font-medium text-neutral-900 dark:text-neutral-100">
              Everything in Free, plus:
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Up to 15 saved documents
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> 10 MB total storage
            </li>
          </ul>
        </div>

        <div class="mt-8">
          <NuxtLink
            to="/signin"
            class="block w-full rounded-lg bg-neutral-900 py-2.5 text-center text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Upgrade to Starter
          </NuxtLink>
        </div>
      </div>

      <!-- Pro Plan -->
      <div class="flex flex-col justify-between rounded-xl border border-neutral-300 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Pro</h2>
            <div class="flex items-center gap-2">
              <span
                v-if="billingCycle === 'annually'"
                class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >
                2 Months Free
              </span>
              <span class="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">Unlimited</span>
            </div>
          </div>
          <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Designed for power users, authors, and professionals.</p>
          <div class="mt-6 flex items-baseline">
            <span class="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">₹{{ proPrice.toLocaleString('en-IN') }}</span>
            <span class="ml-1 text-sm text-neutral-500 dark:text-neutral-400">{{ cycleLabel }}</span>
          </div>

          <ul class="mt-6 space-y-3 text-sm text-neutral-600 dark:text-neutral-300">
            <li class="font-medium text-neutral-900 dark:text-neutral-100">
              Everything in Starter, plus:
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> <strong>Unlimited</strong> saved documents
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> 50 MB total storage
            </li>
            <li class="flex items-center gap-2">
              <span class="text-emerald-600 dark:text-emerald-400">✓</span> Priority support & feature updates
            </li>
          </ul>
        </div>

        <div class="mt-8">
          <NuxtLink
            to="/signin"
            class="block w-full rounded-lg border border-neutral-300 bg-white py-2.5 text-center text-sm font-medium text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Upgrade to Pro
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
