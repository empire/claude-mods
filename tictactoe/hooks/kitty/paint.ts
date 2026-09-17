import type { Cell } from '../game.ts'

/**
 * What one frame of the board shows, as the board module posts it: plain
 * data, so it crosses from the drawing thread to the hooks module.
 */
export type View = {
  board: Cell[]
  /** The highlighted cell, or null while it is not the person's move. */
  cursor: number | null
  /** The cell whose mark is scaling in, and how far along (0..1). */
  placing: { index: number; t: number } | null
  /** The winning line and how much of it is drawn (0..1). */
  win: { line: number[]; t: number } | null
  isDraw: boolean
}

/** The image's size in pixels and where the square board sits inside it. */
export type Canvas = { width: number; height: number; left: number; top: number; side: number }

type Rgb = readonly [number, number, number]

const BOARD_TOP: Rgb = [0x2d, 0x2b, 0x28]
const BOARD_BOTTOM: Rgb = [0x1f, 0x1d, 0x1b]
const BOARD_EDGE: Rgb = [0x45, 0x41, 0x3c]
const DRAW_EDGE: Rgb = [0xe6, 0xc0, 0x5a]
const GRID: Rgb = [0x4a, 0x46, 0x41]
const X_FROM: Rgb = [0x7d, 0xee, 0xff]
const X_TO: Rgb = [0x3b, 0x82, 0xf6]
const O_FROM: Rgb = [0xf6, 0xb3, 0x93]
const O_TO: Rgb = [0xd9, 0x77, 0x57]
const ACCENT: Rgb = [0xd9, 0x77, 0x57]
const WIN: Rgb = [0xff, 0xe9, 0xa8]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Ease out with a small overshoot, so a placed mark pops in. */
const easeOutBack = (t: number) => {
  const c = 1.7
  const u = t - 1

  return 1 + (c + 1) * u * u * u + c * u * u
}

/** Distance from (px, py) to the segment a-b, less the radius: a capsule. */
function capsule(px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay || 1))

  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

function roundedRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r

  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Paints one frame as straight RGBA, transparent around the board so the
 * terminal's background shows through.
 */
export function paint(view: View, canvas: Canvas): Uint8Array {
  const { width, height, left, top, side } = canvas
  const px = new Float32Array(width * height * 4)
  const cell = side / 3
  const aa = 1

  // Composites a color at alpha over one pixel.
  const over = (i: number, c: Rgb, a: number) => {
    if (a <= 0) return
    const k = i * 4
    const da = px[k + 3] ?? 0
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    for (let ch = 0; ch < 3; ch++) {
      px[k + ch] = ((c[ch] ?? 0) * a + (px[k + ch] ?? 0) * da * (1 - a)) / oa
    }
    px[k + 3] = oa
  }

  // Runs `shade` over a pixel box clipped to the image.
  const region = (x0: number, y0: number, x1: number, y1: number, shade: (x: number, y: number, i: number) => void) => {
    const xa = Math.max(0, Math.floor(x0))
    const ya = Math.max(0, Math.floor(y0))
    const xb = Math.min(width, Math.ceil(x1))
    const yb = Math.min(height, Math.ceil(y1))
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) shade(x + 0.5, y + 0.5, y * width + x)
    }
  }

  const coverage = (d: number) => clamp01(0.5 - d / aa)

  // Everything drawn after the board is clipped to its rounded shape, so no glow spills past it.
  const mask = new Float32Array(width * height)
  const clipped = (i: number, c: Rgb, a: number) => over(i, c, a * (mask[i] ?? 0))

  // The board: a rounded square with a vertical gradient and a thin edge.
  const cx = left + side / 2
  const cy = top + side / 2
  const radius = side * 0.07
  const edgeColor = view.isDraw ? DRAW_EDGE : BOARD_EDGE

  region(left - 1, top - 1, left + side + 1, top + side + 1, (x, y, i) => {
    const d = roundedRect(x, y, cx, cy, side / 2 - 1, side / 2 - 1, radius)
    const a = coverage(d)
    if (a <= 0) return
    mask[i] = a
    over(i, mix(BOARD_TOP, BOARD_BOTTOM, clamp01((y - top) / side)), a)
    const edge = coverage(Math.abs(d + 1.2) - Math.max(1, side * 0.003))
    over(i, edgeColor, edge * (view.isDraw ? 0.9 : 0.8))
  })

  // Grid lines: four rounded bars inset from the edges.
  const inset = side * 0.08
  const bar = Math.max(1.5, side * 0.008)

  for (const k of [1, 2]) {
    const at = k * cell

    region(left + at - bar * 2, top + inset - bar * 2, left + at + bar * 2, top + side - inset + bar * 2, (x, y, i) => {
      clipped(i, GRID, coverage(capsule(x, y, left + at, top + inset, left + at, top + side - inset, bar)))
    })
    region(left + inset - bar * 2, top + at - bar * 2, left + side - inset + bar * 2, top + at + bar * 2, (x, y, i) => {
      clipped(i, GRID, coverage(capsule(x, y, left + inset, top + at, left + side - inset, top + at, bar)))
    })
  }

  const isOver = view.win !== null || view.isDraw

  // The cursor: a soft accent tile, with a faint X previewing the move.
  if (view.cursor !== null && !isOver) {
    const col = view.cursor % 3
    const row = Math.floor(view.cursor / 3)
    const ccx = left + (col + 0.5) * cell
    const ccy = top + (row + 0.5) * cell
    const half = cell / 2 - cell * 0.09

    region(ccx - cell / 2, ccy - cell / 2, ccx + cell / 2, ccy + cell / 2, (x, y, i) => {
      const d = roundedRect(x, y, ccx, ccy, half, half, cell * 0.12)
      clipped(i, ACCENT, coverage(d) * 0.1)
      clipped(i, ACCENT, coverage(Math.abs(d) - Math.max(0.8, cell * 0.012)) * 0.55)
    })

    if (view.board[view.cursor] === null) {
      drawX(ccx, ccy, 1, 0.16, false)
    }
  }

  const dimOthers = view.win !== null ? 0.3 : view.isDraw ? 0.55 : 1

  view.board.forEach((mark, index) => {
    if (mark === null) return
    const ccx = left + ((index % 3) + 0.5) * cell
    const ccy = top + (Math.floor(index / 3) + 0.5) * cell
    const scale = view.placing?.index === index ? Math.max(0.05, easeOutBack(clamp01(view.placing.t))) : 1
    const isWinner = view.win?.line.includes(index) ?? false
    const alpha = isWinner ? 1 : dimOthers

    if (mark === 'X') drawX(ccx, ccy, scale, alpha, true)
    else drawO(ccx, ccy, scale, alpha)
  })

  // The win: a glowing line drawn out through the three cells.
  if (view.win) {
    const [first, , last] = view.win.line
    if (first !== undefined && last !== undefined) {
      const ax = left + ((first % 3) + 0.5) * cell
      const ay = top + (Math.floor(first / 3) + 0.5) * cell
      const bx0 = left + ((last % 3) + 0.5) * cell
      const by0 = top + (Math.floor(last / 3) + 0.5) * cell
      const ext = cell * 0.32
      const len = Math.hypot(bx0 - ax, by0 - ay) || 1
      const ux = (bx0 - ax) / len
      const uy = (by0 - ay) / len
      const sx = ax - ux * ext
      const sy = ay - uy * ext
      const t = clamp01(view.win.t)
      const ex = sx + ux * (len + ext * 2) * t
      const ey = sy + uy * (len + ext * 2) * t
      const r = cell * 0.035
      const glow = cell * 0.12

      region(Math.min(sx, ex) - glow * 4, Math.min(sy, ey) - glow * 4, Math.max(sx, ex) + glow * 4, Math.max(sy, ey) + glow * 4, (x, y, i) => {
        const d = capsule(x, y, sx, sy, ex, ey, r)
        clipped(i, WIN, Math.exp(-Math.max(d, 0) / glow) * 0.45)
        clipped(i, WIN, coverage(d))
      })
    }
  }

  function drawX(ccx: number, ccy: number, scale: number, alpha: number, glowing: boolean) {
    const arm = cell * 0.25 * scale
    const r = cell * 0.058 * scale
    const glow = cell * 0.09

    region(ccx - cell / 2, ccy - cell / 2, ccx + cell / 2, ccy + cell / 2, (x, y, i) => {
      const d = Math.min(
        capsule(x, y, ccx - arm, ccy - arm, ccx + arm, ccy + arm, r),
        capsule(x, y, ccx + arm, ccy - arm, ccx - arm, ccy + arm, r),
      )
      const color = mix(X_FROM, X_TO, clamp01((x - ccx + y - ccy) / (cell * 0.9) + 0.5))
      if (glowing) clipped(i, X_TO, Math.exp(-Math.max(d, 0) / glow) * 0.35 * alpha)
      clipped(i, color, coverage(d) * alpha)
    })
  }

  function drawO(ccx: number, ccy: number, scale: number, alpha: number) {
    const ring = cell * 0.25 * scale
    const w = cell * 0.058 * scale
    const glow = cell * 0.09

    region(ccx - cell / 2, ccy - cell / 2, ccx + cell / 2, ccy + cell / 2, (x, y, i) => {
      const d = Math.abs(Math.hypot(x - ccx, y - ccy) - ring) - w
      const color = mix(O_FROM, O_TO, clamp01((y - ccy) / (cell * 0.6) + 0.5))
      clipped(i, O_TO, Math.exp(-Math.max(d, 0) / glow) * 0.35 * alpha)
      clipped(i, color, coverage(d) * alpha)
    })
  }

  const out = new Uint8Array(width * height * 4)
  for (let k = 0; k < out.length; k++) out[k] = Math.round(k % 4 === 3 ? (px[k] ?? 0) * 255 : (px[k] ?? 0))

  return out
}

/**
 * Sizes the image to the cell box it is placed in, at the terminal's own
 * pixel density, with the square board centred.
 */
export function canvasOf(columns: number, rows: number, cellWidth: number, cellHeight: number, maxSide = 720): Canvas {
  const fullWidth = columns * cellWidth
  const fullHeight = rows * cellHeight
  const scale = Math.min(1, maxSide / Math.max(fullWidth, fullHeight))
  const width = Math.max(1, Math.round(fullWidth * scale))
  const height = Math.max(1, Math.round(fullHeight * scale))
  const side = Math.min(width, height)

  return { width, height, side, left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2) }
}
