/* @jsx h */
import type { ClientElements, ClientSurface } from 'claude-code'

import * as Game from './game.ts'

// A surface module: it runs on the drawing thread with its own state, frame clock, mouse, and
// keys (once a click gives it focus; Esc gives them back to the prompt). The hooks module hands it
// props and hears about finished games through `surface.post`.
//
// Never name a local `h` here: every JSX tag compiles to a call of `h`.

export type Props = {
  /** Bumped by the band's `new game` button: a new value starts a fresh board. */
  round: number
  difficulty: Game.Difficulty
  score: Game.Score
  /** Bumped each time Claude finishes a turn, so the board can say so. */
  done: number
  /** One text row per cell instead of three, for a short band. */
  compact: boolean
}

type State = {
  round: number
  difficulty: Game.Difficulty
  seenDone: number
  board: Game.Board
  cursor: number
  /** Ticks left before Claude answers; null while it is the person's move. */
  thinking: number | null
  frame: number
  isClaudeDone: boolean
  compact: boolean
}

export type Post = { kind: 'result'; outcome: 'won' | 'lost' | 'draw' } | { kind: 'toggle-difficulty' }

const TICK_MS = 120
const THINK_TICKS = 4

const X_COLOR = 'cyanBright'
const O_COLOR = '#d97757'
const WIN_BG = '#1e3a2a'
const CURSOR_BG = '#3a3a3a'

type Layout = { w: number; h: number; x: readonly string[]; o: readonly string[] }

const FULL: Layout = {
  w: 9,
  h: 3,
  x: ['  ╲   ╱  ', '    ╳    ', '  ╱   ╲  '],
  o: ['  ╭───╮  ', '  │   │  ', '  ╰───╯  '],
}

const COMPACT: Layout = { w: 5, h: 1, x: ['  ✕  '], o: ['  ◯  '] }

type Style = { color?: string; bg?: string; bold?: boolean; dim?: boolean }
type Run = { text: string } & Style

const CURSOR_KEYS: Record<string, readonly [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
}

/** A new board, keeping what the props last said (round, difficulty, turns seen). */
const fresh = (from: Pick<State, 'round' | 'difficulty' | 'seenDone' | 'compact'>, cursor = 4): State => ({
  round: from.round,
  difficulty: from.difficulty,
  seenDone: from.seenDone,
  compact: from.compact,
  board: Game.EMPTY_BOARD,
  cursor,
  thinking: null,
  frame: 0,
  isClaudeDone: false,
})

function resultOf(outcome: Game.Outcome): 'won' | 'lost' | 'draw' | null {
  switch (outcome.kind) {
    case 'playing':
      return null
    case 'draw':
      return 'draw'
    case 'won':
      return outcome.by === Game.PERSON ? 'won' : 'lost'
  }
}

export default function Board(props: Props, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  const layout = props.compact ? COMPACT : FULL

  const update = (next: State) => {
    const before = surface.state && resultOf(Game.outcomeOf(surface.state.board))
    const after = resultOf(Game.outcomeOf(next.board))

    if (after && !before) {
      surface.post({ kind: 'result', outcome: after })
    }

    surface.setState(next)
  }

  const play = (index: number) => {
    const s = surface.state

    if (!s || s.thinking !== null) {
      return
    }

    if (Game.outcomeOf(s.board).kind !== 'playing') {
      update(fresh(s, index))
      return
    }

    if (s.board[index] !== null) {
      return
    }

    const board = Game.played(s.board, index, Game.PERSON)
    const isOver = Game.outcomeOf(board).kind !== 'playing'

    update({ ...s, board, cursor: index, isClaudeDone: false, thinking: isOver ? null : THINK_TICKS })
  }

  if (surface.state === undefined) {
    surface.setState(fresh({ round: props.round, difficulty: props.difficulty, seenDone: props.done, compact: props.compact }))

    surface.every(TICK_MS, () => {
      const s = surface.state

      if (!s || s.thinking === null) {
        return
      }

      if (s.thinking > 0) {
        surface.setState({ ...s, thinking: s.thinking - 1, frame: s.frame + 1 })
        return
      }

      const move = Game.claudeMoveOf(s.board, s.difficulty)
      const board = move === null ? s.board : Game.played(s.board, move, Game.CLAUDE)

      update({ ...s, board, thinking: null })
    })

    surface.onPointer(event => {
      const s = surface.state
      const layout = s?.compact ? COMPACT : FULL
      const col = Math.floor(event.x / (layout.w + 1))
      const row = Math.floor(event.y / (layout.h + 1))
      const isOnBorder = event.x % (layout.w + 1) === 0 || event.y % (layout.h + 1) === 0
      const isInside = col >= 0 && col < 3 && row >= 0 && row < 3 && !isOnBorder

      if (!s || !isInside) {
        return
      }

      const index = row * 3 + col

      if (event.type === 'down' && event.button === 'left') {
        play(index)
      } else if (event.type === 'move' && index !== s.cursor) {
        surface.setState({ ...s, cursor: index })
      }
    })

    surface.onKey(({ key }) => {
      const s = surface.state

      if (!s) {
        return
      }

      const k = key === 'space' ? ' ' : key.toLowerCase()

      if (Object.hasOwn(CURSOR_KEYS, k)) {
        const [dx, dy] = CURSOR_KEYS[k] ?? [0, 0]
        const col = Math.max(0, Math.min(2, (s.cursor % 3) + dx))
        const row = Math.max(0, Math.min(2, Math.floor(s.cursor / 3) + dy))

        surface.setState({ ...s, cursor: row * 3 + col, isClaudeDone: false })
      } else if (k === ' ' || k === 'return') {
        play(s.cursor)
      } else if (/^[1-9]$/.test(k)) {
        play(Number(k) - 1)
      } else if (k === 'r' || k === 'n') {
        update(fresh(s, s.cursor))
      } else if (k === 'x') {
        surface.post({ kind: 'toggle-difficulty' })
      }
    })
  }

  // The listeners above only read surface.state, so new props are folded into it here:
  // a new round starts a fresh board, a new difficulty applies to Claude's next move.
  let s = surface.state ?? fresh({ round: props.round, difficulty: props.difficulty, seenDone: props.done, compact: props.compact })

  if (props.round !== s.round) {
    s = fresh({ round: props.round, difficulty: props.difficulty, seenDone: props.done, compact: props.compact }, s.cursor)
    surface.setState(s)
  } else if (props.difficulty !== s.difficulty || props.done !== s.seenDone || props.compact !== s.compact) {
    s = {
      ...s,
      difficulty: props.difficulty,
      seenDone: props.done,
      compact: props.compact,
      isClaudeDone: s.isClaudeDone || props.done !== s.seenDone,
    }
    surface.setState(s)
  }

  const outcome = Game.outcomeOf(s.board)
  const winLine: readonly number[] = outcome.kind === 'won' ? outcome.line : []
  const isPlaying = outcome.kind === 'playing'

  const borderColor =
    outcome.kind === 'won' ? (outcome.by === Game.PERSON ? 'greenBright' : O_COLOR)
    : outcome.kind === 'draw' ? 'yellow'
    : 'gray'

  const lines = boardLines(layout, s.board, {
    cursor: isPlaying && s.thinking === null ? s.cursor : null,
    winLine,
    isOver: !isPlaying,
    borderColor,
  })

  return (
    <Box flexDirection="row" columnGap={3}>
      <Box flexDirection="column">
        {lines.map(line => runsView(Text, line))}
      </Box>
      {sidePanel(Text, Box, props, s, outcome)}
    </Box>
  )
}

function boardLines(
  layout: Layout,
  board: Game.Board,
  look: { cursor: number | null; winLine: readonly number[]; isOver: boolean; borderColor: string },
): Run[][] {
  const bar = '─'.repeat(layout.w)
  const edge = (l: string, m: string, r: string): Run[] => [
    { text: `${l}${bar}${m}${bar}${m}${bar}${r}`, color: look.borderColor },
  ]

  const cellRun = (index: number, sub: number): Run => {
    const cell = board[index] ?? null
    const isWin = look.winLine.includes(index)
    const bg = isWin ? WIN_BG : index === look.cursor ? CURSOR_BG : undefined
    const dim = look.isOver && !isWin

    if (cell === 'X') {
      return { text: layout.x[sub] ?? '', color: X_COLOR, bold: true, bg, dim }
    }

    if (cell === 'O') {
      return { text: layout.o[sub] ?? '', color: O_COLOR, bold: true, bg, dim }
    }

    const isMiddle = sub === Math.floor(layout.h / 2)
    const pad = Math.floor(layout.w / 2)
    const text = isMiddle
      ? `${' '.repeat(pad)}${index + 1}${' '.repeat(layout.w - pad - 1)}`
      : ' '.repeat(layout.w)

    return { text, color: 'gray', dim: true, bg }
  }

  const lines: Run[][] = [edge('╭', '┬', '╮')]

  for (let row = 0; row < 3; row++) {
    for (let sub = 0; sub < layout.h; sub++) {
      const wall: Run = { text: '│', color: look.borderColor }

      lines.push([wall, cellRun(row * 3, sub), wall, cellRun(row * 3 + 1, sub), wall, cellRun(row * 3 + 2, sub), wall])
    }

    lines.push(row < 2 ? edge('├', '┼', '┤') : edge('╰', '┴', '╯'))
  }

  return lines
}

function runsView(Text: ClientElements['Text'], runs: Run[]) {
  return (
    <Text>
      {runs.map(run => (
        <Text
          color={run.color}
          backgroundColor={run.bg}
          bold={run.bold}
          dimColor={run.dim}
        >
          {run.text}
        </Text>
      ))}
    </Text>
  )
}

function sidePanel(
  Text: ClientElements['Text'],
  Box: ClientElements['Box'],
  props: Props,
  s: State,
  outcome: Game.Outcome,
) {
  const dots = '.'.repeat((s.frame % 3) + 1).padEnd(3)
  const status =
    s.thinking !== null ? <Text color={O_COLOR}>{`◯ Claude is thinking${dots}`}</Text>
    : outcome.kind === 'won' && outcome.by === Game.PERSON ? <Text color="greenBright" bold>★ You win!</Text>
    : outcome.kind === 'won' ? <Text color={O_COLOR} bold>◯ Claude wins</Text>
    : outcome.kind === 'draw' ? <Text color="yellow" bold>= It's a draw</Text>
    : <Text color={X_COLOR}>✕ Your move</Text>

  const { wins, losses, draws } = props.score
  const isOver = outcome.kind !== 'playing'

  const scoreLine = (
    <Text>
      <Text dimColor>{'won '}</Text>
      <Text color="greenBright" bold>{String(wins)}</Text>
      <Text dimColor>{'  lost '}</Text>
      <Text color={O_COLOR} bold>{String(losses)}</Text>
      <Text dimColor>{'  drawn '}</Text>
      <Text color="yellow" bold>{String(draws)}</Text>
      <Text dimColor>{'  · level '}</Text>
      <Text bold>{props.difficulty}</Text>
    </Text>
  )

  if (props.compact) {
    // seven rows, as tall as the compact board
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>TIC · TAC · TOE  </Text>
          <Text color={X_COLOR} bold>✕ you</Text>
          <Text dimColor>{' vs '}</Text>
          <Text color={O_COLOR} bold>◯ Claude</Text>
        </Text>
        {status}
        {s.isClaudeDone ? <Text color="yellow">● Claude finished its turn</Text> : <Text> </Text>}
        {scoreLine}
        <Text dimColor wrap="truncate-end">
          {isOver ? 'click, enter or r: play again' : 'click, then 1-9 or arrows + enter'}
        </Text>
        <Text dimColor wrap="truncate-end">x level · r restart · esc prompt</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>TIC · TAC · TOE</Text>
      <Text>
        <Text color={X_COLOR} bold>✕ you</Text>
        <Text dimColor>{'  vs  '}</Text>
        <Text color={O_COLOR} bold>◯ Claude</Text>
      </Text>
      <Text> </Text>
      {status}
      {s.isClaudeDone ? <Text color="yellow">● Claude finished its turn</Text> : <Text> </Text>}
      <Text> </Text>
      {scoreLine}
      <Text> </Text>
      <Text dimColor wrap="truncate-end">
        {isOver ? 'click, enter or r: play again' : 'click the board, then 1-9 or arrows + enter'}
      </Text>
      <Text dimColor wrap="truncate-end">x level · r restart · esc back to prompt</Text>
    </Box>
  )
}
