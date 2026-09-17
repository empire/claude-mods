/* @jsx h */
import type { ClientElements, ClientSurface } from 'claude-code'

import * as Game from './game.ts'
import type { View } from './kitty/paint.ts'
import { idColorOf, placeholderRow } from './kitty/terminal.ts'

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
  /** Set when the board draws as a kitty image: its id and the cell box it fills. */
  kitty: Kitty | null
  /** The last event sequence number the hooks module has applied. */
  ack: number
}

export type Kitty = { id: number; columns: number; rows: number; cellWidth: number; cellHeight: number }

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
  kitty: Kitty | null
  /** The mark scaling in, and how many ticks along. */
  placing: { index: number; step: number } | null
  /** How many ticks the win line has been drawing. */
  winStep: number
  /** What goes to the hooks module, mutated in place so queueing needs no redraw. */
  outbox: Outbox
}

/**
 * Events wait here until the hooks module acknowledges them (props.ack): a
 * later post in the same frame replaces an undelivered one, so every post
 * carries all the events not yet acknowledged, and the latest view.
 */
type Outbox = { key: string; seq: number; events: Event[] }

export type Event =
  | { seq: number; type: 'result'; outcome: 'won' | 'lost' | 'draw' }
  | { seq: number; type: 'toggle-difficulty' }

export type Post = { kind: 'sync'; view: View | null; events: Event[] }

const TICK_MS = 50
const THINK_TICKS = 9
const PLACE_STEPS = 5
const WIN_STEPS = 6

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
type Kept = Pick<State, 'round' | 'difficulty' | 'seenDone' | 'compact' | 'kitty'>

const keptOf = (props: Props): Kept => ({
  round: props.round,
  difficulty: props.difficulty,
  seenDone: props.done,
  compact: props.compact,
  kitty: props.kitty,
})

const fresh = (from: Kept, cursor = 4, outbox: Outbox = { key: '', seq: 0, events: [] }): State => ({
  round: from.round,
  difficulty: from.difficulty,
  seenDone: from.seenDone,
  compact: from.compact,
  kitty: from.kitty,
  placing: null,
  winStep: 0,
  outbox,
  board: Game.EMPTY_BOARD,
  cursor,
  thinking: null,
  frame: 0,
  isClaudeDone: false,
})

type Queued = Event extends infer E ? (E extends Event ? Omit<E, 'seq'> : never) : never

function queue(outbox: Outbox, event: Queued) {
  outbox.seq += 1
  outbox.events.push({ ...event, seq: outbox.seq } as Event)
}

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
      queue(next.outbox, { type: 'result', outcome: after })
    }

    surface.setState(next)
  }

  const play = (index: number) => {
    const s = surface.state

    if (!s || s.thinking !== null) {
      return
    }

    if (Game.outcomeOf(s.board).kind !== 'playing') {
      update(fresh(s, index, s.outbox))
      return
    }

    if (s.board[index] !== null) {
      return
    }

    const board = Game.played(s.board, index, Game.PERSON)
    const isOver = Game.outcomeOf(board).kind !== 'playing'

    update({
      ...s,
      board,
      cursor: index,
      isClaudeDone: false,
      placing: { index, step: 0 },
      thinking: isOver ? null : THINK_TICKS,
    })
  }

  if (surface.state === undefined) {
    surface.setState(fresh(keptOf(props)))

    surface.every(TICK_MS, () => {
      const s = surface.state

      if (!s) {
        return
      }

      const isPlacing = s.placing !== null && s.placing.step < PLACE_STEPS
      const isWinDrawing = !isPlacing && Game.outcomeOf(s.board).kind === 'won' && s.winStep < WIN_STEPS

      if (isPlacing && s.placing) {
        surface.setState({ ...s, placing: { ...s.placing, step: s.placing.step + 1 } })
        return
      }

      if (isWinDrawing) {
        surface.setState({ ...s, winStep: s.winStep + 1 })
        return
      }

      if (s.thinking === null) {
        return
      }

      if (s.thinking > 0) {
        surface.setState({ ...s, thinking: s.thinking - 1, frame: s.frame + 1 })
        return
      }

      const move = Game.claudeMoveOf(s.board, s.difficulty)
      const board = move === null ? s.board : Game.played(s.board, move, Game.CLAUDE)

      update({ ...s, board, thinking: null, placing: move === null ? s.placing : { index: move, step: 0 } })
    })

    surface.onPointer(event => {
      const s = surface.state
      const index = s ? cellAt(s, event.x, event.y) : null

      if (!s || index === null) {
        return
      }

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
        update(fresh(s, s.cursor, s.outbox))
      } else if (k === 'x') {
        queue(s.outbox, { type: 'toggle-difficulty' })
        surface.setState({ ...s })
      }
    })
  }

  // The listeners above only read surface.state, so new props are folded into it here:
  // a new round starts a fresh board, a new difficulty applies to Claude's next move.
  let s = surface.state ?? fresh(keptOf(props))

  const isNewKitty = JSON.stringify(props.kitty) !== JSON.stringify(s.kitty)

  if (props.round !== s.round) {
    s = fresh(keptOf(props), s.cursor, s.outbox)
    surface.setState(s)
  } else if (props.difficulty !== s.difficulty || props.done !== s.seenDone || props.compact !== s.compact || isNewKitty) {
    s = {
      ...s,
      ...keptOf(props),
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

  const cursor = isPlaying && s.thinking === null ? s.cursor : null

  const view: View | null = props.kitty && {
      board: [...s.board],
      cursor,
      placing: s.placing && s.placing.step < PLACE_STEPS ? { index: s.placing.index, t: s.placing.step / PLACE_STEPS } : null,
      win: outcome.kind === 'won' ? { line: [...outcome.line], t: s.winStep / WIN_STEPS } : null,
      isDraw: outcome.kind === 'draw',
    }
  const key = JSON.stringify([view, props.kitty])
  const { outbox } = s

  outbox.events = outbox.events.filter(event => event.seq > props.ack)

  if (key !== outbox.key || outbox.events.length > 0) {
    outbox.key = key
    surface.post({ kind: 'sync', view, events: outbox.events })
  }

  if (props.kitty) {
    const color = idColorOf(props.kitty.id)
    const rows = Array.from({ length: props.kitty.rows }, (_, row) => (
      <Text color={color}>{placeholderRow(row, props.kitty?.columns ?? 1)}</Text>
    ))

    return (
      <Box flexDirection="row" columnGap={3}>
        <Box flexDirection="column">{rows}</Box>
        {sidePanel(Text, Box, props, s, outcome)}
      </Box>
    )
  }

  const lines = boardLines(layout, s.board, {
    cursor,
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

/**
 * The board cell under a pointer position in the region, or null: in kitty
 * mode by the image's pixel geometry, else by the text grid's borders.
 */
function cellAt(s: State, x: number, y: number): number | null {
  let col: number
  let row: number

  if (s.kitty) {
    const { columns, rows, cellWidth, cellHeight } = s.kitty
    const side = Math.min(columns * cellWidth, rows * cellHeight)
    const px = (x + 0.5) * cellWidth - (columns * cellWidth - side) / 2
    const py = (y + 0.5) * cellHeight - (rows * cellHeight - side) / 2

    col = Math.floor((px / side) * 3)
    row = Math.floor((py / side) * 3)
  } else {
    const layout = s.compact ? COMPACT : FULL

    if (x % (layout.w + 1) === 0 || y % (layout.h + 1) === 0) {
      return null
    }

    col = Math.floor(x / (layout.w + 1))
    row = Math.floor(y / (layout.h + 1))
  }

  return col >= 0 && col < 3 && row >= 0 && row < 3 ? row * 3 + col : null
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
  const dots = '.'.repeat((Math.floor(s.frame / 3) % 3) + 1).padEnd(3)
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
