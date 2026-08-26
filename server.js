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

app.use(cors())
app.use(express.json())

function createEmptyStats() {
  return { players: {} }
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
    return stats.players && typeof stats.players === 'object' ? stats : createEmptyStats()
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

function toLeagueTable(stats) {
  return Object.entries(stats.players)
    .map(([name, presses]) => ({ name, presses }))
    .sort((left, right) => right.presses - left.presses || left.name.localeCompare(right.name))
}

app.get('/api/stats', (_request, response) => {
  response.json({ players: toLeagueTable(readStats()) })
})

app.post('/api/stats/press', (request, response) => {
  const name = normalizeName(request.body?.name)
  const stats = readStats()

  stats.players[name] = (stats.players[name] || 0) + 1
  writeStats(stats)

  response.status(201).json({ players: toLeagueTable(stats) })
})

app.post('/api/stats/clear', (_request, response) => {
  writeStats(createEmptyStats())
  response.json({ players: [] })
})

app.listen(port, () => {
  console.log(`Stats server listening on http://localhost:${port}`)
})
