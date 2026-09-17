import * as Game from '../game.ts'
import { put, type Screen, type Style } from './screen.tsx'
import * as Theme from './theme.ts'

// The board in box-drawing characters, for terminals without kitty graphics.

type Layout = { w: number; h: number; x: readonly string[]; o: readonly string[] }

const FULL: Layout = {
  w: 9,
  h: 3,
  x: ['  ╲   ╱  ', '    ╳    ', '  ╱   ╲  '],
  o: ['  ╭───╮  ', '  │   │  ', '  ╰───╯  '],
}

const COMPACT: Layout = { w: 5, h: 1, x: ['  ✕  '], o: ['  ◯  '] }

const layoutOf = (compact: boolean) => (compact ? COMPACT : FULL)

export const sizeOf = (compact: boolean) => {
  const { w, h } = layoutOf(compact)
  return { width: w * 3 + 4, height: h * 3 + 4 }
}

export type Look = { cursor: number | null; winLine: readonly number[]; isOver: boolean; outcome: Game.Outcome }

export function drawTextBoard(screen: Screen, x: number, y: number, board: Game.Board, compact: boolean, look: Look) {
  const layout = layoutOf(compact)
  const border =
    look.outcome.kind === 'won' ? (look.outcome.by === Game.PERSON ? Theme.WIN : Theme.O)
    : look.outcome.kind === 'draw' ? Theme.DRAW
    : Theme.MENU_BORDER
  const edge: Style = { fg: border }
  const bar = '─'.repeat(layout.w)

  let row = y
  const rule = (l: string, m: string, r: string) => {
    put(screen, x, row, `${l}${bar}${m}${bar}${m}${bar}${r}`, edge)
    row += 1
  }

  rule('╭', '┬', '╮')

  for (let line = 0; line < 3; line++) {
    for (let sub = 0; sub < layout.h; sub++) {
      for (let col = 0; col < 3; col++) {
        const index = line * 3 + col
        const cell = board[index] ?? null
        const cx = x + 1 + col * (layout.w + 1)
        const isWin = look.winLine.includes(index)
        const bg = isWin ? '#1e3a2a' : index === look.cursor ? '#3a3a3a' : undefined
        const dim = look.isOver && !isWin

        put(screen, cx - 1, row, '│', edge)

        if (cell === 'X') {
          put(screen, cx, row, layout.x[sub] ?? '', { fg: Theme.X, bg, bold: true, dim })
        } else if (cell === 'O') {
          put(screen, cx, row, layout.o[sub] ?? '', { fg: Theme.O, bg, bold: true, dim })
        } else {
          const pad = Math.floor(layout.w / 2)
          const text = sub === Math.floor(layout.h / 2) ? `${' '.repeat(pad)}${index + 1}${' '.repeat(layout.w - pad - 1)}` : ' '.repeat(layout.w)
          put(screen, cx, row, text, { fg: Theme.TEXT_MUTED, bg, dim: true })
        }
      }

      put(screen, x + 3 * (layout.w + 1), row, '│', edge)
      row += 1
    }

    if (line < 2) rule('├', '┼', '┤')
  }

  rule('╰', '┴', '╯')
}

/** The board cell under a cell of the board's own area, or null over a border. */
export function cellAt(compact: boolean, x: number, y: number): number | null {
  const layout = layoutOf(compact)

  if (x % (layout.w + 1) === 0 || y % (layout.h + 1) === 0) {
    return null
  }

  const col = Math.floor(x / (layout.w + 1))
  const row = Math.floor(y / (layout.h + 1))

  return col >= 0 && col < 3 && row >= 0 && row < 3 ? row * 3 + col : null
}
