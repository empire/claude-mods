/* @jsx h */
import type { On } from 'claude-code'

import type { Kitty, Post, Props } from './board.tsx'
import * as Game from './game.ts'
import { canvasOf, paint, type View } from './kitty/paint.ts'
import * as Terminal from './kitty/terminal.ts'

const COMMAND = 'tictactoe'
const SCORE_KEY = 'score'
const DIFFICULTY_KEY = 'difficulty'
const RENDERER_KEY = 'renderer'

/** Below this many band rows the text board draws one text row per cell. */
const FULL_BOARD_MIN_ROWS = 16

/** The kitty board's height in rows: as tall as the band allows, within these. */
const KITTY_MIN_ROWS = 6
const KITTY_MAX_ROWS = 16

/** Columns the side panel beside the board needs. */
const SIDE_PANEL_COLUMNS = 48

type Renderer = 'auto' | 'kitty' | 'text'
/** The header's menu row: hidden, showing its items, or asking to confirm a score reset. */
type Menu = 'closed' | 'open' | 'confirm-reset'
type Cells = { cellWidth: number; cellHeight: number }

const isPost = (data: unknown): data is Post =>
  typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'sync'

const rendererOf = (value: unknown): Renderer =>
  value === 'kitty' || value === 'text' ? value : 'auto'

/**
 * Registers `/tictactoe`: a board in the band above the prompt, where the
 * person plays X against Claude's O while Claude works.
 *
 * The board is a surface module (`./board.tsx`) with its own keys, mouse and
 * clock. This module mounts it, keeps the score and difficulty in the store,
 * and tells the board when Claude finishes a turn. In a terminal with the
 * kitty graphics protocol it also paints each frame the board posts and
 * uploads it as an image (see `./kitty/terminal.ts`).
 *
 * @param on the engine's registrar
 */
export function register(on: On) {
  let isOpen = false
  let round = 0
  let turnsDone = 0
  let difficulty: Game.Difficulty = 'hard'
  let score: Game.Score = Game.EMPTY_SCORE
  let compact = false
  let renderer: Renderer = 'auto'
  /** The board's last event applied; a board mounted fresh numbers its events from 1 again. */
  let ack = 0
  let menu: Menu = 'closed'

  /** The terminal's cell size in pixels, once probed; null where kitty mode is off. */
  let cells: Cells | null = null
  let kitty: Kitty | null = null
  const imageId = Terminal.newImageId()

  /** The latest frame waiting to upload, and whether an upload is running. */
  let pendingView: View | null = null
  let isUploading = false

  /** Paints and uploads frames one at a time; frames that arrive meanwhile collapse into the latest. */
  let pumpUploads: () => Promise<void> = async () => undefined
  let deleteImage: () => Promise<void> = async () => undefined
  /** Decides between the image and the text board for `renderer`, measuring the terminal. */
  let setUpRenderer: () => Promise<void> = async () => undefined

  const boardProps = (): Props => ({ round, difficulty, score, done: turnsDone, compact, kitty, ack })

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const [storedScore, storedDifficulty, storedRenderer] = await Promise.all([
      $.store.get(SCORE_KEY).catch(() => undefined),
      $.store.get(DIFFICULTY_KEY).catch(() => undefined),
      $.store.get(RENDERER_KEY).catch(() => undefined),
    ])

    score = Game.scoreOf(storedScore)
    difficulty = storedDifficulty === 'easy' ? 'easy' : 'hard'
    renderer = rendererOf(storedRenderer)

    deleteImage = async () => {
      if (cells) {
        await $.process
          .run(['python3', '-c', 'import sys; open("/dev/tty", "w").write(sys.argv[1])', Terminal.deleteImage(imageId)])
          .catch(() => undefined)
      }
    }

    pumpUploads = async () => {
      if (isUploading) {
        return
      }

      isUploading = true

      try {
        while (pendingView && kitty) {
          const view = pendingView
          const box = kitty
          pendingView = null

          const canvas = canvasOf(box.columns, box.rows, box.cellWidth, box.cellHeight)
          const rgba = paint(view, canvas)
          const argv = [String(canvas.width), String(canvas.height), String(box.id), String(box.columns), String(box.rows)]

          const upload = await $.process
            .run(['python3', '-c', Terminal.UPLOAD_PY, ...argv], { stdin: Terminal.base64Of(rgba) })
            .catch((error: unknown) => ({ exitCode: -1, stderr: String(error) }))

          if (upload.exitCode !== 0) {
            $.ui.log(`tictactoe: kitty upload failed, back to text: ${upload.stderr.trim().slice(0, 200)}`)
            cells = null
            kitty = null
            $.ui.invalidate('ui.render')
          }
        }
      } finally {
        isUploading = false
      }
    }

    setUpRenderer = async () => {
      // Kitty mode needs the protocol, a real terminal (tmux keeps the images to itself) and
      // python3 to reach it; `/tictactoe kitty` skips the terminal check, `text` turns it off.
      const orEmpty = async (value: Promise<string | undefined>) => (await value.catch(() => undefined)) ?? ''
      const [term, program, tmux, kittyWindow] = await Promise.all([
        orEmpty($.env.get('TERM')),
        orEmpty($.env.get('TERM_PROGRAM')),
        orEmpty($.env.get('TMUX')),
        orEmpty($.env.get('KITTY_WINDOW_ID')),
      ])
      const isKittyTerminal =
        tmux === '' && (program === 'ghostty' || term === 'xterm-kitty' || term === 'xterm-ghostty' || kittyWindow !== '')

      cells = null

      if (renderer === 'kitty' || (renderer === 'auto' && isKittyTerminal)) {
        const probe = await $.process.run(['python3', '-c', Terminal.PROBE_PY]).catch(() => null)
        const [rows = 0, columns = 0, xPixels = 0, yPixels = 0] = (probe?.stdout ?? '').trim().split(/\s+/).map(Number)

        if (probe?.exitCode === 0 && rows > 0 && columns > 0 && xPixels > 0 && yPixels > 0) {
          cells = { cellWidth: xPixels / columns, cellHeight: yPixels / rows }
        }
      }
    }

    await $.command
      .register({
        name: COMMAND,
        description: 'Play tic-tac-toe against Claude above the prompt',
        argumentHint: '[stop | kitty | text | auto]',
        immediate: true,
      })
      .catch(error => $.ui.log(`tictactoe: /tictactoe not registered: ${String(error)}`))

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'kitty' || arg === 'text' || arg === 'auto') {
      renderer = arg
      await $.store.set(RENDERER_KEY, renderer).catch(() => undefined)
    }

    if (arg === 'stop' || (arg === '' && isOpen)) {
      isOpen = false
      $.ui.invalidate('ui.render')
      await deleteImage()

      return { text: 'Tic-tac-toe closed' }
    }

    await setUpRenderer()

    isOpen = true
    ack = 0
    $.ui.invalidate('ui.render')

    const how = cells ? 'kitty graphics' : renderer === 'text' ? 'text' : 'text (no kitty graphics here)'

    return {
      text: `Tic-tac-toe · ${how} · click the board to play · Esc returns to the prompt · /tictactoe closes`,
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (isOpen) {
      turnsDone += 1
      $.ui.invalidate('ui.render')
    }

    return result
  })

  on('ui.message', async ($, e, next) => {
    if (!isPost(e.data)) {
      return next(e)
    }

    const { view, events } = e.data

    if (view) {
      pendingView = view
      void pumpUploads()
    }

    if (events.length === 0) {
      return {}
    }

    for (const event of events) {
      if (event.seq <= ack) {
        continue
      }

      ack = event.seq

      if (event.type === 'toggle-difficulty') {
        difficulty = difficulty === 'hard' ? 'easy' : 'hard'
        await $.store.set(DIFFICULTY_KEY, difficulty).catch(() => undefined)
        $.ui.invalidate('ui.render')
      } else {
        const outcome: Game.Outcome =
          event.outcome === 'draw' ? { kind: 'draw' }
          : { kind: 'won', by: event.outcome === 'won' ? Game.PERSON : Game.CLAUDE, line: [] }

        score = Game.scoredAfter(score, outcome)
        await $.store.set(SCORE_KEY, score).catch(() => undefined)
      }
    }

    return { props: boardProps() }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The board needs a terminal's keys and mouse; other surfaces draw their own band.
    if (!isOpen || e.props.hasSurvey || e.surface !== 'terminal') {
      return next(e)
    }

    const { Box, Button, Client, Text } = await $.ui.resolve(e)
    compact = e.props.maxRows < FULL_BOARD_MIN_ROWS

    if (cells) {
      // A square board: as many rows as the band spares, as many columns as make it square,
      // fewer rows when the band is too narrow for that beside the side panel.
      const room = Math.max(10, e.props.bodyColumns - SIDE_PANEL_COLUMNS)
      const byHeight = Math.min(KITTY_MAX_ROWS, Terminal.MAX_ROWS, Math.max(KITTY_MIN_ROWS, e.props.maxRows - 3))
      const byWidth = Math.floor((room * cells.cellWidth) / cells.cellHeight)
      const rows = Math.max(3, Math.min(byHeight, byWidth))
      const columns = Math.max(3, Math.round((rows * cells.cellHeight) / cells.cellWidth))

      kitty = { id: imageId, columns, rows, ...cells }
    } else {
      kitty = null
    }

    const newGame = () => {
      round += 1
      $.ui.invalidate('ui.render')
    }

    const toggleDifficulty = () => {
      difficulty = difficulty === 'hard' ? 'easy' : 'hard'
      void $.store.set(DIFFICULTY_KEY, difficulty).catch(() => undefined)
      $.ui.invalidate('ui.render')
    }

    const close = () => {
      isOpen = false
      menu = 'closed'
      $.ui.invalidate('ui.render')
      void deleteImage()
    }

    const setMenu = (shown: Menu) => {
      menu = shown
      $.ui.invalidate('ui.render')
    }

    const resetScore = () => {
      score = Game.EMPTY_SCORE
      menu = 'closed'
      void $.store.set(SCORE_KEY, score).catch(() => undefined)
      $.ui.toast('tic-tac-toe: score reset')
      $.ui.invalidate('ui.render')
    }

    // Image to text frees the image. Text to image switches back to automatic detection, and
    // stays on text with a note where the terminal cannot show images.
    const toggleRenderer = async () => {
      const wasImage = cells !== null

      if (wasImage) {
        await deleteImage()
      }

      renderer = wasImage ? 'text' : 'auto'
      await setUpRenderer()

      if (!wasImage && !cells) {
        renderer = 'text'
        $.ui.toast('tic-tac-toe: no kitty graphics here (needs Ghostty or kitty outside tmux, and python3)')
      }

      await $.store.set(RENDERER_KEY, renderer).catch(() => undefined)
      $.ui.invalidate('ui.render')
    }

    const { wins, losses, draws } = score

    const menuRow =
      menu === 'open' ? (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{'  menu ›'}</Text>
          <Button key="ttt:menu:reset" label="reset score" onPress={() => setMenu('confirm-reset')} />
          <Button key="ttt:menu:board" label={`board: ${cells ? 'image' : 'text'}`} onPress={() => void toggleRenderer()} />
        </Box>
      ) : menu === 'confirm-reset' ? (
        <Box flexDirection="row" columnGap={1}>
          <Text color="yellow">{`  reset won ${wins} · lost ${losses} · drawn ${draws} to zero?`}</Text>
          <Button key="ttt:menu:reset-yes" label="yes, reset" onPress={resetScore} />
          <Button key="ttt:menu:reset-no" label="cancel" dimColor onPress={() => setMenu('open')} />
        </Box>
      ) : null

    // No hotkeys: a band hotkey would fire on a digit typed as a prompt's first character.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color="#d97757" bold>▦ tic-tac-toe</Text>
          <Button key="ttt:new" label="new game" onPress={newGame} />
          <Button key="ttt:level" label={`level: ${difficulty}`} onPress={toggleDifficulty} />
          <Button
            key="ttt:menu"
            label={menu === 'closed' ? '☰ menu' : '✕ menu'}
            onPress={() => setMenu(menu === 'closed' ? 'open' : 'closed')}
          />
          <Button key="ttt:close" label="close" dimColor onPress={close} />
        </Box>
        {menuRow}
        <Client
          key="ttt:board"
          module="./board.tsx"
          width={e.props.bodyColumns}
          props={boardProps()}
        />
        {await next(e)}
      </Box>
    )
  })
}
