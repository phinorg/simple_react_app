import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')
const statsPath = path.join(dataDir, 'stats.json')
const usersPath = path.join(dataDir, 'users.json')
const notesPath = path.join(dataDir, 'notes.json')

// Matches the mode fs.writeFileSync produced before, so switching to an
// explicit open() does not silently change stats.json's permissions.
const STATS_FILE_MODE = 0o644

// users.json holds password hashes. Nothing but the server needs to read it.
const USERS_FILE_MODE = 0o600

// notes.json is as public as stats.json: everything in it is on display to
// anyone who has found the garden.
const NOTES_FILE_MODE = 0o644

// PBKDF2-HMAC-SHA512 at the iteration count OWASP recommends for it. Node has
// this built in, so account storage adds no dependency.
const PBKDF2_ITERATIONS = 210000
const PBKDF2_DIGEST = 'sha512'
const PBKDF2_KEY_BYTES = 64
const SALT_BYTES = 16
const SESSION_TOKEN_BYTES = 32

// A note wilts a week after it is written. That bounds the file without a
// cleanup job, keeps the garden feeling like somewhere people passed through
// recently, and means nothing left here outlives the week on its own.
const NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_NOTE_LENGTH = 280
// A ceiling under the TTL, so a flood cannot grow the file without bound even
// inside a single week. Oldest notes fall away first.
const MAX_NOTES = 200
const NOTE_COOLDOWN_MS = 5000
const NOTE_ID_BYTES = 8

const MIN_PASSWORD_LENGTH = 8
const MAX_USERNAME_LENGTH = 32
const RESERVED_USERNAMES = new Set(['anonymous'])

// Distinguishes concurrent temp files within one process; the pid separates
// processes.
let writeSequence = 0

const TEMP_PREFIX = '.tmp-'
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
// truncated file behind. The temp file is created inside dataDir so the rename
// stays on a single filesystem, which is where POSIX guarantees it is atomic --
// a temp file in /tmp could land on another device and make the rename a
// non-atomic copy.
function writeJsonAtomic(targetPath, value, mode) {
  ensureDataDir()

  const tempPath = path.join(dataDir, `${TEMP_PREFIX}${process.pid}.${++writeSequence}${TEMP_SUFFIX}`)
  let handle

  try {
    // 'wx' fails rather than clobbering, so two writers can never share a temp
    // file even if the name somehow repeats.
    handle = fs.openSync(tempPath, 'wx', mode)
    fs.writeFileSync(handle, JSON.stringify(value, null, 2))
    // Flush before the rename: without this the new name can become visible
    // while its contents are still only in the page cache.
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = undefined
    fs.renameSync(tempPath, targetPath)
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

function writeStats(stats) {
  writeJsonAtomic(statsPath, stats, STATS_FILE_MODE)
}

// A process killed between the write and the rename leaves its temp file
// behind. The target file is unharmed -- that is what the rename buys -- but
// the orphans would pile up in the data volume, so clear stale ones at startup.
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

// --- Accounts -------------------------------------------------------------
//
// The account store lives here rather than in the browser so the API can
// establish who is calling. Presses are attributed from the session token,
// never from the request body, which is what stops one player scoring as
// another.

// Same prototype defence as toSafePlayers: JSON.parse returns an object with
// Object.prototype attached, so a username of "__proto__" would otherwise land
// on a prototype-bearing map.
function toSafeAccounts(parsed) {
  const accounts = Object.create(null)

  for (const [name, record] of Object.entries(parsed || {})) {
    if (record && typeof record === 'object' && typeof record.hash === 'string') {
      accounts[name] = record
    }
  }

  return accounts
}

function readUsers() {
  try {
    return toSafeAccounts(JSON.parse(fs.readFileSync(usersPath, 'utf8')))
  } catch {
    // Absent on first run, or unreadable. Either way there are no accounts yet.
    return Object.create(null)
  }
}

function writeUsers(accounts) {
  writeJsonAtomic(usersPath, accounts, USERS_FILE_MODE)
}

function derivePasswordHash(password, salt) {
  return new Promise((resolve, reject) => {
    // Async so a login does not block the event loop for the whole derivation.
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, PBKDF2_DIGEST, (error, key) => {
      if (error) {
        reject(error)
        return
      }

      resolve(key.toString('hex'))
    })
  })
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')

  // timingSafeEqual throws on a length mismatch, so check that first.
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}

// Returns a complaint string, or '' when the pair is acceptable.
function validateCredentials(username, password) {
  if (typeof username !== 'string' || !username.trim()) {
    return 'A username is required.'
  }

  if (username.trim().length > MAX_USERNAME_LENGTH) {
    return `Usernames are at most ${MAX_USERNAME_LENGTH} characters.`
  }

  if (RESERVED_USERNAMES.has(username.trim().toLowerCase())) {
    return 'That username is reserved.'
  }

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  return ''
}

// Sessions are in-memory: a restart signs everyone out. Persisting them would
// mean another store to invalidate, and for this app a re-login is cheaper.
const sessions = new Map()

function createSession(username) {
  const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex')
  sessions.set(token, { username, createdAt: Date.now() })
  return token
}

function readBearerToken(request) {
  const header = request.get('authorization') || ''
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : ''
}

function sessionUsername(request) {
  return sessions.get(readBearerToken(request))?.username || ''
}

function requireSession(request, response, next) {
  const username = sessionUsername(request)

  if (!username) {
    return response.status(401).json({ error: 'sign in first' })
  }

  request.username = username
  next()
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

// --- The garden -----------------------------------------------------------
//
// Notes players leave for each other, behind a page nothing links to. The
// garden is not part of the league: no note touches a press count, and the
// league never mentions the garden.
//
// A note's author comes from the session, exactly as a press does, so nobody
// can sign a note with a name they do not hold. Unsigned visitors write as
// Anonymous.

function toSafeNotes(parsed, now) {
  if (!Array.isArray(parsed)) {
    return []
  }

  const notes = []

  for (const note of parsed) {
    if (!note || typeof note !== 'object') {
      continue
    }

    const { id, author, text, createdAt } = note
    const written = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN

    if (
      typeof id !== 'string' ||
      typeof author !== 'string' ||
      typeof text !== 'string' ||
      !Number.isFinite(written) ||
      now - written >= NOTE_TTL_MS
    ) {
      continue
    }

    notes.push({ id, author, text, createdAt })
  }

  return notes
}

// Wilted notes are dropped on the way out rather than swept on a timer, so a
// note is gone the moment it is a week old whether or not anyone has posted
// since. The file catches up the next time someone writes.
function readNotes(now = Date.now()) {
  try {
    return toSafeNotes(JSON.parse(fs.readFileSync(notesPath, 'utf8'))?.notes, now)
  } catch {
    // Absent until the first note, or unreadable. Either way the garden is empty.
    return []
  }
}

function writeNotes(notes) {
  writeJsonAtomic(notesPath, { notes }, NOTES_FILE_MODE)
}

// Control characters would let a note break the log's layout or hide its own
// text behind a carriage return. Newlines are the only one worth keeping.
function cleanNoteText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{C}\n]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Enough to stop a stuck key or a loop from filling the garden. Keyed by
// session token where there is one and by address otherwise, so signing out
// does not reset the clock but a shared address does share it.
const lastNoteAt = new Map()

function noteCooldownRemaining(key, now) {
  return Math.max(0, NOTE_COOLDOWN_MS - (now - (lastNoteAt.get(key) || 0)))
}

function rememberNoteAt(key, now) {
  for (const [seen, at] of lastNoteAt) {
    if (now - at >= NOTE_COOLDOWN_MS) {
      lastNoteAt.delete(seen)
    }
  }

  lastNoteAt.set(key, now)
}

app.get('/api/garden/notes', (_request, response) => {
  response.json({ notes: readNotes() })
})

// Read and write happen without an await between them, so within this process
// two posts cannot interleave and lose each other. Two server processes over
// one data volume could still race -- the same exposure presses already have,
// and not worth a lock file for a page nothing links to.
app.post('/api/garden/notes', (request, response) => {
  const text = cleanNoteText(request.body?.text)

  if (!text) {
    return response.status(400).json({ error: 'A note needs something in it.' })
  }

  if (text.length > MAX_NOTE_LENGTH) {
    return response.status(400).json({ error: `Notes are at most ${MAX_NOTE_LENGTH} characters.` })
  }

  const now = Date.now()
  const key = readBearerToken(request) || request.ip || 'unknown'
  const waitMs = noteCooldownRemaining(key, now)

  if (waitMs > 0) {
    return response
      .status(429)
      .json({ error: 'The garden is quiet. Give it a moment.', retryInMs: waitMs })
  }

  const note = {
    id: crypto.randomBytes(NOTE_ID_BYTES).toString('hex'),
    author: sessionUsername(request) || 'Anonymous',
    text,
    createdAt: new Date(now).toISOString(),
  }

  const notes = readNotes(now).concat(note).slice(-MAX_NOTES)

  writeNotes(notes)
  rememberNoteAt(key, now)

  response.status(201).json({ notes, id: note.id })
})

// Nothing in the garden is moderated, so removing a note is an operator
// action, gated exactly like clearing the league.
app.delete('/api/garden/notes/:id', requireAdminToken, (request, response) => {
  const notes = readNotes()
  const remaining = notes.filter((note) => note.id !== request.params.id)

  if (remaining.length === notes.length) {
    return response.status(404).json({ error: 'No note with that id.' })
  }

  writeNotes(remaining)
  response.json({ notes: remaining })
})

app.post('/api/auth/signup', async (request, response) => {
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = request.body?.password
  const problem = validateCredentials(username, password)

  if (problem) {
    return response.status(400).json({ error: problem })
  }

  const accounts = readUsers()

  if (username in accounts) {
    return response.status(409).json({ error: 'That username is taken.' })
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')

  accounts[username] = {
    salt,
    hash: await derivePasswordHash(password, salt),
    createdAt: new Date().toISOString(),
  }

  writeUsers(accounts)

  // Claim the league row at zero presses so the Pristine badge is visible
  // before it is lost, matching what /api/stats/register used to do.
  const stats = readStats()

  if (!(username in stats.players)) {
    stats.players[username] = 0
    writeStats(stats)
  }

  response.status(201).json({ token: createSession(username), username })
})

app.post('/api/auth/login', async (request, response) => {
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const account = readUsers()[username]

  // Derive even when the account is missing, so a wrong username costs the same
  // time as a wrong password and cannot be distinguished by timing.
  const salt = account?.salt || crypto.randomBytes(SALT_BYTES).toString('hex')
  const candidate = await derivePasswordHash(password, salt)

  if (!account || !hashesMatch(candidate, account.hash)) {
    return response.status(401).json({ error: 'Wrong username or password.' })
  }

  response.json({ token: createSession(username), username })
})

app.post('/api/auth/logout', (request, response) => {
  sessions.delete(readBearerToken(request))
  response.status(204).end()
})

// Lets a client holding a token from a previous page load find out whether it
// is still valid -- in-memory sessions do not survive a server restart.
app.get('/api/auth/me', requireSession, (request, response) => {
  response.json({ username: request.username })
})

app.get('/api/stats', (_request, response) => {
  response.json({ players: toLeagueTable(readStats()) })
})

// Claims the caller's own row at zero presses so the Pristine badge can be
// held and seen before it is lost. Never resets an existing player's count.
// Signup does this too; this endpoint covers a session that predates the row.
app.post('/api/stats/register', requireSession, (request, response) => {
  const stats = readStats()

  if (!(request.username in stats.players)) {
    stats.players[request.username] = 0
    writeStats(stats)
  }

  response.status(201).json({ players: toLeagueTable(stats) })
})

// The pressing player is taken from the session, never from the body. An
// unauthenticated press is allowed but can only ever land on 'Anonymous', so
// there is no way to post a press under a name you do not hold.
app.post('/api/stats/press', (request, response) => {
  const name = sessionUsername(request) || normalizeName('')
  const stats = readStats()

  stats.players[name] = (stats.players[name] || 0) + 1
  writeStats(stats)

  response.status(201).json({ players: toLeagueTable(stats), name })
})

// Resets another player's press count. This is an operator action, not a
// player one, so it is gated on the shared operator token exactly like
// /api/stats/clear rather than on the caller's session.
//
// A session gate was not enough: it proves the caller is someone, while the
// target came from the request body and was never compared against them, so
// any signed-in player could zero any other player's score. There is no
// per-user admin flag to compare against -- accounts hold only salt, hash and
// createdAt -- so authorizing this against the operator token is the check
// that actually exists in this app. Self-service reset would not be right
// either: Pristine is documented as lost on the first press with no
// revocation step, and a self-reset would quietly reinstate it.
app.post('/api/stats/reset-player', requireAdminToken, (request, response) => {
  const target =
    typeof request.body?.username === 'string' ? request.body.username.trim() : ''

  if (!target) {
    return response.status(400).json({ error: 'A username is required.' })
  }

  const stats = readStats()

  if (!(target in stats.players)) {
    return response.status(404).json({ error: 'No player with that name.' })
  }

  stats.players[target] = 0
  writeStats(stats)

  response.json({ players: toLeagueTable(stats), name: target })
})

app.post('/api/stats/clear', requireAdminToken, (_request, response) => {
  writeStats(createEmptyStats())
  response.json({ players: [] })
})

sweepStaleTempFiles()

app.listen(port, () => {
  console.log(`Stats server listening on http://localhost:${port}`)
})
