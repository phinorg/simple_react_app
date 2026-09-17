// The page behind the title. It is deliberately unadvertised -- nothing in the
// nav or the home page points at it -- so it lives in its own component, ready
// to grow into something interactive without dragging App along with it.
function GardenPage({ onLeave }) {
  return (
    <div className="garden-page">
      <h1 className="garden-title">The Midnight Garden</h1>
      <div className="garden-card">
        <p className="garden-text">Nothing grows here yet.</p>
        <p className="garden-text garden-text-quiet">
          You found the way in, which was the hard part.
        </p>
      </div>
      <button type="button" className="garden-exit" onClick={onLeave}>
        Back to the surface
      </button>
    </div>
  )
}

export default GardenPage
