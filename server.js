import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const statsPath = path.join(dataDir, 'stats.json')

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

function ensureStatsFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  if (!fs.existsSync(statsPath)) {
    fs.writeFileSync(statsPath, JSON.stringify(createEmptyStats(), null, 2))
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

function writeStats(stats) {
  ensureStatsFile()
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2))
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

app.listen(port, () => {
  console.log(`Stats server listening on http://localhost:${port}`)
})
