/* @jsx h */
import type { On } from 'claude-code'

import type { Post, Props } from './board.tsx'
import * as Game from './game.ts'

const COMMAND = 'tictactoe'
const SCORE_KEY = 'score'
const DIFFICULTY_KEY = 'difficulty'

/** Below this many band rows the board draws one text row per cell. */
const FULL_BOARD_MIN_ROWS = 16

const isPost = (data: unknown): data is Post =>
  typeof data === 'object' && data !== null && 'kind' in data

/**
 * Registers `/tictactoe`: a board in the band above the prompt, where the
 * person plays X against Claude's O while Claude works.
 *
 * The board is a surface module (`./board.tsx`) with its own keys, mouse and
 * clock; this module mounts it, keeps the score and difficulty in the store,
 * and tells the board when Claude finishes a turn.
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

  const boardProps = (): Props => ({ round, difficulty, score, done: turnsDone, compact })

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const [storedScore, storedDifficulty] = await Promise.all([
      $.store.get(SCORE_KEY).catch(() => undefined),
      $.store.get(DIFFICULTY_KEY).catch(() => undefined),
    ])

    score = Game.scoreOf(storedScore)
    difficulty = storedDifficulty === 'easy' ? 'easy' : 'hard'

    await $.command
      .register({
        name: COMMAND,
        description: 'Play tic-tac-toe against Claude above the prompt',
        argumentHint: '[stop]',
        immediate: true,
      })
      .catch(error => $.ui.log(`tictactoe: /tictactoe not registered: ${String(error)}`))

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const isStop = e.args.trim().toLowerCase() === 'stop'

    isOpen = isStop ? false : !isOpen
    $.ui.invalidate('ui.render')

    return {
      text: isOpen
        ? 'Tic-tac-toe · click the board to play · Esc returns to the prompt · /tictactoe closes'
        : 'Tic-tac-toe closed',
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

    if (e.data.kind === 'toggle-difficulty') {
      difficulty = difficulty === 'hard' ? 'easy' : 'hard'
      await $.store.set(DIFFICULTY_KEY, difficulty).catch(() => undefined)
      $.ui.invalidate('ui.render')
    } else {
      const outcome: Game.Outcome =
        e.data.outcome === 'draw' ? { kind: 'draw' }
        : { kind: 'won', by: e.data.outcome === 'won' ? Game.PERSON : Game.CLAUDE, line: [] }

      score = Game.scoredAfter(score, outcome)
      await $.store.set(SCORE_KEY, score).catch(() => undefined)
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
      $.ui.invalidate('ui.render')
    }

    // No hotkeys: a band hotkey would fire on a digit typed as a prompt's first character.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text color="#d97757" bold>▦ tic-tac-toe</Text>
          <Button key="ttt:new" label="new game" onPress={newGame} />
          <Button key="ttt:level" label={`level: ${difficulty}`} onPress={toggleDifficulty} />
          <Button key="ttt:close" label="close" dimColor onPress={close} />
        </Box>
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
