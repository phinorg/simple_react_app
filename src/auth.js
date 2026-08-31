// Accounts live in the browser's localStorage.
//
// This is a demo-grade stand-in for a real backend, not authentication. Anyone
// with devtools can read, edit, or delete the whole store, so it proves nothing
// about who is using the page, and the API still trusts whatever name it is
// handed. Accounts are per-browser: they do not follow you to another device.
//
// Passwords are still PBKDF2-hashed with a per-account salt rather than stored
// as typed. That cannot protect the account -- an attacker reading the store
// has already won -- but people reuse passwords, and a reused one should not be
// sitting in plain text where a stray XSS or a shared machine can lift it.

const USERS_KEY = 'vibe-demo-users'
const SESSION_KEY = 'vibe-demo-session'

const PBKDF2_ITERATIONS = 100000
const SALT_BYTES = 16
const KEY_BITS = 256

export const MIN_PASSWORD_LENGTH = 8
export const MAX_USERNAME_LENGTH = 32

// crypto.subtle only exists in a secure context: https, or localhost over
// plain http. Reaching a dev server by LAN IP silently loses it, so fail with
// an explanation rather than a TypeError on undefined.
function requireSubtleCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error(
      'Password hashing needs a secure context. Open the app over https or on localhost.',
    )
  }

  return window.crypto.subtle
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

async function derivePasswordHash(password, saltHex) {
  const subtle = requireSubtleCrypto()

  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BITS,
  )

  return toHex(bits)
}

// Same defence the stats API uses: JSON.parse hands back a normal object, so a
// username of "__proto__" would otherwise land on a prototype-bearing map.
function toSafeAccounts(parsed) {
  const accounts = Object.create(null)

  for (const [name, record] of Object.entries(parsed || {})) {
    if (record && typeof record === 'object') {
      accounts[name] = record
    }
  }

  return accounts
}

export function readAccounts() {
  try {
    return toSafeAccounts(JSON.parse(window.localStorage.getItem(USERS_KEY)))
  } catch {
    // Corrupt or unreadable store (private mode, cleared data, hand-edited
    // JSON). Start empty rather than wedging the whole page.
    return Object.create(null)
  }
}

function writeAccounts(accounts) {
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(accounts))
  } catch (error) {
    throw new Error('Could not save your account. Browser storage may be full or blocked.')
  }
}

export function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim() : ''
}

// Returns an error string, or '' when the pair is acceptable.
export function validateCredentials(username, password) {
  const name = normalizeUsername(username)

  if (!name) {
    return 'Pick a username.'
  }

  if (name.length > MAX_USERNAME_LENGTH) {
    return `Usernames are at most ${MAX_USERNAME_LENGTH} characters.`
  }

  if (name.toLowerCase() === 'anonymous') {
    return '"Anonymous" is reserved for players without a name.'
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`
  }

  return ''
}

export async function signUp(username, password) {
  const name = normalizeUsername(username)
  const problem = validateCredentials(name, password)

  if (problem) {
    throw new Error(problem)
  }

  const accounts = readAccounts()

  if (name in accounts) {
    throw new Error('That username is taken.')
  }

  const salt = toHex(window.crypto.getRandomValues(new Uint8Array(SALT_BYTES)))

  accounts[name] = {
    salt,
    hash: await derivePasswordHash(password, salt),
    createdAt: new Date().toISOString(),
  }

  writeAccounts(accounts)

  return name
}

export async function signIn(username, password) {
  const name = normalizeUsername(username)
  const account = readAccounts()[name]

  // Hash even when the account is missing, so a wrong username and a wrong
  // password take the same time to reject.
  const salt = account?.salt || toHex(new Uint8Array(SALT_BYTES))
  const candidate = await derivePasswordHash(password, salt)

  if (!account || candidate !== account.hash) {
    throw new Error('Wrong username or password.')
  }

  return name
}

export function readSession() {
  try {
    const name = window.localStorage.getItem(SESSION_KEY)

    // A session naming an account that no longer exists is stale; drop it.
    return name && name in readAccounts() ? name : ''
  } catch {
    return ''
  }
}

export function writeSession(username) {
  try {
    window.localStorage.setItem(SESSION_KEY, username)
  } catch {
    // Signing in still works for this tab; it just will not outlive a refresh.
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
