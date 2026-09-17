/**
 * The game itself, with no engine in it: a board, whose turn, who won, and
 * the moves Claude picks.
 */

export type Mark = 'X' | 'O'
export type Cell = Mark | null
export type Board = readonly Cell[]
export type Difficulty = 'easy' | 'hard'

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'won'; by: Mark; line: readonly number[] }
  | { kind: 'draw' }

export type Score = { wins: number; losses: number; draws: number }

export const PERSON: Mark = 'X'
export const CLAUDE: Mark = 'O'
export const EMPTY_BOARD: Board = Array<Cell>(9).fill(null)
export const EMPTY_SCORE: Score = { wins: 0, losses: 0, draws: 0 }

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const

export function outcomeOf(board: Board): Outcome {
  for (const line of LINES) {
    const [a, b, c] = line
    const mark = board[a]

    if (mark && mark === board[b] && mark === board[c]) {
      return { kind: 'won', by: mark, line }
    }
  }

  return board.every(cell => cell !== null)
    ? { kind: 'draw' }
    : { kind: 'playing' }
}

export const freeCellsOf = (board: Board): number[] =>
  board.flatMap((cell, index) => (cell === null ? [index] : []))

export function played(board: Board, index: number, mark: Mark): Board {
  if (board[index] !== null || outcomeOf(board).kind !== 'playing') {
    return board
  }

  return board.map((cell, i) => (i === index ? mark : cell))
}

/**
 * Scores a position for `mark` to move: +10 a win for Claude, -10 a loss,
 * shaded by depth so a quicker win and a slower loss are preferred.
 */
function minimax(board: Board, mark: Mark, depth: number): number {
  const outcome = outcomeOf(board)

  if (outcome.kind === 'won') {
    return outcome.by === CLAUDE ? 10 - depth : depth - 10
  }

  if (outcome.kind === 'draw') {
    return 0
  }

  const next: Mark = mark === 'X' ? 'O' : 'X'
  const scores = freeCellsOf(board).map(i =>
    minimax(played(board, i, mark), next, depth + 1),
  )

  return mark === CLAUDE ? Math.max(...scores) : Math.min(...scores)
}

/**
 * Claude's move: on `hard` the best cell by minimax (it never loses), on
 * `easy` a random free cell, unless a win is right there.
 *
 * @param random a number in [0, 1), `Math.random` by default
 * @returns the cell index, or null when the game is over
 */
export function claudeMoveOf(
  board: Board,
  difficulty: Difficulty,
  random: () => number = Math.random,
): number | null {
  const free = freeCellsOf(board)

  if (free.length === 0 || outcomeOf(board).kind !== 'playing') {
    return null
  }

  if (difficulty === 'easy') {
    const winning = free.find(
      i => outcomeOf(played(board, i, CLAUDE)).kind === 'won',
    )

    return winning ?? free[Math.floor(random() * free.length)] ?? null
  }

  let best: number | null = null
  let bestScore = -Infinity

  for (const i of free) {
    const score = minimax(played(board, i, CLAUDE), PERSON, 1)

    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }

  return best
}

export function scoredAfter(score: Score, outcome: Outcome): Score {
  switch (outcome.kind) {
    case 'playing':
      return score
    case 'draw':
      return { ...score, draws: score.draws + 1 }
    case 'won':
      return outcome.by === PERSON
        ? { ...score, wins: score.wins + 1 }
        : { ...score, losses: score.losses + 1 }
  }
}

export function scoreOf(value: unknown): Score {
  const record = (value ?? {}) as Partial<Record<keyof Score, unknown>>
  const count = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0

  return {
    wins: count(record.wins),
    losses: count(record.losses),
    draws: count(record.draws),
  }
}
