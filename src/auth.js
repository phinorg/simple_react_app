// Thin client for the server's account endpoints.
//
// Passwords are sent to the API and never stored, hashed, or examined here --
// the server owns the account store, so the browser holds nothing worth
// stealing but a session token. Presses are attributed from that token, so a
// forged request body cannot score under someone else's name.

const TOKEN_KEY = 'vibe-demo-token'

// Kept in step with the server's own rule so the form can complain before a
// round trip. The server re-checks; this is only for the error message.
export const MIN_PASSWORD_LENGTH = 8

export function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    // Private mode or blocked storage: sign-in still works for this tab.
    return ''
  }
}

function writeToken(token) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Not fatal -- the session just will not outlive a refresh.
  }
}

function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// Presses and registrations carry the token so the API knows who is calling.
export function authHeaders() {
  const token = readToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })

  let payload = {}

  try {
    payload = await response.json()
  } catch {
    // A proxy error page or an empty body; fall through to the status check.
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return payload
}

export async function signUp(username, password) {
  const { token, username: name } = await postJson('/api/auth/signup', { username, password })
  writeToken(token)
  return name
}

export async function signIn(username, password) {
  const { token, username: name } = await postJson('/api/auth/login', { username, password })
  writeToken(token)
  return name
}

export async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() })
  } catch {
    // Dropping the local token is what matters; the server session expires
    // with the process anyway.
  }

  clearToken()
}

// Sessions live in the server's memory, so a stored token can outlive the
// session it names. Ask before trusting it, and discard it if it is stale.
export async function restoreSession() {
  if (!readToken()) {
    return ''
  }

  try {
    const response = await fetch('/api/auth/me', { headers: authHeaders() })

    if (!response.ok) {
      clearToken()
      return ''
    }

    const { username } = await response.json()
    return username || ''
  } catch {
    // API unreachable. Keep the token; it may work once the server is back.
    return ''
  }
}
