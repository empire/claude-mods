/* @jsx h */
import type { ClientElements, RenderElement } from 'claude-code'

// A cell grid the board module draws into, layer over layer, before it becomes Text. Boxes
// cannot overlap, so anything drawn over something else (the menu over the board) is
// composited here, cell by cell, and only the finished grid goes to the renderer.
//
// Every cell holds one width-1 character, except an image cell: a gap the grid leaves undrawn so
// the board's Image, which the hooks module draws beneath this module's region, shows through.
// Anything drawn over an image cell (a menu) replaces it, so it paints over the picture.

export type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean }
/** `isImage` marks a gap over the Image; its `ch` is never drawn. */
export type Cell = Style & { ch: string; isImage?: boolean }
export type Screen = { width: number; height: number; rows: Cell[][] }

export function screenOf(width: number, height: number): Screen {
  return {
    width,
    height,
    rows: Array.from({ length: height }, () => Array.from({ length: width }, (): Cell => ({ ch: ' ' }))),
  }
}

export function putCell(screen: Screen, x: number, y: number, cell: Cell) {
  const row = screen.rows[y]

  if (row && x >= 0 && x < screen.width) {
    row[x] = cell
  }
}

/** Writes text from (x, y), one cell per character, clipped to the screen. */
export function put(screen: Screen, x: number, y: number, text: string, style: Style = {}) {
  let at = x

  for (const ch of text) {
    putCell(screen, at, y, { ch, ...style })
    at += 1
  }
}

export function fill(screen: Screen, x: number, y: number, width: number, height: number, style: Style, ch = ' ') {
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) putCell(screen, col, row, { ch, ...style })
  }
}

/** Rewrites the cells of a rectangle through `restyle`, keeping what is drawn there. */
export function restyle(screen: Screen, x: number, y: number, width: number, height: number, restyleCell: (cell: Cell) => Cell) {
  for (let row = Math.max(0, y); row < Math.min(screen.height, y + height); row++) {
    for (let col = Math.max(0, x); col < Math.min(screen.width, x + width); col++) {
      const cells = screen.rows[row]
      const cell = cells?.[col]

      if (cells && cell) cells[col] = restyleCell(cell)
    }
  }
}

/** A rounded frame filled with `bg`, its border in `border`. */
export function frame(screen: Screen, x: number, y: number, width: number, height: number, look: { border: string; bg?: string }) {
  const edge: Style = { fg: look.border, bg: look.bg }

  fill(screen, x, y, width, height, { bg: look.bg })
  put(screen, x, y, `╭${'─'.repeat(width - 2)}╮`, edge)
  put(screen, x, y + height - 1, `╰${'─'.repeat(width - 2)}╯`, edge)

  for (let row = y + 1; row < y + height - 1; row++) {
    put(screen, x, row, '│', edge)
    put(screen, x + width - 1, row, '│', edge)
  }
}

/** Writes text centred in a span of `width` cells starting at x. */
export function center(screen: Screen, x: number, y: number, width: number, text: string, style: Style = {}) {
  const length = [...text].length

  put(screen, x + Math.max(0, Math.floor((width - length) / 2)), y, text, style)
}

const styleKeyOf = (cell: Cell) =>
  cell.isImage ? 'image' : `${cell.fg ?? ''}|${cell.bg ?? ''}|${cell.bold ? 1 : 0}|${cell.dim ? 1 : 0}`

/**
 * The grid as one Text per row, each a run of Texts sharing a style. A row
 * crossing the Image is a row Box instead, its gaps empty Boxes that draw
 * nothing, so the picture beneath them stays.
 */
export function elementsOf({ Box, Text }: Pick<ClientElements, 'Box' | 'Text'>, screen: Screen): RenderElement[] {
  return screen.rows.map(cells => {
    const runs: { style: Cell; text: string; width: number }[] = []

    for (const cell of cells) {
      const last = runs[runs.length - 1]

      if (last && styleKeyOf(last.style) === styleKeyOf(cell)) {
        last.text += cell.ch
        last.width += 1
      } else {
        runs.push({ style: cell, text: cell.ch, width: 1 })
      }
    }

    const textOf = ({ style, text }: { style: Cell; text: string }) => (
      <Text color={style.fg} backgroundColor={style.bg} bold={style.bold} dimColor={style.dim}>
        {text}
      </Text>
    )

    if (!runs.some(run => run.style.isImage)) {
      return <Text>{runs.map(textOf)}</Text>
    }

    return (
      <Box flexDirection="row" height={1}>
        {runs.map(run => (run.style.isImage ? <Box width={run.width} height={1} flexShrink={0} /> : <Text wrap="truncate">{textOf(run)}</Text>))}
      </Box>
    )
  })
}
