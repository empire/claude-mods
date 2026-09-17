import type * as Game from '../game.ts'
import { fill, frame, put, restyle, type Cell, type Screen } from './screen.tsx'
import * as Theme from './theme.ts'

// The app menu bar along the top row and the dropdown it opens, drawn into the board module's
// screen: the dropdown lands over the board and scoreboard, which dim beneath it. Geometry is in
// cells from the screen's top-left, the same cells pointer events report.

export type MenuName = 'game' | 'level' | 'view' | 'help'

export type ActionId =
  | 'new-game'
  | 'ask-reset'
  | 'confirm-reset'
  | 'cancel-reset'
  | 'close'
  | 'level-hard'
  | 'level-easy'
  | 'view-image'
  | 'view-text'

export type Item =
  | { kind: 'action'; id: ActionId; label: string; hint?: string; tone?: 'danger' }
  | { kind: 'separator' }
  | { kind: 'text'; label: string; keys?: string; tone?: 'dim' | 'warn' }

export type MenuContext = {
  difficulty: Game.Difficulty
  isImageBoard: boolean
  isConfirmingReset: boolean
  score: Game.Score
}

export type Dropdown = { name: MenuName; x: number; y: number; width: number; height: number; items: Item[] }

const BRAND = '▦ TIC·TAC·TOE'
const TITLES: readonly (readonly [MenuName, string])[] = [
  ['game', 'Game'],
  ['level', 'Level'],
  ['view', 'View'],
  ['help', 'Help'],
]

/** Columns the engine's own pane mark takes at the band's right edge. */
const RIGHT_RESERVED = 5

/** Where each title sits on the bar: its first cell and its width, padding included. */
export function titleSpans(): { name: MenuName; x: number; width: number }[] {
  let x = 1 + [...BRAND].length + 3

  return TITLES.map(([name, title]) => {
    const span = { name, x, width: title.length + 2 }
    x += span.width + 1
    return span
  })
}

/** The bar's close control: its first cell and width. */
export const closeSpanOf = (width: number) => ({ x: Math.max(0, width - RIGHT_RESERVED - 3), width: 3 })

const radio = (isOn: boolean) => (isOn ? '●' : '○')

export function itemsOf(name: MenuName, context: MenuContext): Item[] {
  switch (name) {
    case 'game':
      if (context.isConfirmingReset) {
        const { wins, losses, draws } = context.score

        return [
          { kind: 'text', label: 'Reset the scoreboard?', tone: 'warn' },
          { kind: 'text', label: `won ${wins} · lost ${losses} · drawn ${draws} → 0`, tone: 'dim' },
          { kind: 'separator' },
          { kind: 'action', id: 'confirm-reset', label: 'Reset score', tone: 'danger' },
          { kind: 'action', id: 'cancel-reset', label: 'Cancel', hint: 'esc' },
        ]
      }

      return [
        { kind: 'action', id: 'new-game', label: 'New game', hint: 'r' },
        { kind: 'action', id: 'ask-reset', label: 'Reset score…' },
        { kind: 'separator' },
        { kind: 'action', id: 'close', label: 'Close board' },
      ]
    case 'level':
      return [
        { kind: 'action', id: 'level-hard', label: `${radio(context.difficulty === 'hard')} Hard`, hint: 'never loses' },
        { kind: 'action', id: 'level-easy', label: `${radio(context.difficulty === 'easy')} Easy`, hint: 'random moves' },
        { kind: 'separator' },
        { kind: 'text', label: 'x on the board switches', tone: 'dim' },
      ]
    case 'view':
      return [
        { kind: 'action', id: 'view-image', label: `${radio(context.isImageBoard)} Image board`, hint: 'kitty' },
        { kind: 'action', id: 'view-text', label: `${radio(!context.isImageBoard)} Text board`, hint: 'any terminal' },
        { kind: 'separator' },
        { kind: 'text', label: 'images need Ghostty or kitty', tone: 'dim' },
      ]
    case 'help':
      return [
        { kind: 'text', label: 'play that cell', keys: '1–9' },
        { kind: 'text', label: 'move · enter plays', keys: 'arrows' },
        { kind: 'text', label: 'new game', keys: 'r' },
        { kind: 'text', label: 'switch level', keys: 'x' },
        { kind: 'text', label: 'open the menu', keys: 'm' },
        { kind: 'text', label: 'back to the prompt', keys: 'esc' },
        { kind: 'separator' },
        { kind: 'text', label: 'click the board to give it keys', tone: 'dim' },
      ]
  }
}

const itemWidthOf = (item: Item) =>
  item.kind === 'separator' ? 0
  : item.kind === 'action' ? [...item.label].length + (item.hint ? item.hint.length + 3 : 0)
  : [...item.label].length + (item.keys ? 9 : 0)

export function dropdownOf(name: MenuName, context: MenuContext, screenWidth: number): Dropdown {
  const items = itemsOf(name, context)
  const inner = Math.max(24, ...items.map(itemWidthOf)) + 2
  const width = inner + 2
  const span = titleSpans().find(title => title.name === name)
  const x = Math.max(0, Math.min((span?.x ?? 0) - 1, screenWidth - width - RIGHT_RESERVED))

  return { name, x, y: 1, width, height: items.length + 2, items }
}

/** The indices of the items a pointer or the arrow keys can land on. */
export const selectableOf = (dropdown: Dropdown) =>
  dropdown.items.flatMap((item, index) => (item.kind === 'action' ? [index] : []))

/** The action item under a cell, or null. */
export function itemAt(dropdown: Dropdown, x: number, y: number): number | null {
  const index = y - dropdown.y - 1
  const isInside = x > dropdown.x && x < dropdown.x + dropdown.width - 1 && index >= 0 && index < dropdown.items.length

  return isInside && dropdown.items[index]?.kind === 'action' ? index : null
}

export const isInsideDropdown = (dropdown: Dropdown, x: number, y: number) =>
  x >= dropdown.x && x < dropdown.x + dropdown.width && y >= dropdown.y && y < dropdown.y + dropdown.height

/** The bar along row 0: brand, titles (the open one lit), and the close control. */
export function drawBar(screen: Screen, open: MenuName | null, hoverTitle: MenuName | null) {
  fill(screen, 0, 0, screen.width, 1, { bg: Theme.BAR_BG })
  put(screen, 1, 0, BRAND, { fg: Theme.ACCENT, bg: Theme.BAR_BG, bold: true })
  put(screen, 1 + [...BRAND].length + 1, 0, '│', { fg: Theme.BAR_DIVIDER, bg: Theme.BAR_BG })

  for (const span of titleSpans()) {
    const title = TITLES.find(([name]) => name === span.name)?.[1] ?? ''
    const isOpen = open === span.name
    const isHover = !isOpen && hoverTitle === span.name
    const bg = isOpen ? Theme.BAR_OPEN_BG : isHover ? Theme.BAR_HOVER_BG : Theme.BAR_BG

    put(screen, span.x, 0, ` ${title} `, { fg: isOpen ? Theme.TEXT_BRIGHT : Theme.BAR_TEXT, bg, bold: isOpen })
  }

  const close = closeSpanOf(screen.width)
  put(screen, close.x, 0, ' ✕ ', { fg: Theme.TEXT_MUTED, bg: Theme.BAR_BG })
}

/** The open dropdown over everything below the bar, which dims beneath it. */
export function drawDropdown(screen: Screen, dropdown: Dropdown, hover: number | null) {
  // Dim what the menu covers, and cut the image out of the cells the panel and shadow take.
  restyle(screen, 0, 1, screen.width, screen.height - 1, cell => (cell.isImage ? cell : { ...cell, dim: true }))

  const { x, y, width, height } = dropdown

  // A see-through shadow, offset down and right as if lit from the top left: what lies beneath
  // stays readable, only darker, so it reads as shade over the board and not a hole in it. It is
  // two columns wide on the right to match the one row below, since cells are twice as tall as
  // wide, and it leaves the image alone, which keeps showing through.
  const shade = (cell: Cell): Cell =>
    cell.isImage ? cell : { ch: cell.ch, fg: Theme.SHADOW_TEXT, bg: Theme.SHADOW, dim: false, bold: false }

  restyle(screen, x + width, y + 1, 2, height, shade)
  restyle(screen, x + 2, y + height, width, 1, shade)

  frame(screen, x, y, width, height, { border: Theme.MENU_BORDER, bg: Theme.MENU_BG })

  const inner = width - 2

  dropdown.items.forEach((item, index) => {
    const row = y + 1 + index

    if (item.kind === 'separator') {
      put(screen, x, row, `├${'─'.repeat(inner)}┤`, { fg: Theme.MENU_BORDER, bg: Theme.MENU_BG })
      return
    }

    if (item.kind === 'text') {
      const fg = item.tone === 'warn' ? Theme.WARN : item.tone === 'dim' ? Theme.TEXT_MUTED : Theme.TEXT

      if (item.keys) {
        put(screen, x + 2, row, item.keys.padEnd(8), { fg: Theme.ACCENT, bg: Theme.MENU_BG, bold: true })
        put(screen, x + 10, row, item.label, { fg, bg: Theme.MENU_BG })
      } else {
        put(screen, x + 2, row, item.label, { fg, bg: Theme.MENU_BG, bold: item.tone === 'warn' })
      }
      return
    }

    const isHover = hover === index
    const bg = isHover ? Theme.MENU_HOVER_BG : Theme.MENU_BG
    const fg = item.tone === 'danger' ? Theme.DANGER : isHover ? Theme.TEXT_BRIGHT : Theme.TEXT

    fill(screen, x + 1, row, inner, 1, { bg })
    put(screen, x + 2, row, item.label, { fg, bg, bold: isHover })

    if (item.hint) {
      put(screen, x + width - 2 - item.hint.length, row, item.hint, { fg: isHover ? Theme.TEXT : Theme.TEXT_MUTED, bg })
    }
  })
}
