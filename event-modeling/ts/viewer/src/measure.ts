// Measures text as the browser draws it, in the `--font-*` tokens the CSS draws it with.
import type { Font, Measure } from "./layout.ts"

const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D
const fonts = new Map<Font, string>()
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name)
const TAGS: readonly Font[] = ["tag", "laneTag"]
// A font drawn with letter spacing, and how much.
const SPACED: Partial<Record<Font, string>> = { note: "--note-tracking" }

export const measure: Measure = (text, font) => {
  let set = fonts.get(font)
  if (set === undefined) {
    set = token(`--font-${font}`)
    fonts.set(font, set)
  }
  const tag = TAGS.includes(font)
  context.font = set
  const spaced = SPACED[font]
  context.letterSpacing = tag ? token("--tracking") : spaced ? token(spaced) : "0px"
  return context.measureText(tag ? text.toUpperCase() : text).width
}
