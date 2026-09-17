import type * as Game from '../game.ts'
import { center, fill, frame, put, type Screen, type Style } from './screen.tsx'
import * as Theme from './theme.ts'

// The scoreboard beside the board: a status pill and level badge, three tiles with the tallies in
// block digits, a stacked win-rate bar, the streak, and the last ten results.

export type Result = 'won' | 'lost' | 'draw'

export type Status =
  | { kind: 'your-move' }
  | { kind: 'thinking'; frame: number }
  | { kind: 'won' }
  | { kind: 'lost' }
  | { kind: 'draw' }

export type ScoreboardModel = {
  status: Status
  difficulty: Game.Difficulty
  score: Game.Score
  /** Oldest first. */
  history: Result[]
  isClaudeDone: boolean
}

/** Columns the full scoreboard takes. */
export const WIDTH = 38
/** Rows the full and the compact scoreboard take. */
export const HEIGHT = 13
export const COMPACT_HEIGHT = 5

/** Three-row block digits, three cells wide. */
const DIGITS: Record<string, readonly [string, string, string]> = {
  '0': ['█▀█', '█ █', '▀▀▀'],
  '1': ['▀█ ', ' █ ', '▀▀▀'],
  '2': ['▀▀█', '█▀▀', '▀▀▀'],
  '3': ['▀▀█', ' ▀█', '▀▀▀'],
  '4': ['█ █', '▀▀█', '  ▀'],
  '5': ['█▀▀', '▀▀█', '▀▀▀'],
  '6': ['█▀▀', '█▀█', '▀▀▀'],
  '7': ['▀▀█', '  █', '  ▀'],
  '8': ['█▀█', '█▀█', '▀▀▀'],
  '9': ['█▀█', '▀▀█', '▀▀▀'],
}

function statusPillOf(status: Status): { text: string; fg: string; bg: string } {
  switch (status.kind) {
    case 'your-move':
      return { text: ' ✕  YOUR MOVE ', fg: Theme.X, bg: Theme.PILL_X_BG }
    case 'thinking':
      return { text: ` ◯  CLAUDE IS THINKING${'.'.repeat((Math.floor(status.frame / 3) % 3) + 1).padEnd(3)} `, fg: Theme.O, bg: Theme.PILL_O_BG }
    case 'won':
      return { text: ' ★  YOU WIN ', fg: Theme.WIN, bg: Theme.PILL_WIN_BG }
    case 'lost':
      return { text: ' ◯  CLAUDE WINS ', fg: Theme.O, bg: Theme.PILL_O_BG }
    case 'draw':
      return { text: ' =  DRAW ', fg: Theme.DRAW, bg: Theme.PILL_DRAW_BG }
  }
}

/** The pill on the left and the level badge flush right, on one row. */
function headerRow(screen: Screen, x: number, y: number, width: number, model: ScoreboardModel) {
  const pill = statusPillOf(model.status)
  const badge = ` ${model.difficulty.toUpperCase()} `

  put(screen, x, y, pill.text, { fg: pill.fg, bg: pill.bg, bold: true })
  put(screen, x + width - badge.length - 6, y, 'LEVEL ', { fg: Theme.TEXT_MUTED })
  put(screen, x + width - badge.length, y, badge, { fg: Theme.TEXT_BRIGHT, bg: Theme.BADGE_BG, bold: true })
}

function tile(screen: Screen, x: number, y: number, look: { label: string; count: number; fg: string; border: string }) {
  const width = 12

  frame(screen, x, y, width, 6, { border: look.border })
  center(screen, x, y + 1, width, look.label, { fg: look.fg, bold: true })

  const digits = String(look.count)

  if (digits.length > 2) {
    center(screen, x, y + 3, width, digits, { fg: look.fg, bold: true })
    return
  }

  for (let row = 0; row < 3; row++) {
    const line = [...digits].map(d => DIGITS[d]?.[row] ?? '   ').join(' ')
    center(screen, x, y + 2 + row, width, line, { fg: look.fg })
  }
}

/** Wins, draws and losses as one bar of `width` cells, and the share won. */
function rateBar(screen: Screen, x: number, y: number, width: number, score: Game.Score) {
  const games = score.wins + score.draws + score.losses

  if (games === 0) {
    put(screen, x, y, '░'.repeat(width), { fg: Theme.TRACK })
    put(screen, x + width + 1, y, 'no games yet', { fg: Theme.TEXT_MUTED })
    return
  }

  const winCells = Math.round((score.wins / games) * width)
  const drawCells = Math.min(width - winCells, Math.round((score.draws / games) * width))
  const lossCells = width - winCells - drawCells

  put(screen, x, y, '█'.repeat(winCells), { fg: Theme.X })
  put(screen, x + winCells, y, '█'.repeat(drawCells), { fg: Theme.DRAW })
  put(screen, x + winCells + drawCells, y, '█'.repeat(lossCells), { fg: Theme.O })

  const rate = `${Math.round((score.wins / games) * 100)}%`
  put(screen, x + width + 1, y, rate, { fg: Theme.TEXT_BRIGHT, bold: true })
  put(screen, x + width + 1 + rate.length, y, ' won', { fg: Theme.TEXT_MUTED })
}

/** The run of equal results at the end of the history, when it is two or more. */
function streakOf(history: Result[]): { result: Result; count: number } | null {
  const last = history[history.length - 1]
  let count = 0

  for (let k = history.length - 1; k >= 0 && history[k] === last; k--) count += 1

  return last && count >= 2 ? { result: last, count } : null
}

const resultStyle = (result: Result): Style =>
  ({ fg: result === 'won' ? Theme.X : result === 'lost' ? Theme.O : Theme.DRAW })

export function drawScoreboard(screen: Screen, x: number, y: number, model: ScoreboardModel) {
  const { wins, losses, draws } = model.score
  const games = wins + losses + draws

  headerRow(screen, x, y, WIDTH, model)

  if (model.isClaudeDone) {
    put(screen, x, y + 1, '● Claude finished its turn', { fg: Theme.WARN })
  }

  tile(screen, x, y + 2, { label: 'YOU', count: wins, fg: Theme.X, border: Theme.X_TILE })
  tile(screen, x + 13, y + 2, { label: 'DRAW', count: draws, fg: Theme.DRAW, border: Theme.DRAW_TILE })
  tile(screen, x + 26, y + 2, { label: 'CLAUDE', count: losses, fg: Theme.O, border: Theme.O_TILE })

  rateBar(screen, x, y + 9, 26, model.score)

  const streak = streakOf(model.history)
  put(screen, x, y + 10, `${games} ${games === 1 ? 'game' : 'games'}`, { fg: Theme.TEXT })

  if (streak) {
    const what = streak.result === 'won' ? 'wins' : streak.result === 'lost' ? 'Claude wins' : 'draws'
    const glyph = streak.result === 'won' ? '▲' : streak.result === 'lost' ? '▼' : '='
    const label = `${glyph} ${streak.count} ${what} in a row`

    put(screen, x + 10, y + 10, label, { ...resultStyle(streak.result), bold: true })
  }

  const recent = model.history.slice(-10)
  put(screen, x, y + 11, 'recent', { fg: Theme.TEXT_MUTED })

  for (let k = 0; k < 10; k++) {
    const result = recent[k - (10 - recent.length)]
    put(screen, x + 10 + k * 2, y + 11, result ? '●' : '○', result ? resultStyle(result) : { fg: Theme.TEXT_MUTED, dim: true })
  }

  put(screen, x, y + 12, 'm menu · 1-9 play · r new game', { fg: Theme.TEXT_MUTED })
}

/** Five rows for a short band: header, tallies, bar, hint. */
export function drawCompactScoreboard(screen: Screen, x: number, y: number, model: ScoreboardModel) {
  headerRow(screen, x, y, WIDTH, model)

  const tally = (at: number, label: string, count: number, fg: string, bg: string) => {
    const text = ` ${label} ${count} `
    put(screen, at, y + 2, text, { fg, bg, bold: true })
    return at + text.length + 1
  }

  let at = x
  at = tally(at, 'YOU', model.score.wins, Theme.X, Theme.PILL_X_BG)
  at = tally(at, 'DRAW', model.score.draws, Theme.DRAW, Theme.PILL_DRAW_BG)
  tally(at, 'CLAUDE', model.score.losses, Theme.O, Theme.PILL_O_BG)

  fill(screen, x, y + 3, WIDTH, 1, {})
  rateBar(screen, x, y + 3, 20, model.score)
  put(screen, x, y + 4, model.isClaudeDone ? '● Claude finished its turn' : 'm menu · 1-9 play · r new game', {
    fg: model.isClaudeDone ? Theme.WARN : Theme.TEXT_MUTED,
  })
}
