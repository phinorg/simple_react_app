import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_NOTE_LENGTH, STAGE_MARKS, describeNote, fetchNotes, postNote } from './garden'

// The page behind the title. Nothing links here, so everyone reading it went
// looking -- which is the whole reason it is a place to leave messages rather
// than another scoreboard. It is deliberately unlike the front page: no
// taunting, nothing to win, no press counter to feed.

// Long enough not to hammer the API, short enough that two people in here at
// the same time can hold something like a conversation.
const REFRESH_MS = 15000

// Re-render on a slow tick so ages and wilt keep up without a fetch.
const AGE_TICK_MS = 60000

// Treat the log as "following" while the reader is within this many pixels of
// the bottom, so arriving notes scroll into view for someone reading live but
// never yank the page from under someone scrolled back through the week.
const FOLLOW_THRESHOLD_PX = 64

function GardenPage({ onLeave, account }) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  // Two failures that read very differently: the log never arrived, or a note
  // was refused. Keeping them apart is what stops a rejected post looking like
  // a dead API, and a dead API looking like an empty garden.
  const [loadError, setLoadError] = useState('')
  const [postError, setPostError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const logRef = useRef(null)
  const followingRef = useRef(true)

  const load = useCallback(async () => {
    try {
      setNotes(await fetchNotes())
      setLoadError('')
    } catch (failure) {
      setLoadError(failure.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    const refresh = window.setInterval(() => {
      // A backgrounded tab does not need the garden kept warm.
      if (!document.hidden) {
        load()
      }
    }, REFRESH_MS)

    const onVisible = () => {
      if (!document.hidden) {
        load()
      }
    }

    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => window.clearInterval(tick)
  }, [])

  useEffect(() => {
    const log = logRef.current

    if (log && followingRef.current) {
      log.scrollTop = log.scrollHeight
    }
  }, [notes])

  const handleScroll = (event) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    followingRef.current = scrollHeight - scrollTop - clientHeight <= FOLLOW_THRESHOLD_PX
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const text = draft.trim()

    if (!text || sending) {
      return
    }

    setSending(true)
    setPostError('')

    try {
      followingRef.current = true
      setNotes(await postNote(text))
      setLoadError('')
      setDraft('')
    } catch (failure) {
      setPostError(failure.message)
    } finally {
      setSending(false)
    }
  }

  const remaining = MAX_NOTE_LENGTH - draft.trim().length
  // With nothing on screen there is no telling an empty garden from an
  // unreachable one, so say which it is. With notes already showing, a failed
  // refresh is not worth interrupting the reading for -- the log is still good.
  const unreachable = Boolean(loadError) && notes.length === 0
  const banner = postError || (notes.length > 0 ? loadError : '')

  return (
    <div className="garden-page">
      <h1 className="garden-title">The Midnight Garden</h1>
      <p className="garden-note">
        Notes left here wilt after a week. Nobody is keeping score.
      </p>

      <div className="garden-log" ref={logRef} onScroll={handleScroll} aria-live="polite">
        {loading ? (
          <p className="garden-empty">Listening...</p>
        ) : unreachable ? (
          // Not the same as an empty garden, and saying so would be a lie: the
          // notes may well be there, on the other side of a dead API.
          <p className="garden-empty">
            The garden is out of reach. Whatever is growing here is still
            growing; try again in a moment.
          </p>
        ) : notes.length > 0 ? (
          notes.map((note) => {
            const { age, stage } = describeNote(note.createdAt, now)

            return (
              <article key={note.id} className={`garden-entry garden-entry-${stage}`}>
                <header className="garden-entry-meta">
                  <span className="garden-author">{note.author}</span>
                  <span className="garden-age">
                    {age} <span aria-hidden="true">{STAGE_MARKS[stage]}</span>
                  </span>
                </header>
                <p className="garden-entry-text">{note.text}</p>
              </article>
            )
          })
        ) : (
          <p className="garden-empty">
            Nothing is growing yet. Whatever you leave will be the first thing
            the next person finds.
          </p>
        )}
      </div>

      {banner && <p className="garden-error" role="alert">{banner}</p>}

      <form className="garden-composer" onSubmit={handleSubmit}>
        <label className="garden-composer-field">
          <span className="garden-composer-label">
            Leave a note as {account || 'Anonymous'}
          </span>
          <textarea
            className="garden-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            rows={2}
            placeholder="Say something to whoever gets here next..."
          />
        </label>
        <div className="garden-composer-row">
          <span className={`garden-remaining ${remaining < 40 ? 'garden-remaining-low' : ''}`}>
            {remaining}
          </span>
          <button
            type="submit"
            className="garden-plant"
            disabled={sending || !draft.trim()}
          >
            {sending ? 'Planting...' : 'Plant it'}
          </button>
        </div>
      </form>

      <button type="button" className="garden-exit" onClick={onLeave}>
        Back to the surface
      </button>
    </div>
  )
}

export default GardenPage
