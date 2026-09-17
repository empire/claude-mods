# tictactoe

A demo mod: tic-tac-toe in the band above the Claude Code prompt, so you can
play while Claude works. You play ✕ against Claude's ◯.

In a terminal with the kitty graphics protocol (Ghostty, kitty) the board is
a real image: a rounded board with glowing marks that pop in, a highlighted
cursor cell with a preview ✕, and a line that sweeps through a win. Anywhere
else (tmux, other terminals) it falls back to a board drawn with box-drawing
characters:

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
the board needs an interactive terminal that reports the mouse. The image
board also needs `python3` (it writes the image to the terminal).

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./tictactoe
```

Run `/tictactoe` to open the board. Run it again, or `/tictactoe stop`, or
click `close`, to close it. The command runs right away, even mid-turn.

`/tictactoe text` always draws the text board, `/tictactoe kitty` tries the
image even where the terminal isn't detected, and `/tictactoe auto` (the
default) picks the image in Ghostty or kitty outside tmux. The choice is saved.

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
- **Menu**: `☰ menu` in the header opens a row with `reset score` (asks
  before zeroing) and `board: image|text`, which switches renderers. It only
  switches to the image where the terminal can show one; otherwise it says why.
- The score and level are saved in the plugin's store and survive restarts.
- When the band has fewer than 16 rows, the board switches to a compact
  layout with one text row per cell.

## How it's built

| file | role |
| --- | --- |
| `hooks/register.tsx` | Hooks module. Registers `/tictactoe`, mounts the board in `ui.render` of `AbovePrompt`, stores the score, counts finished turns, and paints and uploads image frames |
| `hooks/board.tsx` | Surface module, mounted with `<Client module="./board.tsx">`. Runs on the drawing thread with its own state, frame clock (`every`), `onPointer` and `onKey` |
| `hooks/game.ts` | Game rules and Claude's move choice, with no engine calls |
| `hooks/kitty/paint.ts` | Paints a frame as RGBA pixels: antialiased shapes built from distance functions, with gradients and glow |
| `hooks/kitty/terminal.ts` | The kitty protocol parts: the python helpers, placeholder rows, image ids |

### The image board

Claude Code's renderer never passes escape sequences through, so the image
reaches the terminal by another route, using kitty's
[Unicode placeholders](https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders):

1. When the board opens, a python helper reads the terminal's cell size in
   pixels from `/dev/tty`. The image is then sized to match its cell box
   exactly, so pointer positions map straight onto board cells.
2. Whenever the board's look changes, `board.tsx` posts a `View` (board,
   cursor, animation progress). `register.tsx` paints it and pipes it to a
   python helper, which zlib-compresses it and writes one `a=T,U=1` upload to
   `/dev/tty`. Uploads run one at a time, and frames that arrive in the
   meantime collapse into the latest.
3. `board.tsx` draws the image's cell box as text: `U+10EEEE` placeholder
   cells whose foreground color is the image id, with a diacritic marking each
   row. The terminal draws the image over those cells. Because they are
   ordinary text, the image moves with the layout and disappears when the
   board closes. Closing also frees the image.

### Messages between the modules

- **Hooks module → board:** it passes props (`round`, `difficulty`, `score`,
  `done`, `compact`, `kitty`, `ack`).
- **Board → hooks module:** it sends `{ kind: 'sync', view, events }` posts.
  A later post in the same frame replaces an undelivered one, so each post
  carries every event (game results, level toggles) that `ack` hasn't
  acknowledged yet. `ui.message` applies each event once.

Two rules the loader and validator enforce:

- `$` is only ever used as `$.noun.event(...)`. That includes `$.env.get`,
  which needs a literal variable name. Never store `$` or pass it around.
- `<Client module>` must be a string literal, because the engine reads it
  from the source.

## Check

```sh
npx -p typescript@5 tsc -p tsconfig.json   # from the repo root
claude plugin validate tictactoe
```
