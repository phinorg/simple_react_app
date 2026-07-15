import { useState } from 'react'
import './App.css'

function App() {
  const [exploded, setExploded] = useState(false)
  const [awaitingApology, setAwaitingApology] = useState(false)
  const [showForgiven, setShowForgiven] = useState(false)
  const [pressCount, setPressCount] = useState(0)
  const [userName, setUserName] = useState('')

  const isDisabled = exploded || awaitingApology || showForgiven
  const nameSuffix = userName.trim() ? `, ${userName.trim()}` : ''

  const handleClick = () => {
    setPressCount((count) => count + 1)
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

  return (
    <div className="app">
      <div className="press-counter" aria-label={`Button pressed ${pressCount} times`}>
        {pressCount}
      </div>
      <div className="container">
        <h1 className="demo-title">Vibe Code Demo</h1>
        <label className="name-box">
          <span>Your name</span>
          <input
            type="text"
            value={userName}
            onChange={(event) => setUserName(event.target.value)}
            placeholder="Enter your name"
          />
        </label>
        <button
          className={`exploding-button ${exploded ? 'explode' : ''}`}
          onClick={handleClick}
          disabled={isDisabled}
        >
          DO NOT PUSH. NEVER, EVER. OR ELSE!
        </button>
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
    </div>
  )
}
// add a comment to change the file 
export default App

