// The browser measures text with the fonts the CSS draws it in; tests measure it with this
// stand-in, a fixed width per character in each font.
import type { Board } from "../viewer/src/board.ts"
import { type Font, layout as laid, type Measure } from "../viewer/src/layout.ts"

const CHAR: Record<Font, number> = {
  title: 6.6,
  table: 5.2,
  note: 5.2,
  noteHead: 4.4,
  lane: 7,
  tag: 7,
  laneTag: 5,
  chapter: 7,
  slice: 6.5,
  detail: 5.5,
  field: 6.3,
  key: 6.3,
  input: 5,
  button: 5.5,
}

export const measure: Measure = (text, font) => text.length * CHAR[font]
export const layout = (board: Board) => laid(board, measure)
