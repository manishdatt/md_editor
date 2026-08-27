<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { authClient } from '~/lib/auth-client'

type Tier = 'free' | 'starter' | 'pro'

type AdminStats = {
  users: { total: number, paid: number, disabled: number }
  documents: { total: number, storageBytes: number, shared: number, typst: number }
}

type AdminUserRow = {
  id: string
  name: string
  email: string
  tier: Tier
  emailVerified: boolean
  disabledAt: number | null
  createdAt: number
  documentCount: number
  storageBytes: number
  lastActivity: number
}

type AdminDocRow = {
  id: string
  title: string
  format: 'markdown' | 'typst' | string
  isShared: boolean
  updatedAt: number
  bytes: number
  ownerName: string
  ownerEmail: string
}

const sessionState = authClient.useSession()
const isSignedIn = computed(() => Boolean(sessionState.value?.data?.user))
const isLoaded = computed(() => !sessionState.value?.isPending)
const myEmail = computed(() => String(sessionState.value?.data?.user?.email || '').toLowerCase())

const phase = ref<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
const errorMessage = ref('')
const stats = ref<AdminStats | null>(null)
const users = ref<AdminUserRow[]>([])
const recentDocs = ref<AdminDocRow[]>([])

const savingTierFor = ref<string | null>(null)
const expandedUserId = ref<string | null>(null)
const expandedDocs = ref<AdminDocRow[]>([])
const expandedLoading = ref(false)
const deletingDocId = ref<string | null>(null)

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

function formatDate(epochMs: number): string {
  if (!epochMs) {
    return '—'
  }
  return new Date(epochMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function errMessage(err: unknown): string {
  const e = err as any
  return String(e?.data?.statusMessage || e?.statusMessage || e?.message || 'Request failed')
}

async function fetchAll() {
  phase.value = 'loading'
  errorMessage.value = ''
  try {
    const [statsRes, usersRes] = await Promise.all([
      $fetch<AdminStats>('/api/admin/stats'),
      $fetch<{ users: AdminUserRow[] }>('/api/admin/users')
    ])
    stats.value = statsRes
    users.value = usersRes.users
    phase.value = 'ready'
  } catch (err: any) {
    if (err?.statusCode === 403 || err?.statusMessage === 'Forbidden') {
      phase.value = 'forbidden'
    } else {
      errorMessage.value = errMessage(err)
      phase.value = 'error'
    }
  }
}

async function onTierChange(row: AdminUserRow, event: Event) {
  const nextTier = (event.target as HTMLSelectElement).value as Tier
  if (nextTier === row.tier) {
    return
  }
  const previous = row.tier
  row.tier = nextTier
  savingTierFor.value = row.id
  try {
    await $fetch(`/api/admin/users/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: { tier: nextTier }
    })
    if (stats.value) {
      const wasPaid = previous !== 'free'
      const isPaid = nextTier !== 'free'
      if (wasPaid !== isPaid) {
        const delta = isPaid ? 1 : -1
        stats.value.users.paid = Math.max(0, stats.value.users.paid + delta)
      }
    }
  } catch (err) {
    row.tier = previous
    errorMessage.value = `Failed to update tier: ${errMessage(err)}`
    window.setTimeout(() => { errorMessage.value = '' }, 4000)
  } finally {
    savingTierFor.value = null
  }
}

async function openUserDocs(row: AdminUserRow) {
  if (expandedUserId.value === row.id) {
    expandedUserId.value = null
    expandedDocs.value = []
    return
  }
  expandedUserId.value = row.id
  expandedLoading.value = true
  expandedDocs.value = []
  try {
    const res = await $fetch<{ documents: AdminDocRow[] }>(`/api/admin/documents?userId=${encodeURIComponent(row.id)}&limit=50`)
    expandedDocs.value = res.documents
  } catch (err) {
    errorMessage.value = `Failed to load documents: ${errMessage(err)}`
    window.setTimeout(() => { errorMessage.value = '' }, 4000)
  } finally {
    expandedLoading.value = false
  }
}

async function toggleDisabled(row: AdminUserRow) {
  const next = !row.disabledAt
  const verb = next ? 'Disable' : 'Re-enable'
  const effect = next
    ? 'Their editor APIs will stop working and their public share links will return 404.'
    : 'They will regain full access.'
  if (!window.confirm(`${verb} ${row.email}? ${effect}`)) {
    return
  }
  savingTierFor.value = row.id
  try {
    await $fetch(`/api/admin/users/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      body: { disabled: next }
    })
    row.disabledAt = next ? Date.now() : null
    if (stats.value) {
      stats.value.users.disabled = Math.max(0, stats.value.users.disabled + (next ? 1 : -1))
    }
  } catch (err) {
    errorMessage.value = `Failed: ${errMessage(err)}`
    window.setTimeout(() => { errorMessage.value = '' }, 4000)
  } finally {
    savingTierFor.value = null
  }
}

async function fetchRecentDocs() {
  try {
    const res = await $fetch<{ documents: AdminDocRow[] }>('/api/admin/documents?limit=50')
    recentDocs.value = res.documents
  } catch (err) {
    errorMessage.value = `Failed to load documents: ${errMessage(err)}`
    window.setTimeout(() => { errorMessage.value = '' }, 4000)
  }
}

async function deleteDoc(doc: AdminDocRow) {
  if (!window.confirm(`Delete "${doc.title}" by ${doc.ownerEmail}? This cannot be undone.`)) {
    return
  }
  deletingDocId.value = doc.id
  try {
    await $fetch(`/api/admin/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
    recentDocs.value = recentDocs.value.filter((d) => d.id !== doc.id)
    if (expandedUserId.value) {
      expandedDocs.value = expandedDocs.value.filter((d) => d.id !== doc.id)
    }
    const owner = users.value.find((u) => u.id === (doc as any).ownerId)
    if (stats.value) {
      stats.value.documents.total = Math.max(0, stats.value.documents.total - 1)
    }
    void fetchAll()
  } catch (err) {
    errorMessage.value = `Failed to delete: ${errMessage(err)}`
    window.setTimeout(() => { errorMessage.value = '' }, 4000)
  } finally {
    deletingDocId.value = null
  }
}

watch(isSignedIn, (signedIn) => {
  if (signedIn && phase.value === 'loading') {
    void fetchAll()
    void fetchRecentDocs()
  }
}, { immediate: true })

onMounted(() => {
  if (isSignedIn.value && phase.value === 'loading') {
    void fetchAll()
    void fetchRecentDocs()
  }
})
</script>

<template>
  <div class="mx-auto w-full max-w-7xl px-4 py-8">
    <!-- Loading / guard states -->
    <div v-if="!isLoaded || phase === 'loading'" class="animate-pulse space-y-4">
      <div class="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-800" />
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div v-for="n in 4" :key="n" class="h-24 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <div class="h-64 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    </div>

    <div v-else-if="!isSignedIn" class="rounded-lg border border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <h1 class="mb-2 text-xl font-semibold">Admin</h1>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">Sign in to continue.</p>
    </div>

    <div v-else-if="phase === 'forbidden'" class="rounded-lg border border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <h1 class="mb-2 text-xl font-semibold">Access denied</h1>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        This account is not on the admin allowlist.
      </p>
    </div>

    <div v-else-if="phase === 'error'" class="rounded-lg border border-red-300 bg-white p-8 text-center dark:border-red-800 dark:bg-neutral-900">
      <h1 class="mb-2 text-xl font-semibold">Something went wrong</h1>
      <p class="text-sm text-red-600 dark:text-red-400">{{ errorMessage }}</p>
    </div>

    <!-- Panel -->
    <template v-else>
      <div class="mb-6 flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold">Admin</h1>
        <button
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="fetchAll(); fetchRecentDocs()"
        >
          Refresh
        </button>
      </div>

      <p
        v-if="errorMessage"
        class="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        {{ errorMessage }}
      </p>

      <!-- Stats -->
      <div v-if="stats" class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div class="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Users</div>
          <div class="mt-1 text-2xl font-semibold">{{ stats.users.total }}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">{{ stats.users.paid }} paid · {{ stats.users.disabled }} disabled</div>
        </div>
        <div class="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Documents</div>
          <div class="mt-1 text-2xl font-semibold">{{ stats.documents.total }}</div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">{{ stats.documents.typst }} typst · {{ stats.documents.shared }} shared</div>
        </div>
        <div class="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Storage used</div>
          <div class="mt-1 text-2xl font-semibold">{{ formatBytes(stats.documents.storageBytes) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Shared links</div>
          <div class="mt-1 text-2xl font-semibold">{{ stats.documents.shared }}</div>
        </div>
        <div class="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Avg docs / user</div>
          <div class="mt-1 text-2xl font-semibold">
            {{ stats.users.total ? (stats.documents.total / stats.users.total).toFixed(1) : '0' }}
          </div>
        </div>
      </div>

      <!-- Users -->
      <section class="mb-10">
        <h2 class="mb-3 text-lg font-semibold">Users</h2>
        <div class="overflow-x-auto rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <tr>
                <th class="px-4 py-2.5 font-medium">User</th>
                <th class="px-4 py-2.5 font-medium">Status</th>
                <th class="px-4 py-2.5 font-medium">Tier</th>
                <th class="px-4 py-2.5 font-medium">Docs</th>
                <th class="px-4 py-2.5 font-medium">Storage</th>
                <th class="px-4 py-2.5 font-medium">Joined</th>
                <th class="px-4 py-2.5 font-medium">Last activity</th>
                <th class="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in users" :key="row.id">
                <tr class="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800">
                  <td class="px-4 py-2.5">
                    <div class="font-medium" :class="row.disabledAt ? 'text-neutral-400 line-through dark:text-neutral-500' : ''">{{ row.name }}</div>
                    <div class="text-xs text-neutral-500 dark:text-neutral-400">{{ row.email }}</div>
                  </td>
                  <td class="px-4 py-2.5">
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                      :class="row.disabledAt
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'"
                    >
                      {{ row.disabledAt ? 'Disabled' : 'Active' }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5">
                    <select
                      class="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950"
                      :value="row.tier"
                      :disabled="savingTierFor === row.id"
                      @change="onTierChange(row, $event)"
                    >
                      <option value="free">free</option>
                      <option value="starter">starter</option>
                      <option value="pro">pro</option>
                    </select>
                  </td>
                  <td class="px-4 py-2.5 tabular-nums">{{ row.documentCount }}</td>
                  <td class="px-4 py-2.5 tabular-nums">{{ formatBytes(row.storageBytes) }}</td>
                  <td class="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{{ formatDate(row.createdAt) }}</td>
                  <td class="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{{ formatDate(row.lastActivity) }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                      <button
                        class="rounded-md border px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        :class="row.disabledAt ? 'border-neutral-300 dark:border-neutral-700' : 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40'"
                        :disabled="savingTierFor === row.id || row.email === myEmail"
                        :title="row.email === myEmail ? 'You cannot disable your own account' : ''"
                        @click="toggleDisabled(row)"
                      >
                        {{ row.disabledAt ? 'Enable' : 'Disable' }}
                      </button>
                      <button
                        class="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        @click="openUserDocs(row)"
                      >
                        {{ expandedUserId === row.id ? 'Hide docs' : 'Docs' }}
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedUserId === row.id">
                  <td colspan="8" class="bg-neutral-50 px-4 py-3 dark:bg-neutral-950">
                    <div v-if="expandedLoading" class="py-2 text-xs text-neutral-500">Loading…</div>
                    <div v-else-if="expandedDocs.length === 0" class="py-2 text-xs text-neutral-500">No documents.</div>
                    <ul v-else class="space-y-1.5">
                      <li v-for="doc in expandedDocs" :key="doc.id" class="flex items-center justify-between gap-3 text-xs">
                        <span class="truncate">
                          {{ doc.title }}
                          <span class="ml-1 rounded bg-neutral-200 px-1 text-[10px] uppercase dark:bg-neutral-800">{{ doc.format }}</span>
                          <span v-if="doc.isShared" class="ml-1 rounded bg-emerald-100 px-1 text-[10px] uppercase text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">shared</span>
                        </span>
                        <span class="shrink-0 text-neutral-500 dark:text-neutral-400">{{ formatBytes(doc.bytes) }} · {{ formatDate(doc.updatedAt) }}</span>
                      </li>
                    </ul>
                  </td>
                </tr>
              </template>
              <tr v-if="users.length === 0">
                <td colspan="8" class="px-4 py-6 text-center text-sm text-neutral-500">No users yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Recent documents -->
      <section>
        <h2 class="mb-3 text-lg font-semibold">Recent documents</h2>
        <div class="overflow-x-auto rounded-lg border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              <tr>
                <th class="px-4 py-2.5 font-medium">Title</th>
                <th class="px-4 py-2.5 font-medium">Owner</th>
                <th class="px-4 py-2.5 font-medium">Format</th>
                <th class="px-4 py-2.5 font-medium">Size</th>
                <th class="px-4 py-2.5 font-medium">Updated</th>
                <th class="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="doc in recentDocs" :key="doc.id" class="border-b border-neutral-100 last:border-b-0 dark:border-neutral-800">
                <td class="max-w-[280px] truncate px-4 py-2.5">
                  {{ doc.title }}
                  <span v-if="doc.isShared" class="ml-1 rounded bg-emerald-100 px-1 text-[10px] uppercase text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">shared</span>
                </td>
                <td class="px-4 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">{{ doc.ownerEmail }}</td>
                <td class="px-4 py-2.5 text-xs uppercase text-neutral-500 dark:text-neutral-400">{{ doc.format }}</td>
                <td class="px-4 py-2.5 tabular-nums">{{ formatBytes(doc.bytes) }}</td>
                <td class="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">{{ formatDate(doc.updatedAt) }}</td>
                <td class="px-4 py-2.5 text-right">
                  <button
                    class="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                    :disabled="deletingDocId === doc.id"
                    @click="deleteDoc(doc)"
                  >
                    {{ deletingDocId === doc.id ? '…' : 'Delete' }}
                  </button>
                </td>
              </tr>
              <tr v-if="recentDocs.length === 0">
                <td colspan="6" class="px-4 py-6 text-center text-sm text-neutral-500">No documents yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
