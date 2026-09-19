/* @jsx h */
import type { ClientSurface } from 'claude-code'

import * as Game from './game.ts'
import type { View } from './kitty/paint.ts'
import * as Menus from './ui/menus.ts'
import * as Scoreboard from './ui/scoreboard.ts'
import { elementsOf, putCell, screenOf } from './ui/screen.tsx'
import * as TextBoard from './ui/text-board.ts'

// A surface module: it runs on the drawing thread with its own state, frame clock, mouse, and
// keys (once a click gives it focus; Esc gives them back to the prompt). It draws the whole band
// body as one cell grid (the menu bar, the board, the scoreboard, and any open menu over them) and
// tells the hooks module what to keep or do through `surface.post`. The image board is the one
// thing it cannot draw (a surface module has no `Image`): it leaves the board's cells as a gap,
// and the hooks module draws the picture beneath them from the frames this module posts.
//
// Never name a local `h` here: every JSX tag compiles to a call of `h`.

export type Props = {
  difficulty: Game.Difficulty
  score: Game.Score
  /** Finished games, oldest first. */
  history: Scoreboard.Result[]
  /** Bumped each time Claude finishes a turn, so the board can say so. */
  done: number
  /** A short band: one text row per board cell, and the compact scoreboard. */
  compact: boolean
  /** Set when the board draws as an image: the cell box it fills and a cell's size in pixels. */
  kitty: Kitty | null
  /** The last event sequence number the hooks module has applied. */
  ack: number
  /** Cells across the band. */
  columns: number
}

export type Kitty = { columns: number; rows: number; cellWidth: number; cellHeight: number }

type MenuState = {
  open: Menus.MenuName | null
  hover: number | null
  hoverTitle: Menus.MenuName | null
  isConfirmingReset: boolean
}

type State = {
  difficulty: Game.Difficulty
  seenDone: number
  compact: boolean
  kitty: Kitty | null
  columns: number
  board: Game.Board
  cursor: number
  /** Ticks left before Claude answers; null while it is the person's move. */
  thinking: number | null
  frame: number
  isClaudeDone: boolean
  /** The mark scaling in, and how many ticks along. */
  placing: { index: number; step: number } | null
  /** How many ticks the win line has been drawing. */
  winStep: number
  menu: MenuState
  /** The score as the props last said, for the reset confirmation. */
  score: Game.Score
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
  | { seq: number; type: 'result'; outcome: Scoreboard.Result }
  | { seq: number; type: 'set-difficulty'; difficulty: Game.Difficulty }
  | { seq: number; type: 'reset-score' }
  | { seq: number; type: 'set-image-board'; isImage: boolean }
  | { seq: number; type: 'close' }

export type Post = { kind: 'sync'; view: View | null; events: Event[] }

type Queued = Event extends infer E ? (E extends Event ? Omit<E, 'seq'> : never) : never

const TICK_MS = 50
const THINK_TICKS = 9
const PLACE_STEPS = 5
const WIN_STEPS = 6

/** The board's top row: under the menu bar and a blank row. */
const BOARD_TOP = 2
/** The gap between the board and the scoreboard. */
const GUTTER = 3

const CLOSED_MENU: MenuState = { open: null, hover: null, hoverTitle: null, isConfirmingReset: false }

const CURSOR_KEYS: Record<string, readonly [number, number]> = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
}

type Kept = Pick<State, 'difficulty' | 'seenDone' | 'compact' | 'kitty' | 'columns' | 'score'>

const keptOf = (props: Props): Kept => ({
  difficulty: props.difficulty,
  seenDone: props.done,
  compact: props.compact,
  kitty: props.kitty,
  columns: props.columns,
  score: props.score,
})

/** A new board, keeping what the props last said and what is still to send. */
const fresh = (from: Kept, cursor = 4, outbox: Outbox = { key: '', seq: 0, events: [] }): State => ({
  difficulty: from.difficulty,
  seenDone: from.seenDone,
  compact: from.compact,
  kitty: from.kitty,
  columns: from.columns,
  score: from.score,
  board: Game.EMPTY_BOARD,
  cursor,
  thinking: null,
  frame: 0,
  isClaudeDone: false,
  placing: null,
  winStep: 0,
  menu: CLOSED_MENU,
  outbox,
})

function queue(outbox: Outbox, event: Queued) {
  outbox.seq += 1
  outbox.events.push({ ...event, seq: outbox.seq } as Event)
}

function resultOf(outcome: Game.Outcome): Scoreboard.Result | null {
  switch (outcome.kind) {
    case 'playing':
      return null
    case 'draw':
      return 'draw'
    case 'won':
      return outcome.by === Game.PERSON ? 'won' : 'lost'
  }
}

const boardSizeOf = (s: Pick<State, 'kitty' | 'compact'>) =>
  s.kitty ? { width: s.kitty.columns, height: s.kitty.rows } : TextBoard.sizeOf(s.compact)

const menuContextOf = (s: State): Menus.MenuContext => ({
  difficulty: s.difficulty,
  isImageBoard: s.kitty !== null,
  isConfirmingReset: s.menu.isConfirmingReset,
  score: s.score,
})

const dropdownOf = (s: State, name: Menus.MenuName) => Menus.dropdownOf(name, menuContextOf(s), s.columns)

/** The board cell under a cell of the board's own area, by the image's pixel geometry or the grid. */
function cellAt(s: State, x: number, y: number): number | null {
  if (!s.kitty) {
    return TextBoard.cellAt(s.compact, x, y)
  }

  const { columns, rows, cellWidth, cellHeight } = s.kitty
  const side = Math.min(columns * cellWidth, rows * cellHeight)
  const px = (x + 0.5) * cellWidth - (columns * cellWidth - side) / 2
  const py = (y + 0.5) * cellHeight - (rows * cellHeight - side) / 2
  const col = Math.floor((px / side) * 3)
  const row = Math.floor((py / side) * 3)

  return col >= 0 && col < 3 && row >= 0 && row < 3 ? row * 3 + col : null
}

/** The open dropdown's box, which the menu draws over the board and its shadow. */
function overlayOf(s: State): string | null {
  if (!s.menu.open) {
    return null
  }

  const { x, y, width, height } = dropdownOf(s, s.menu.open)

  return `${x},${y},${width},${height}`
}

const titleAt = (x: number) => Menus.titleSpans().find(span => x >= span.x && x < span.x + span.width)?.name ?? null

export default function Board(props: Props, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements

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

  /** Opens a menu (or closes with null), the first action lit. */
  const openMenu = (s: State, name: Menus.MenuName | null) => {
    const menu = { ...CLOSED_MENU, open: name }
    const dropdown = name && dropdownOf({ ...s, menu }, name)

    surface.setState({ ...s, menu: { ...menu, hover: dropdown ? (Menus.selectableOf(dropdown)[0] ?? null) : null } })
  }

  const activate = (s: State, id: Menus.ActionId) => {
    switch (id) {
      case 'new-game':
        update(fresh(s, s.cursor, s.outbox))
        return
      case 'ask-reset': {
        // The confirmation lights Cancel, so a stray Enter does not wipe the score.
        const confirming = { ...s, menu: { ...s.menu, isConfirmingReset: true } }
        const actions = Menus.selectableOf(dropdownOf(confirming, 'game'))
        surface.setState({ ...confirming, menu: { ...confirming.menu, hover: actions[actions.length - 1] ?? null } })
        return
      }
      case 'cancel-reset':
        openMenu(s, 'game')
        return
      case 'confirm-reset':
        queue(s.outbox, { type: 'reset-score' })
        break
      case 'close':
        queue(s.outbox, { type: 'close' })
        break
      case 'level-hard':
      case 'level-easy':
        queue(s.outbox, { type: 'set-difficulty', difficulty: id === 'level-hard' ? 'hard' : 'easy' })
        break
      case 'view-image':
      case 'view-text':
        queue(s.outbox, { type: 'set-image-board', isImage: id === 'view-image' })
        break
    }

    surface.setState({ ...s, menu: CLOSED_MENU })
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

      if (!s) {
        return
      }

      const isClick = event.type === 'down' && event.button === 'left'
      const isMove = event.type === 'move'

      // Over the bar: titles open, switch or close menus; the close control closes the board.
      if (event.y === 0) {
        const title = titleAt(event.x)
        const close = Menus.closeSpanOf(s.columns)

        if (isClick && title) {
          openMenu(s, s.menu.open === title ? null : title)
        } else if (isClick && event.x >= close.x && event.x < close.x + close.width) {
          activate(s, 'close')
        } else if (isMove && title && s.menu.open && s.menu.open !== title) {
          openMenu(s, title)
        } else if (isMove && title !== s.menu.hoverTitle) {
          surface.setState({ ...s, menu: { ...s.menu, hoverTitle: title } })
        }

        return
      }

      // With a menu open, the pointer belongs to it: a click outside only closes it.
      if (s.menu.open) {
        const dropdown = dropdownOf(s, s.menu.open)
        const index = Menus.itemAt(dropdown, event.x, event.y)
        const item = index === null ? null : dropdown.items[index]

        if (isClick && item?.kind === 'action') {
          activate(s, item.id)
        } else if (isClick && !Menus.isInsideDropdown(dropdown, event.x, event.y)) {
          surface.setState({ ...s, menu: CLOSED_MENU })
        } else if (isMove && index !== null && index !== s.menu.hover) {
          surface.setState({ ...s, menu: { ...s.menu, hover: index, hoverTitle: null } })
        }

        return
      }

      const size = boardSizeOf(s)
      const by = event.y - BOARD_TOP
      const index = event.x < size.width && by >= 0 && by < size.height ? cellAt(s, event.x, by) : null

      if (isMove && s.menu.hoverTitle) {
        surface.setState({ ...s, menu: { ...s.menu, hoverTitle: null }, cursor: index ?? s.cursor })
      } else if (isClick && index !== null) {
        play(index)
      } else if (isMove && index !== null && index !== s.cursor) {
        surface.setState({ ...s, cursor: index })
      }
    })

    surface.onKey(({ key }) => {
      const s = surface.state

      if (!s) {
        return
      }

      const k = key === 'space' ? ' ' : key.toLowerCase()

      if (s.menu.open) {
        const dropdown = dropdownOf(s, s.menu.open)
        const actions = Menus.selectableOf(dropdown)
        const at = s.menu.hover === null ? -1 : actions.indexOf(s.menu.hover)
        const names = Menus.titleSpans().map(span => span.name)
        const menuAt = names.indexOf(s.menu.open)

        if (k === 'up' || k === 'down') {
          const step = k === 'down' ? 1 : actions.length - 1
          surface.setState({ ...s, menu: { ...s.menu, hover: actions[(at + step + actions.length) % actions.length] ?? null } })
        } else if (k === 'left' || k === 'right') {
          openMenu(s, names[(menuAt + (k === 'right' ? 1 : names.length - 1)) % names.length] ?? 'game')
        } else if (k === 'return' || k === ' ') {
          const item = s.menu.hover === null ? null : dropdown.items[s.menu.hover]
          if (item?.kind === 'action') activate(s, item.id)
        } else if (k === 'escape' || k === 'm') {
          if (s.menu.isConfirmingReset) openMenu(s, 'game')
          else surface.setState({ ...s, menu: CLOSED_MENU })
        }

        return
      }

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
        queue(s.outbox, { type: 'set-difficulty', difficulty: s.difficulty === 'hard' ? 'easy' : 'hard' })
        surface.setState({ ...s })
      } else if (k === 'm') {
        openMenu(s, 'game')
      }
    })
  }

  // The listeners above only read surface.state, so new props are folded into it here.
  let s = surface.state ?? fresh(keptOf(props))
  const kept = keptOf(props)

  const isChanged =
    kept.difficulty !== s.difficulty ||
    kept.seenDone !== s.seenDone ||
    kept.compact !== s.compact ||
    kept.columns !== s.columns ||
    JSON.stringify(kept.score) !== JSON.stringify(s.score) ||
    JSON.stringify(kept.kitty) !== JSON.stringify(s.kitty)

  if (isChanged) {
    s = { ...s, ...kept, isClaudeDone: s.isClaudeDone || kept.seenDone !== s.seenDone }
    surface.setState(s)
  }

  const outcome = Game.outcomeOf(s.board)
  const isPlaying = outcome.kind === 'playing'
  const cursor = isPlaying && s.thinking === null && !s.menu.open ? s.cursor : null

  const view: View | null = props.kitty && {
    board: [...s.board],
    cursor,
    placing: s.placing && s.placing.step < PLACE_STEPS ? { index: s.placing.index, t: s.placing.step / PLACE_STEPS } : null,
    win: outcome.kind === 'won' ? { line: [...outcome.line], t: s.winStep / WIN_STEPS } : null,
    isDraw: outcome.kind === 'draw',
    isDimmed: s.menu.open !== null,
    overlay: overlayOf(s),
  }

  const key = JSON.stringify([view, props.kitty])
  const { outbox } = s

  outbox.events = outbox.events.filter(event => event.seq > props.ack)

  if (key !== outbox.key || outbox.events.length > 0) {
    outbox.key = key
    surface.post({ kind: 'sync', view, events: outbox.events })
  }

  // Compose the band body: bar, board, scoreboard, then any open menu over them.
  const size = boardSizeOf(s)
  const panelHeight = props.compact ? Scoreboard.COMPACT_HEIGHT : Scoreboard.HEIGHT
  const dropdown = s.menu.open ? dropdownOf(s, s.menu.open) : null
  const height = Math.max(BOARD_TOP + Math.max(size.height, panelHeight), dropdown ? dropdown.y + dropdown.height + 1 : 0)
  const screen = screenOf(Math.max(40, props.columns), height)

  Menus.drawBar(screen, s.menu.open, s.menu.hoverTitle)

  if (props.kitty) {
    // Left undrawn: the hooks module draws the Image under this region, at the same place.
    for (let row = 0; row < props.kitty.rows; row++) {
      for (let col = 0; col < props.kitty.columns; col++) {
        putCell(screen, col, BOARD_TOP + row, { ch: ' ', isImage: true })
      }
    }
  } else {
    TextBoard.drawTextBoard(screen, 0, BOARD_TOP, s.board, props.compact, {
      cursor,
      winLine: outcome.kind === 'won' ? outcome.line : [],
      isOver: !isPlaying,
      outcome,
    })
  }

  const status: Scoreboard.Status =
    s.thinking !== null ? { kind: 'thinking', frame: s.frame }
    : outcome.kind === 'won' ? { kind: outcome.by === Game.PERSON ? 'won' : 'lost' }
    : outcome.kind === 'draw' ? { kind: 'draw' }
    : { kind: 'your-move' }

  const scoreboard: Scoreboard.ScoreboardModel = {
    status,
    difficulty: s.difficulty,
    score: props.score,
    history: props.history,
    isClaudeDone: s.isClaudeDone,
  }

  const panelX = size.width + GUTTER

  if (props.compact) {
    Scoreboard.drawCompactScoreboard(screen, panelX, BOARD_TOP, scoreboard)
  } else {
    Scoreboard.drawScoreboard(screen, panelX, BOARD_TOP, scoreboard)
  }

  if (dropdown) {
    Menus.drawDropdown(screen, dropdown, s.menu.hover)
  }

  return <Box flexDirection="column">{elementsOf({ Box, Text }, screen)}</Box>
}
