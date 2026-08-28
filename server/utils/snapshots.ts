export type DocumentFormat = 'markdown' | 'typst'

export type Snapshot = {
  title: string
  content: string
  format: DocumentFormat
  savedAt: number
}

export type Checkpoint = Snapshot & {
  id: string
  label: string
  clientRequestId?: string
}

export const MAX_CHECKPOINTS = 5
export const MAX_LABEL_CHARS = 80
export const MAX_LABEL_BYTES = 320

export function byteLength(value: unknown): number {
  return new TextEncoder().encode(String(value ?? '')).byteLength
}

export function validateLabel(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error('Label must be a string')
  if (value.length > MAX_LABEL_CHARS || byteLength(value) > MAX_LABEL_BYTES) {
    throw new Error('Label is too long')
  }
  return value
}

export function validateSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return typeof snapshot.title === 'string'
    && typeof snapshot.content === 'string'
    && (snapshot.format === 'markdown' || snapshot.format === 'typst')
    && typeof snapshot.savedAt === 'number'
    && Number.isFinite(snapshot.savedAt)
}

export function validateCheckpoint(value: unknown): value is Checkpoint {
  if (!validateSnapshot(value)) return false
  const checkpoint = value as Checkpoint
  return typeof checkpoint.id === 'string'
    && typeof checkpoint.label === 'string'
    && (checkpoint.clientRequestId === undefined || typeof checkpoint.clientRequestId === 'string')
}

export function parseSnapshot(raw: unknown, mode: 'read' | 'write' = 'read'): Snapshot | null {
  if (raw === null || raw === undefined || raw === '') return null
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!validateSnapshot(value)) throw new Error('Invalid snapshot')
    return value
  } catch (error) {
    if (mode === 'write') throw error
    return null
  }
}

export function parseCheckpoints(raw: unknown, mode: 'read' | 'write' = 'read'): Checkpoint[] {
  if (raw === null || raw === undefined || raw === '') return []
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(value) || !value.every(validateCheckpoint)) throw new Error('Invalid checkpoints')
    return value
  } catch (error) {
    if (mode === 'write') throw error
    return []
  }
}

export function checkpointMetadata(checkpoints: Checkpoint[]) {
  return checkpoints.map(({ id, label, title, format, savedAt, content }) => ({
    id, label, title, format, savedAt, size: byteLength(content)
  }))
}

export function nextRevision(current: number): number {
  return current + 1
}

export function pushCheckpoint(list: Checkpoint[], entry: Checkpoint): Checkpoint[] {
  return [...list, entry].slice(-MAX_CHECKPOINTS)
}
