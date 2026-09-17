// Thin client for the garden's notes, shaped like auth.js: the server owns the
// store, this only moves JSON and keeps the client's copy of the rules that
// the forms need in order to complain before a round trip. The server checks
// all of them again.

import { authHeaders } from './auth'

export const MAX_NOTE_LENGTH = 280

// Kept in step with NOTE_TTL_MS on the server, so a note's age can be drawn as
// how far through its life it is rather than as a bare timestamp.
const NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

async function readPayload(response) {
  let payload = {}

  try {
    payload = await response.json()
  } catch {
    // A proxy error page or an empty body; the status check below is what matters.
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return payload
}

export async function fetchNotes() {
  const response = await fetch('/api/garden/notes')
  const { notes } = await readPayload(response)
  return notes || []
}

export async function postNote(text) {
  const response = await fetch('/api/garden/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text }),
  })

  const { notes } = await readPayload(response)
  return notes || []
}

// How far through its week a note is, as the log needs it: a short age, and a
// stage that decides how faded it looks and which leaf it carries.
export function describeNote(createdAt, now = Date.now()) {
  const written = Date.parse(createdAt)

  if (!Number.isFinite(written)) {
    return { age: '', stage: 'fresh', life: 1 }
  }

  const elapsed = Math.max(0, now - written)
  const life = Math.max(0, 1 - elapsed / NOTE_TTL_MS)

  let age

  if (elapsed < MINUTE_MS) {
    age = 'just now'
  } else if (elapsed < HOUR_MS) {
    age = `${Math.floor(elapsed / MINUTE_MS)}m`
  } else if (elapsed < DAY_MS) {
    age = `${Math.floor(elapsed / HOUR_MS)}h`
  } else {
    age = `${Math.floor(elapsed / DAY_MS)}d`
  }

  let stage = 'fresh'

  if (life < 0.15) {
    stage = 'wilting'
  } else if (life < 0.45) {
    stage = 'fading'
  } else if (life < 0.85) {
    stage = 'green'
  }

  return { age, stage, life }
}

export const STAGE_MARKS = {
  fresh: '🌱',
  green: '🌿',
  fading: '🍃',
  wilting: '🍂',
}
