import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

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
  const [userName, setUserName] = useState('')
  const [page, setPage] = useState('home')
  const [stats, setStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [dodge, setDodge] = useState({ x: 0, y: 0 })
  const [dodgeCount, setDodgeCount] = useState(0)

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

  const nameSuffix = userName.trim() ? `, ${userName.trim()}` : ''
  const trimmedName = userName.trim()
  const myBadges = stats.find((player) => player.name === trimmedName)?.badges || []

  // Claims the name at zero presses so the Pristine badge is visible before
  // it is lost, rather than only existing in the instant it is taken away.
  const registerName = async () => {
    if (!trimmedName) {
      return
    }

    try {
      const response = await fetch('/api/stats/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
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

  const recordButtonPress = async () => {
    try {
      const response = await fetch('/api/stats/press', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: userName }),
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

  const renderHomePage = () => (
    <div className="container">
      <h1 className="demo-title">Vibe Code Demo</h1>
      <label className="name-box">
        <span>Your name</span>
        <input
          type="text"
          value={userName}
          onChange={(event) => setUserName(event.target.value)}
          placeholder="Enter your name"
          onBlur={registerName}
        />
      </label>
      <div className="badge-shelf" aria-live="polite">
        {myBadges.length > 0 ? (
          myBadges.map((badge) => (
            <span key={badge.id} className={`badge badge-${badge.id}`} title={badge.description}>
              <span aria-hidden="true">{badge.icon}</span> {badge.label}
            </span>
          ))
        ) : (
          <span className="badge-empty">
            {trimmedName ? 'No badges. The Pristine one is already gone.' : 'Enter your name to claim a badge.'}
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
        <button type="button" className="clear-stats-button" onClick={handleClearStats}>
          Clear Stats
        </button>
      ) : (
        <p className="stats-empty">
          Clearing stats requires an operator to configure VITE_ADMIN_TOKEN.
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
          onClick={() => setPage('home')}
        >
          Home
        </button>
        <button
          type="button"
          className={page === 'stats' ? 'active' : ''}
          onClick={() => setPage('stats')}
        >
          Stats
        </button>
      </nav>
      {page === 'stats' ? renderStatsPage() : renderHomePage()}
    </div>
  )
}
// add a comment to change the file 
export default App

