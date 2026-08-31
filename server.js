import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const statsPath = path.join(dataDir, 'stats.json')

// Matches the mode fs.writeFileSync produced before, so switching to an
// explicit open() does not silently change stats.json's permissions.
const STATS_FILE_MODE = 0o644

// Distinguishes concurrent temp files within one process; the pid separates
// processes.
let writeSequence = 0

const TEMP_PREFIX = '.stats.'
const TEMP_SUFFIX = '.tmp'

// Only sweep temp files old enough that no live write could still own one. A
// real write completes in milliseconds, so anything this stale is an orphan --
// the guard keeps a starting instance from deleting a sibling's in-flight file
// when several share the data volume.
const TEMP_FILE_TTL_MS = 5 * 60 * 1000

const app = express()
const port = process.env.PORT || 3001
const adminToken = process.env.ADMIN_TOKEN

app.use(cors())
app.use(express.json())

function requireAdminToken(request, response, next) {
  if (!adminToken) {
    return response.status(503).json({ error: 'admin action disabled: ADMIN_TOKEN is not configured' })
  }

  if (request.get('x-admin-token') !== adminToken) {
    return response.status(403).json({ error: 'forbidden' })
  }

  next()
}

function createEmptyStats() {
  return { players: Object.create(null) }
}

function toSafePlayers(players) {
  const safePlayers = Object.create(null)

  for (const [name, presses] of Object.entries(players || {})) {
    safePlayers[name] = presses
  }

  return safePlayers
}

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function ensureStatsFile() {
  ensureDataDir()

  if (!fs.existsSync(statsPath)) {
    writeStats(createEmptyStats())
  }
}

function readStats() {
  ensureStatsFile()

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'))
    return stats.players && typeof stats.players === 'object'
      ? { players: toSafePlayers(stats.players) }
      : createEmptyStats()
  } catch {
    return createEmptyStats()
  }
}

// Atomic write. A concurrent reader sees either the previous file or the new
// one in full, never a half-written one, and a crash mid-write cannot leave a
// truncated stats.json behind. The temp file is created inside dataDir so the
// rename stays on a single filesystem, which is where POSIX guarantees it is
// atomic -- a temp file in /tmp could land on another device and make the
// rename a non-atomic copy.
function writeStats(stats) {
  ensureDataDir()

  const tempPath = path.join(dataDir, `${TEMP_PREFIX}${process.pid}.${++writeSequence}${TEMP_SUFFIX}`)
  let handle

  try {
    // 'wx' fails rather than clobbering, so two writers can never share a temp
    // file even if the name somehow repeats.
    handle = fs.openSync(tempPath, 'wx', STATS_FILE_MODE)
    fs.writeFileSync(handle, JSON.stringify(stats, null, 2))
    // Flush before the rename: without this the new name can become visible
    // while its contents are still only in the page cache.
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = undefined
    fs.renameSync(tempPath, statsPath)
  } catch (error) {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle)
      } catch {
        // Already closed or never opened; the throw below is what matters.
      }
    }

    try {
      fs.unlinkSync(tempPath)
    } catch {
      // Nothing to clean up if the open itself failed.
    }

    throw error
  }
}

// A process killed between the write and the rename leaves its temp file
// behind. stats.json is unharmed -- that is what the rename buys -- but the
// orphans would pile up in the data volume, so clear the stale ones at startup.
function sweepStaleTempFiles() {
  let entries

  try {
    entries = fs.readdirSync(dataDir)
  } catch {
    return // dataDir does not exist yet; ensureStatsFile will create it.
  }

  const cutoff = Date.now() - TEMP_FILE_TTL_MS

  for (const entry of entries) {
    if (!entry.startsWith(TEMP_PREFIX) || !entry.endsWith(TEMP_SUFFIX)) {
      continue
    }

    const tempPath = path.join(dataDir, entry)

    try {
      if (fs.statSync(tempPath).mtimeMs < cutoff) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // Raced with another instance's sweep, or already gone. Either is fine.
    }
  }
}

function normalizeName(name) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  return trimmedName || 'Anonymous'
}

// Badges are derived from the press count rather than stored, so they stay
// correct no matter how stats.json was last written — and "Pristine" is lost
// the instant the count leaves zero, with no separate revocation step.
const BADGES = [
  {
    id: 'pristine',
    label: 'Pristine',
    icon: '🕊️',
    description: 'Never pressed the button. Lost forever on the first press.',
    earned: (presses) => presses === 0,
  },
  {
    id: 'spoon',
    label: 'Spoon',
    icon: '🥄',
    description: 'Pressed the button five times. You were warned.',
    earned: (presses) => presses >= 5,
  },
]

function toBadges(presses) {
  return BADGES.filter((badge) => badge.earned(presses)).map(({ id, label, icon, description }) => ({
    id,
    label,
    icon,
    description,
  }))
}

function toLeagueTable(stats) {
  return Object.entries(stats.players)
    .map(([name, presses]) => ({ name, presses, badges: toBadges(presses) }))
    .sort((left, right) => right.presses - left.presses || left.name.localeCompare(right.name))
}

app.get('/api/stats', (_request, response) => {
  response.json({ players: toLeagueTable(readStats()) })
})

// Claims a name at zero presses so the Pristine badge can be held and seen
// before it is lost. Never resets an existing player's count.
app.post('/api/stats/register', (request, response) => {
  const name = normalizeName(request.body?.name)
  const stats = readStats()

  if (!(name in stats.players)) {
    stats.players[name] = 0
    writeStats(stats)
  }

  response.status(201).json({ players: toLeagueTable(stats) })
})

app.post('/api/stats/press', (request, response) => {
  const name = normalizeName(request.body?.name)
  const stats = readStats()

  stats.players[name] = (stats.players[name] || 0) + 1
  writeStats(stats)

  response.status(201).json({ players: toLeagueTable(stats) })
})

app.post('/api/stats/clear', requireAdminToken, (_request, response) => {
  writeStats(createEmptyStats())
  response.json({ players: [] })
})

sweepStaleTempFiles()

app.listen(port, () => {
  console.log(`Stats server listening on http://localhost:${port}`)
})
