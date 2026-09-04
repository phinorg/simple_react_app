import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  MIN_PASSWORD_LENGTH,
  authHeaders,
  restoreSession,
  signIn,
  signOut,
  signUp,
} from './auth'

const adminToken = import.meta.env.VITE_ADMIN_TOKEN

// The button flees the cursor -- but only so many times. If it could dodge
// forever the press counter and the Button League would be unwinnable, so it
// runs out of nerve after MAX_DODGES and stands still to be pushed.
const MAX_DODGES = 6
const FLEE_RADIUS = 140
const FLEE_STRENGTH = 0.9
const VIEWPORT_MARGIN = 12

const TAUNTS = [
  'Nope.',
  'Not today.',
  "You'll never catch me.",
  'Missed. Embarrassing, really.',
  '...ok, you are weirdly persistent.',
  'Fine. FINE. Push it. See what happens.',
]

function App() {
  const [exploded, setExploded] = useState(false)
  const [awaitingApology, setAwaitingApology] = useState(false)
  const [showForgiven, setShowForgiven] = useState(false)
  const [pressCount, setPressCount] = useState(0)
  const [page, setPage] = useState('home')
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [dodge, setDodge] = useState({ x: 0, y: 0 })
  const [dodgeCount, setDodgeCount] = useState(0)
  const [account, setAccount] = useState('')
  const [authForm, setAuthForm] = useState({ username: '', password: '', confirm: '' })
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [resetTarget, setResetTarget] = useState('')

  const dodgeRef = useRef({ x: 0, y: 0 })
  const wrapRef = useRef(null)
  const wasNearRef = useRef(false)

  const isDisabled = exploded || awaitingApology || showForgiven
  const exhausted = dodgeCount >= MAX_DODGES

  const resetDodge = useCallback(() => {
    dodgeRef.current = { x: 0, y: 0 }
    wasNearRef.current = false
    setDodge({ x: 0, y: 0 })
    setDodgeCount(0)
  }, [])

  // Mouse-only evasion: keyboard users tab to the button and press Enter, and
  // touch devices never fire mousemove, so both reach it without a fight.
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || isDisabled || exhausted) {
      return undefined
    }

    const handleMouseMove = (event) => {
      const wrap = wrapRef.current

      if (!wrap) {
        return
      }

      const rect = wrap.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = centerX - event.clientX
      const dy = centerY - event.clientY
      const distance = Math.hypot(dx, dy)

      if (distance > FLEE_RADIUS) {
        wasNearRef.current = false
        return
      }

      // Count one dodge per approach, not one per mousemove event.
      if (!wasNearRef.current) {
        wasNearRef.current = true
        setDodgeCount((count) => count + 1)
      }

      // Straight-up approach gives a zero vector; nudge it sideways instead.
      const angle = distance < 1 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx)
      const push = (FLEE_RADIUS - distance) * FLEE_STRENGTH
      const current = dodgeRef.current

      // Clamp against the button's untranslated position so it cannot be
      // herded off the edge of the viewport.
      const baseLeft = rect.left - current.x
      const baseTop = rect.top - current.y
      const minX = VIEWPORT_MARGIN - baseLeft
      const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN - baseLeft
      const minY = VIEWPORT_MARGIN - baseTop
      const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN - baseTop

      const next = {
        x: Math.min(Math.max(current.x + Math.cos(angle) * push, minX), maxX),
        y: Math.min(Math.max(current.y + Math.sin(angle) * push, minY), maxY),
      }

      dodgeRef.current = next
      setDodge(next)
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [isDisabled, exhausted])

  // Once it gives up, it slinks back to where it started.
  useEffect(() => {
    if (exhausted) {
      dodgeRef.current = { x: 0, y: 0 }
      setDodge({ x: 0, y: 0 })
    }
  }, [exhausted])

  const nameSuffix = account ? `, ${account}` : ''
  const myBadges = stats.find((player) => player.name === account)?.badges || []

  // Claims the caller's row at zero presses so the Pristine badge is visible
  // before it is lost. Signup does this too; this covers a session whose row
  // predates it. The server takes the name from the token, so nothing is sent.
  const registerName = async () => {
    try {
      const response = await fetch('/api/stats/register', {
        method: 'POST',
        headers: authHeaders(),
      })

      if (!response.ok) {
        throw new Error('Unable to claim your name')
      }

      const data = await response.json()
      setStats(data.players || [])
    } catch (error) {
      setStatsError(error.message)
    }
  }

  const fetchStats = async () => {
    setStatsLoading(true)
    setStatsError('')

    try {
      const response = await fetch('/api/stats')

      if (!response.ok) {
        throw new Error('Unable to load stats')
      }

      const data = await response.json()
      setStats(data.players || [])
    } catch (error) {
      setStatsError(error.message)
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    if (page === 'stats') {
      fetchStats()
    }
  }, [page])

  // No name is sent: the API attributes the press to the session token, or to
  // Anonymous when there is none.
  const recordButtonPress = async () => {
    try {
      const response = await fetch('/api/stats/press', {
        method: 'POST',
        headers: authHeaders(),
      })

      if (!response.ok) {
        throw new Error('Unable to record button press')
      }

      const data = await response.json()
      setStats(data.players || [])
    } catch (error) {
      setStatsError(error.message)
    }
  }

  const handleClick = () => {
    setPressCount((count) => count + 1)
    recordButtonPress()
    resetDodge()
    setExploded(true)
    setTimeout(() => {
      setExploded(false)
      setAwaitingApology(true)
    }, 5000)
  }

  const handleSorry = () => {
    setAwaitingApology(false)
    setShowForgiven(true)
    setTimeout(() => {
      setShowForgiven(false)
    }, 1500)
  }

  const handleResetPlayer = async (event) => {
    event.preventDefault()
    setStatsLoading(true)
    setStatsError('')

    try {
      const response = await fetch('/api/stats/reset-player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken || '',
        },
        body: JSON.stringify({ username: resetTarget }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Unable to reset player')
      }

      setStats(data.players || [])
      setResetTarget('')
    } catch (error) {
      setStatsError(error.message)
    } finally {
      setStatsLoading(false)
    }
  }

  const handleClearStats = async () => {
    setStatsLoading(true)
    setStatsError('')

    try {
      const response = await fetch('/api/stats/clear', {
        method: 'POST',
        headers: {
          'x-admin-token': adminToken || '',
        },
      })

      if (!response.ok) {
        throw new Error('Unable to clear stats')
      }

      setStats([])
    } catch (error) {
      setStatsError(error.message)
    } finally {
      setStatsLoading(false)
    }
  }

  // A stored token can outlive the server session it names, so ask the API
  // whether it is still good rather than trusting it on sight.
  useEffect(() => {
    let cancelled = false

    restoreSession().then((name) => {
      if (!cancelled && name) {
        setAccount(name)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const resetAuthForm = () => {
    setAuthForm({ username: '', password: '', confirm: '' })
    setAuthError('')
  }

  const updateAuthField = (field) => (event) => {
    setAuthForm((form) => ({ ...form, [field]: event.target.value }))
  }

  useEffect(() => {
    if (account) {
      registerName()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  const goToPage = (nextPage) => {
    resetAuthForm()
    setPage(nextPage)
  }

  const handleSignUp = async (event) => {
    event.preventDefault()

    if (authForm.password !== authForm.confirm) {
      setAuthError('Those passwords do not match.')
      return
    }

    setAuthBusy(true)
    setAuthError('')

    try {
      const name = await signUp(authForm.username, authForm.password)
      setAccount(name)
      resetAuthForm()
      setPage('home')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogIn = async (event) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')

    try {
      const name = await signIn(authForm.username, authForm.password)
      setAccount(name)
      resetAuthForm()
      setPage('home')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const handleLogOut = async () => {
    await signOut()
    setAccount('')
    setPage('home')
  }

  const renderAuthPage = (mode) => {
    const isSignUp = mode === 'signup'

    return (
      <div className="auth-page">
        <h1 className="demo-title">{isSignUp ? 'Sign Up' : 'Log In'}</h1>
        <form className="auth-card" onSubmit={isSignUp ? handleSignUp : handleLogIn}>
          <label className="auth-field">
            <span>Username</span>
            <input
              type="text"
              value={authForm.username}
              onChange={updateAuthField('username')}
              autoComplete="username"
              placeholder="Pick a name for the league"
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={updateAuthField('password')}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
              required
            />
          </label>
          {isSignUp && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={authForm.confirm}
                onChange={updateAuthField('confirm')}
                autoComplete="new-password"
                placeholder="Type it again"
                required
              />
            </label>
          )}
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          <button type="submit" className="auth-submit" disabled={authBusy}>
            {authBusy ? 'Working...' : isSignUp ? 'Create account' : 'Log in'}
          </button>
          <p className="auth-switch">
            {isSignUp ? 'Already have an account? ' : 'Need an account? '}
            <button type="button" onClick={() => goToPage(isSignUp ? 'login' : 'signup')}>
              {isSignUp ? 'Log in' : 'Sign up'}
            </button>
          </p>
          <p className="auth-disclaimer">
            Accounts are stored in this browser only. They are not real security, they do not
            follow you to another device, and clearing site data deletes them.
          </p>
        </form>
      </div>
    )
  }

  const renderHomePage = () => (
    <div className="container">
      <h1 className="demo-title">Vibe Code Demo</h1>
      {account ? (
        <div className="name-box name-box-locked">
          <span>Playing as</span>
          <strong className="account-name">{account}</strong>
        </div>
      ) : (
        <div className="name-box name-box-locked">
          <span>Playing as</span>
          <strong className="account-name">Anonymous</strong>
          <button type="button" className="name-box-cta" onClick={() => goToPage('signup')}>
            Sign up to claim your presses
          </button>
        </div>
      )}
      <div className="badge-shelf" aria-live="polite">
        {myBadges.length > 0 ? (
          myBadges.map((badge) => (
            <span key={badge.id} className={`badge badge-${badge.id}`} title={badge.description}>
              <span aria-hidden="true">{badge.icon}</span> {badge.label}
            </span>
          ))
        ) : (
          <span className="badge-empty">
            {account ? 'No badges. The Pristine one is already gone.' : 'Sign up to claim a badge.'}
          </span>
        )}
      </div>
      <div
        className={`button-dodge-wrap ${exhausted ? 'exhausted' : ''}`}
        ref={wrapRef}
        style={{ transform: `translate(${dodge.x}px, ${dodge.y}px)` }}
      >
        <button
          className={`exploding-button ${exploded ? 'explode' : ''}`}
          onClick={handleClick}
          disabled={isDisabled}
        >
          DO NOT PUSH. NEVER, EVER. OR ELSE!
        </button>
      </div>
      <p className="taunt" aria-live="polite">
        {dodgeCount > 0 && !isDisabled ? TAUNTS[Math.min(dodgeCount, TAUNTS.length) - 1] : '\u00a0'}
      </p>
      {awaitingApology && (
        <div className="sorry-section">
          <p className="sorry-text">Are you sorry{nameSuffix}</p>
          <button type="button" className="sorry-button" onClick={handleSorry}>
            Yes, I'm very sorry{nameSuffix}
          </button>
        </div>
      )}
      {showForgiven && (
        <p className="forgiven-text">ok, then{nameSuffix}</p>
      )}
      {exploded && (
        <div className="explosion">
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
          <div className="particle"></div>
        </div>
      )}
    </div>
  )

  const renderStatsPage = () => (
    <div className="stats-page">
      <h1 className="demo-title">Button League</h1>
      <div className="stats-card">
        {statsError && <p className="stats-error">{statsError}</p>}
        {statsLoading ? (
          <p className="stats-empty">Loading stats...</p>
        ) : stats.length > 0 ? (
          <table className="stats-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Presses</th>
                <th>Badges</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((player, index) => (
                <tr key={player.name}>
                  <td>{index + 1}</td>
                  <td>{player.name}</td>
                  <td>{player.presses}</td>
                  <td className="badge-cell">
                    {(player.badges || []).map((badge) => (
                      <span
                        key={badge.id}
                        className={`badge badge-${badge.id}`}
                        title={badge.description}
                      >
                        <span aria-hidden="true">{badge.icon}</span> {badge.label}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="stats-empty">No button presses recorded yet.</p>
        )}
      </div>
      {adminToken ? (
        <>
          <form className="reset-player-form" onSubmit={handleResetPlayer}>
            <label className="auth-field">
              <span>Reset another player's presses</span>
              <input
                type="text"
                value={resetTarget}
                onChange={(event) => setResetTarget(event.target.value)}
                placeholder="Username to zero"
                required
              />
            </label>
            <button type="submit" className="clear-stats-button" disabled={statsLoading}>
              Reset player
            </button>
          </form>
          <button type="button" className="clear-stats-button" onClick={handleClearStats}>
            Clear Stats
          </button>
        </>
      ) : (
        <p className="stats-empty">
          Resetting a player and clearing stats are operator actions, and require
          VITE_ADMIN_TOKEN to be configured.
        </p>
      )}
    </div>
  )

  return (
    <div className="app">
      <div className="press-counter" aria-label={`Button pressed ${pressCount} times`}>
        {pressCount}
      </div>
      <nav className="page-nav" aria-label="Main navigation">
        <button
          type="button"
          className={page === 'home' ? 'active' : ''}
          onClick={() => goToPage('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={page === 'stats' ? 'active' : ''}
          onClick={() => goToPage('stats')}
        >
          Stats
        </button>
        {account ? (
          <button type="button" onClick={handleLogOut}>
            Log out ({account})
          </button>
        ) : (
          <>
            <button
              type="button"
              className={page === 'login' ? 'active' : ''}
              onClick={() => goToPage('login')}
            >
              Log in
            </button>
            <button
              type="button"
              className={page === 'signup' ? 'active' : ''}
              onClick={() => goToPage('signup')}
            >
              Sign up
            </button>
          </>
        )}
      </nav>
      {page === 'signup' || page === 'login'
        ? renderAuthPage(page)
        : page === 'stats'
          ? renderStatsPage()
          : renderHomePage()}
    </div>
  )
}
// add a comment to change the file 
export default App

