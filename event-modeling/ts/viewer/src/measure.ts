// Measures text as the browser draws it, in the `--font-*` tokens the CSS draws it with.
import type { Font, Measure } from "./layout.ts"

const context = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D
const fonts = new Map<Font, string>()

export const measure: Measure = (text, font) => {
  let token = fonts.get(font)
  if (token === undefined) {
    token = getComputedStyle(document.documentElement).getPropertyValue(`--font-${font}`)
    fonts.set(font, token)
  }
  context.font = token
  return context.measureText(text).width
}
