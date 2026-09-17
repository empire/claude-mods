# tictactoe

A demo mod: tic-tac-toe in the band above the Claude Code prompt, so you can
play while Claude works. You play ✕ against Claude's ◯.

```
▦ tic-tac-toe [ new game ] [ level: hard ] [ close ]
╭─────────┬─────────┬─────────╮   TIC · TAC · TOE
│  ╲   ╱  │         │  ╲   ╱  │   ✕ you  vs  ◯ Claude
│    ╳    │    2    │    ╳    │
│  ╱   ╲  │         │  ╱   ╲  │   ◯ Claude is thinking...
├─────────┼─────────┼─────────┤
│         │  ╭───╮  │         │   won 1  lost 1  drawn 0  · level hard
│    4    │  │   │  │    6    │
│         │  ╰───╯  │         │   click the board, then 1-9 or arrows + enter
├─────────┼─────────┼─────────┤   x level · r restart · esc back to prompt
│    7    │    8    │    9    │
╰─────────┴─────────┴─────────╯
```

## Try it

Function hooks are early access. They only load with this variable set, and
the board needs an interactive terminal that reports the mouse.

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./tictactoe
```

Run `/tictactoe` to open the board. Run it again, or `/tictactoe stop`, or
click `close`, to close it. The command runs right away, even mid-turn.

## Play

- **Mouse**: hovering moves the highlight and a click plays that cell. The
  first click also gives the board the keyboard.
- **Keys** (after that click): `1`–`9` play a cell directly, arrows or WASD
  move the highlight, and Enter or Space plays it. `r` starts a new game, `x`
  switches the level, and Esc gives the keyboard back to the prompt.
- **Level**: `hard` uses minimax, so Claude never loses. `easy` plays random
  moves but still takes a win when it sees one.
- A finished game lights up the winning line and colors the border. Any
  click or Enter then starts the next game.
- When Claude finishes a turn while the board is open, the board shows
  `● Claude finished its turn`.
- The score and level are saved in the plugin's store and survive restarts.
- When the band has fewer than 16 rows, the board switches to a compact
  layout with one text row per cell.

## How it's built

| file | role |
| --- | --- |
| `hooks/register.tsx` | Hooks module. Registers `/tictactoe`, draws the header Buttons and mounts the board in `ui.render` of `AbovePrompt`, stores the score, and counts finished turns |
| `hooks/board.tsx` | Surface module, mounted with `<Client module="./board.tsx">`. Runs on the drawing thread with its own state, frame clock (`every`), `onPointer` and `onKey` |
| `hooks/game.ts` | Game rules and Claude's move choice, with no engine calls |

Data flows both ways between the two modules:

- **Hooks module → board:** it passes props (`round`, `difficulty`, `score`,
  `done`, `compact`). A new `round` starts a fresh board, and a new `done`
  shows the "Claude finished" notice.
- **Board → hooks module:** it sends `surface.post({ kind: 'result' | 'toggle-difficulty' })`.
  The `ui.message` hook updates the store and returns `{ props }`, which gives
  the board its next props.

Two rules the loader and validator enforce:

- `$` is only ever used as `$.noun.event(...)`. Never store it or pass it
  around.
- `<Client module>` must be a string literal, because the engine reads it
  from the source.

## Check

```sh
npx -p typescript@5 tsc -p tsconfig.json   # from the repo root
claude plugin validate tictactoe
```
