// Measures text as the browser draws it, in the `--font-*` tokens the CSS draws it with.
import type { Font, Measure } from "./layout.ts"

const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D
const fonts = new Map<Font, string>()
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name)
const TAGS: readonly Font[] = ["tag", "laneTag"]

export const measure: Measure = (text, font) => {
  let set = fonts.get(font)
  if (set === undefined) {
    set = token(`--font-${font}`)
    fonts.set(font, set)
  }
  const tag = TAGS.includes(font)
  context.font = set
  context.letterSpacing = tag ? token("--tracking") : "0px"
  return context.measureText(tag ? text.toUpperCase() : text).width
}
