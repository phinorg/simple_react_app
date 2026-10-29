// Works out where inside a run of rendered text a pointer landed.
//
// A Range gives the box a character occupies, but that box is the line box
// crossed with the advance width -- it is taller and wider than the shape the
// glyph actually paints. Canvas text metrics measured in the same font give
// the ink box inside it, which is what a caller pointing at "the middle of
// that letter" really means.

// Radius of the hit ellipse as a fraction of the ink box. 0.26 keeps it inside
// the counter (the enclosed hole) of a round lowercase letter.
const DEFAULT_RADIUS_RATIO = 0.26

let measuringContext

function getMeasuringContext() {
  if (measuringContext === undefined) {
    measuringContext = document.createElement('canvas').getContext('2d') || null
  }

  return measuringContext
}

function characterRect(element, index) {
  const node = element.firstChild

  if (!node || node.nodeType !== Node.TEXT_NODE || index < 0 || index >= node.length) {
    return null
  }

  const range = document.createRange()
  range.setStart(node, index)
  range.setEnd(node, index + 1)

  const rect = range.getBoundingClientRect()

  return rect.width > 0 && rect.height > 0 ? rect : null
}

// Fallback for browsers that do not report the metrics below: assume the
// proportions of a typical sans-serif lowercase letter.
function approximateInkBox(rect, fontSize) {
  const height = fontSize * 0.52
  const baseline = rect.top + rect.height / 2 + fontSize * 0.36

  return {
    x: rect.left + rect.width / 2,
    y: baseline - height / 2,
    width: fontSize * 0.55,
    height,
  }
}

function inkBox(rect, styles, character) {
  const fontSize = parseFloat(styles.fontSize) || rect.height
  const context = getMeasuringContext()

  if (!context) {
    return approximateInkBox(rect, fontSize)
  }

  context.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`

  const metrics = context.measureText(character)
  const {
    fontBoundingBoxAscent,
    fontBoundingBoxDescent,
    actualBoundingBoxAscent,
    actualBoundingBoxDescent,
    actualBoundingBoxLeft,
    actualBoundingBoxRight,
  } = metrics

  const parts = [
    fontBoundingBoxAscent,
    fontBoundingBoxDescent,
    actualBoundingBoxAscent,
    actualBoundingBoxDescent,
    actualBoundingBoxLeft,
    actualBoundingBoxRight,
  ]

  if (!parts.every(Number.isFinite)) {
    return approximateInkBox(rect, fontSize)
  }

  // Centre the font's own ascent/descent box in the rect to find the baseline,
  // then hang the glyph's ink off it. The rect's left edge is the glyph origin,
  // so CSS letter-spacing padding the advance width does not shift the ink.
  const fontHeight = fontBoundingBoxAscent + fontBoundingBoxDescent
  const baseline = rect.top + (rect.height - fontHeight) / 2 + fontBoundingBoxAscent

  const left = rect.left - actualBoundingBoxLeft
  const right = rect.left + actualBoundingBoxRight
  const top = baseline - actualBoundingBoxAscent
  const bottom = baseline + actualBoundingBoxDescent

  if (right <= left || bottom <= top) {
    return approximateInkBox(rect, fontSize)
  }

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: bottom - top,
  }
}

// True when the viewport point sits in the middle of the character at `index`
// of `element`'s text. `element` must hold a single, unwrapped text node.
export function isPointInGlyphCentre(element, index, point, radiusRatio = DEFAULT_RADIUS_RATIO) {
  const rect = characterRect(element, index)

  if (!rect) {
    return false
  }

  const ink = inkBox(rect, window.getComputedStyle(element), element.textContent[index])
  const dx = (point.x - ink.x) / (ink.width * radiusRatio)
  const dy = (point.y - ink.y) / (ink.height * radiusRatio)

  return dx * dx + dy * dy <= 1
}
