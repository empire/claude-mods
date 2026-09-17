# claude-mods

Mods for [Claude Code](https://github.com/anthropics/claude-code): plugins
built on its **function hooks**, TypeScript that runs inside Claude Code and
can draw its own UI, handle the mouse and keyboard, and keep state. See
Anthropic's [`mods`](https://github.com/anthropics/claude-code/tree/main/mods)
for the built-in ones.

## tictactoe

Play tic-tac-toe against Claude above the prompt while it works: a painted
image board in Ghostty and kitty, an app-style menu bar, and a live
scoreboard.

![A Claude Code session where Claude has just answered a question, with the tic-tac-toe board above the prompt showing a won game, a scoreboard, and a note that Claude finished its turn](tictactoe/docs/hero.png)

- An image board with glowing, animated marks, drawn with the kitty graphics
  protocol, and a text board for every other terminal
- A `Game` / `Level` / `View` / `Help` menu bar whose menus open over the game
- A scoreboard with large-digit tallies, win rate, streaks and recent results
- A perfect Hard opponent (minimax) and a beatable Easy one
- Mouse and keyboard play, saved progress, and no tokens spent

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./tictactoe
```

Then run `/tictactoe`. The [tictactoe README](tictactoe/README.md) covers
every control and explains how it's built: surface modules, a cell compositor
so menus can overlap the game, and kitty Unicode placeholders that put an
image inside Claude Code's text layout.

## Developing

`types/claude-code.d.ts` holds the Claude Code 2.1.273 plugin API declarations,
and `tsconfig.json` typechecks every mod against them:

```sh
npx -p typescript@5 tsc -p tsconfig.json
claude plugin validate tictactoe
```

Function hooks are early access, and their API may change between Claude
Code releases.
