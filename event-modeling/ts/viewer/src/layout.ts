// Lays out the eventmodeling.org canvas from the board `read.ts` makes. Pure, so it
// is tested without a browser: text is measured by the function it is given.

import {
  inputNames,
  type Message,
  type Note,
  type NoteKind,
  type Source,
  words,
} from "../../src/types.ts"
import type { Board, BoardSlice } from "./board.ts"

/** Where a mapped field got its value, as the detail panes show it. */
export function source(s: Source): string {
  if ("from" in s) return `← ${s.from}`
  if ("generate" in s) {
    const inputs = inputNames(s)
    return inputs.length > 0 ? `generated from ${inputs.join(", ")}` : "generated"
  }
  return `= ${JSON.stringify(s.value)}`
}

export type Kind = "ui" | "external" | "command" | "event" | "readModel" | "automation"
export type Pt = [number, number]
/**
 * The fonts text is fitted in, each a `--font-*` token in `style.css`; a tag is set in capitals,
 * tracked by `--tracking`.
 */
export type Font =
  | "title"
  | "table"
  | "note"
  | "lane"
  | "tag"
  | "laneTag"
  | "chapter"
  | "slice"
  | "detail"
  | "field"
  | "key"
  | "input"
  | "button"
/** How wide `text` is drawn in `font`, in px. */
export type Measure = (text: string, font: Font) => number
/** What a slice, a card or the model is marked with: its strongest message. */
export type Mark = Message["kind"]

/** Each kind as the reader calls it. */
export const KIND: Record<Kind, string> = {
  ui: "screen",
  external: "external event",
  command: "command",
  event: "event",
  readModel: "view",
  automation: "automation",
}

export interface Box {
  id: string
  kind: Kind
  /** The declaration's name; a ui card is named by its service method. */
  name: string
  /** The name as words, `[]` after a list's, in the lines that fit the card. */
  title: string[]
  fields: string[]
  keys: string[]
  /** A list view, titled with `[]`. */
  list?: true
  /** A second line under the name: the service that handles a command or serves a view. */
  detail?: string
  /** Name only: a reference to a view, or a later appearance of an element. */
  compact?: boolean
  /** The first appearance of this element, when this card is a later one. */
  canonical?: string
  /** The element's notes, at the foot of its first card, `y` from the card's top. */
  notes?: Sticky[]
  /** The strongest message about the element in its slice. */
  mark?: Mark
  /** A screen's wireframe: the inputs it collects, the button it presses, the table it shows. */
  form?: string[]
  button?: string
  table?: string[]
  /** One for the table of a view with no key column, which has one row; otherwise the table shows two. */
  tableRows?: 1
  /** The columns of `table` that fit the card, and how many did not. */
  tableColumns?: { name: string; x: number; w: number }[]
  tableMore?: number
  column: number
  x: number
  y: number
  w: number
  h: number
}

export interface Link {
  from: string
  to: string
  dashed: boolean
}

export interface Edge extends Link {
  /** The route, corner by corner. */
  points: Pt[]
}

export interface Row {
  id: string
  label: string
  /** What the lane is: Actor, Admin, System for a machine of ours, External, or Stream. */
  sub?: string
  kind: "actor" | "middle" | "stream"
  y: number
  h: number
}

export interface Column {
  index: number
  chapter: number
  slice: BoardSlice
  /** The slice's name, or the name of what it is about. */
  label: string
  /** `label` as words, for the picture. */
  title: string
  /** The kind of its most serious note, which its navigation row shows as the kind's icon. */
  note: NoteKind | undefined
  /** The notes in the rail beside the slice: its own at the top, then each card's level with it. */
  notes?: Sticky[]
  /** The slice's messages: its own, or, for a declaration in no slice, those about it. */
  messages: Message[]
  mark?: Mark
  x: number
  w: number
}

export interface Chapter {
  name: string
  /** `name` as words, for the picture. */
  title: string
  x: number
  w: number
  /** The chapter's notes, above its band from its left edge, wrapping within its width. */
  notes?: Sticky[]
}

/** A note drawn on the canvas: its kind's icon, then its text, cut to a few lines that fit. */
export interface Sticky {
  kind: NoteKind
  /** What the note is about, as words: where it stands says so, and its tooltip names it. */
  subject: string
  text: string
  lines: string[]
  x: number
  y: number
  h: number
}

export interface SpecCard {
  kind: Kind | "error" | "description"
  name: string
  /** One `field = value` per line. */
  lines: string[]
}

export interface SpecStep {
  word: "given" | "when" | "then"
  cards: SpecCard[]
}

/** A specification, drawn as cards in the slice's detail and in the opened slice, not on the canvas. */
export interface Spec {
  column: number
  title: string
  steps: SpecStep[]
}

export interface Layout {
  width: number
  height: number
  /** Where the slice names go, under the chapter arrows. */
  nameY: number
  chapters: Chapter[]
  columns: Column[]
  rows: Row[]
  boxes: Box[]
  edges: Edge[]
  specs: Spec[]
  /** The messages no slice has. */
  model: { messages: Message[]; mark?: Mark }
}

export const COL_W = 220
export const CARD_W = 168
export const REF_W = 96
export const LABEL_W = 156
export const HEADER_H = 56
export const ARROW_H = 30
export const NAME_H = 30
export const CHAPTER_GAP = 24
export const LANE_PAD = 16
export const STACK_GAP = 12
export const SLOT_GAP = 32
export const TITLE_H = 30
export const TITLE_LINE = 15
export const FIELD_H = 15
export const COMPACT_H = 34
export const CHANNEL_PAD = 10
export const CHANNEL_STEP = 7
export const CORNER = 12
export const FAN = 8
export const INPUT_H = 22
export const BUTTON_H = 28
export const TABLE_H = 52
export const TABLE_PAD = 12
export const TABLE_MORE_W = 26
export const STICKY_LINES = 3
export const STICKY_LINE = 11
/** A card's and a note's inner padding: its text stands this far from its edge. */
export const PAD = 12
export const STICKY_GAP = 6
export const NOTE_W = 128
export const NOTE_GAP = 12

const PAD_X = (COL_W - CARD_W) / 2

export interface Element {
  name: string
  fields: string[]
  keys: string[]
  /** A list view, written `Name[]`. */
  list?: true
}

/** `Name(a, *b)` -> the name, the fields, and the key columns marked `*`; `Name[]` is a list. */
export function parse(element: string): Element {
  const open = element.indexOf("(")
  const written = (open < 0 ? element : element.slice(0, open)).trim()
  const name = written.replace(/\[\]$/, "")
  const list = name !== written ? { list: true as const } : {}
  if (open < 0) return { name, fields: [], keys: [], ...list }
  const raw = element
    .slice(open + 1, element.lastIndexOf(")"))
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
  return {
    name,
    fields: raw.map((f) => f.replace(/^\*/, "")),
    keys: raw.filter((f) => f.startsWith("*")).map((f) => f.slice(1)),
    ...list,
  }
}

/**
 * `Name(a=1, b=[x, y], c={d: 2})`, `Error: message` or `Described: outcome` -> a name and one line
 * per field.
 */
export function parseClause(clause: string): {
  name: string
  lines: string[]
  error: boolean
  described?: true
} {
  if (clause.startsWith("Error:")) {
    return { name: "Rejected", lines: [clause.slice("Error:".length).trim()], error: true }
  }
  if (clause.startsWith("Described:")) {
    const outcome = clause.slice("Described:".length).trim()
    return { name: "Described", lines: [outcome], error: false, described: true }
  }
  const open = clause.indexOf("(")
  if (open < 0) return { name: clause.trim(), lines: [], error: false }
  return {
    name: clause.slice(0, open).trim(),
    lines: items(clause.slice(open + 1, clause.lastIndexOf(")"))).map((l) => l.replace("=", " = ")),
    error: false,
  }
}

/** `a, [b, c], {d: e}` -> its items: split at the commas outside brackets. */
function items(text: string): string[] {
  const all: string[] = []
  let depth = 0
  let current = ""
  for (const ch of text) {
    if (ch === "[" || ch === "{") depth++
    if (ch === "]" || ch === "}") depth--
    if (ch === "," && depth === 0) {
      all.push(current)
      current = ""
    } else current += ch
  }
  if (current.trim().length > 0) all.push(current)
  return all.map((item) => item.trim())
}

/**
 * A value as the lines a specification shows: a list of records or lists one item per line, so each
 * reads whole; anything else one line.
 */
export function valueLines(value: string): string[] {
  const listed = value.startsWith("[") && value.endsWith("]") ? items(value.slice(1, -1)) : []
  if (listed.length < 2 || !listed.some((item) => /^[[{]/.test(item))) return [value]
  return listed.map(
    (item, i) => `${i === 0 ? "[" : " "}${item}${i < listed.length - 1 ? "," : "]"}`,
  )
}

const UUID = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** A value as shown: each UUID in it cut to its first group, which tells one from another. */
export const shortIds = (value: string): string => value.replace(UUID, "$1")

/**
 * Wraps to lines no wider than `room` as `width` measures them, breaking at spaces, and inside a word
 * only when the word alone is wider than a line.
 */
export function wrap(text: string, room: number, width: (s: string) => number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    let rest = word
    while (rest.length > 0) {
      const joined = line.length > 0 ? `${line} ${rest}` : rest
      if (width(joined) <= room) {
        line = joined
        rest = ""
      } else if (line.length > 0) {
        lines.push(line)
        line = ""
      } else {
        const take = Math.max(1, longest(rest, room, width))
        lines.push(rest.slice(0, take))
        rest = rest.slice(take)
      }
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** How many of `text`'s first characters fit `room`. */
function longest(text: string, room: number, width: (s: string) => number): number {
  let n = 0
  while (n < text.length && width(text.slice(0, n + 1)) <= room) n++
  return n
}

/**
 * `text` in at most `max` lines no wider than `room`; when it takes more, the last line shown ends in
 * an ellipsis, cut further if it has to be.
 */
export function fitLines(
  text: string,
  room: number,
  max: number,
  width: (s: string) => number,
): string[] {
  const all = wrap(text, room, width)
  if (all.length <= max) return all
  const last = all[max - 1] ?? ""
  return [
    ...all.slice(0, max - 1),
    `${last.slice(
      0,
      longest(last, room, (s) => width(`${s}…`)),
    )}…`,
  ]
}

/**
 * Each kind of note as an icon, so a note says its kind without colour and its subject in words;
 * the most serious first.
 */
export const ICON: Record<NoteKind, string> = {
  critical: "⚠",
  question: "?",
  info: "ⓘ",
}

/** The most serious kind among `notes`, if any. */
export const gravest = (notes: readonly Note[] | undefined): NoteKind | undefined =>
  (Object.keys(ICON) as NoteKind[]).find((kind) => notes?.some((n) => n.kind === kind))

/**
 * Notes on `subject` stacked from `top`, each its kind's icon then its text, cut to `STICKY_LINES`
 * lines; the detail shows the whole text.
 */
export function stickies(
  notes: readonly Note[],
  top: number,
  subject: string,
  measure: Measure,
): Sticky[] {
  const room = NOTE_W - 2 * PAD
  const note = (s: string) => measure(s, "note")
  let y = top
  return notes.map(({ text, kind }) => {
    const lines = fitLines(`${ICON[kind]} ${text}`, room, STICKY_LINES, note)
    const h = lines.length * STICKY_LINE + 2 * PAD
    const sticky = { kind, subject, text, lines, x: 0, y, h }
    y += sticky.h + STICKY_GAP
    return sticky
  })
}

/**
 * As many columns as fit the width, left to right, leaving room for a `+n`; a first column wider than
 * that is narrowed to fit, its name to be cut.
 */
export function fitColumns(
  names: string[],
  width: number,
  measure: Measure,
): { columns: { name: string; x: number; w: number }[]; more: number } {
  const columns: { name: string; x: number; w: number }[] = []
  const table = (s: string) => measure(s, "table")
  let x = 0
  for (let i = 0; i < names.length; i++) {
    const limit = i < names.length - 1 ? width - TABLE_MORE_W : width
    const name = names[i] ?? ""
    const w =
      columns.length > 0 ? table(name) + TABLE_PAD : Math.min(table(name) + TABLE_PAD, limit)
    if (x + w > limit) break
    columns.push({ name, x, w })
    x += w
  }
  return { columns, more: names.length - columns.length }
}

/** A mark follows what it marks: `MARK_GAP` after its end, centred on its first line (`baseline`). */
export const MARK_R = 4
export const MARK_GAP = 6
export const markAt = (end: number, baseline: number): Pt => [
  end + MARK_GAP + MARK_R,
  baseline - 4.5,
]

/** A card's title in the lines that fit `w`, less the room a link back to its first card takes. */
export function titled(
  el: Pick<Element, "name" | "list">,
  w: number,
  linked: boolean,
  measure: Measure,
): string[] {
  const room = w - 2 * PAD - (linked ? 26 : 0)
  return wrap(`${words(el.name)}${el.list ? "[]" : ""}`, room, (s) => measure(s, "title"))
}

/** The card an element is drawn in full on, where a link to it goes. */
export const firstCard = (layout: Pick<Layout, "boxes">, name: string) =>
  layout.boxes.find((b) => b.name === name && !b.compact)

/** How far a card's title reaches below one line's. */
export const titleDrop = (box: Pick<Box, "title">) => (box.title.length - 1) * TITLE_LINE

/** Where each line a card draws stands, from the card's top, and the height that holds them all. */
export interface Face {
  /** The title's first baseline. */
  title: number
  /** The service line's baseline. */
  detail?: number
  /** Each field and its baseline. */
  fields: { text: string; y: number }[]
  /** A screen's wireframe: each input and its top, its button's top, its table's. */
  inputs: { text: string; y: number }[]
  button?: number
  table?: number
  h: number
}

/**
 * Every line a card draws, and how tall it is to hold them: its title's lines, the service line, then
 * its fields or its screen's wireframe. A name-only card draws its title alone, centred, and no service
 * line. `Card.vue` draws by this and every card is sized by it, so no line goes uncounted.
 */
export function face(
  box: Pick<
    Box,
    "kind" | "title" | "fields" | "detail" | "compact" | "form" | "button" | "table" | "tableRows"
  >,
): Face {
  const drop = titleDrop(box)
  const ui = !box.compact && box.kind === "ui"
  const detail = box.compact ? undefined : box.detail
  const fields = box.compact || ui ? [] : box.fields
  if (!ui && fields.length === 0 && detail === undefined) {
    const h = (box.compact ? COMPACT_H : TITLE_H + 6) + drop
    return { title: (h - drop) / 2 + 4.5, fields: [], inputs: [], h }
  }
  const top = TITLE_H + drop
  const body = top + (detail === undefined ? 0 : 14)
  const lines = { title: 20, ...(detail !== undefined && { detail: top + 4 }) }
  if (!ui) {
    const at = fields.map((text, i) => ({ text, y: body + 6 + i * FIELD_H }))
    return {
      ...lines,
      fields: at,
      inputs: [],
      h: body + fields.length * FIELD_H + (fields.length > 0 ? 10 : 6),
    }
  }
  const form = box.form ?? []
  const inputs = form.map((text, i) => ({ text, y: body + 2 + i * INPUT_H }))
  let y = body + 4 + form.length * INPUT_H
  const button = box.button === undefined ? undefined : y
  if (button !== undefined) y += BUTTON_H
  const table = box.table === undefined ? undefined : y
  if (table !== undefined) y += TABLE_H
  return {
    ...lines,
    fields: [],
    inputs,
    ...(button !== undefined && { button }),
    ...(table !== undefined && { table }),
    h: y + 6,
  }
}

type Rect = Pick<Box, "x" | "y" | "w" | "h">

/** A route's straight runs, each as its two ends. */
const runs = (points: readonly Pt[]): [Pt, Pt][] =>
  points.slice(1).map((q, i) => [points[i] as Pt, q])

/** Whether two spans of one axis share a stretch longer than a point. */
const shared = (a: number, b: number, c: number, d: number) =>
  Math.min(Math.max(a, b), Math.max(c, d)) > Math.max(Math.min(a, b), Math.min(c, d))

/** Whether two runs lie on one line and share a stretch of it. */
const along = ([p, q]: [Pt, Pt], [r, t]: [Pt, Pt]) =>
  (p[0] === q[0] && r[0] === t[0] && p[0] === r[0] && shared(p[1], q[1], r[1], t[1])) ||
  (p[1] === q[1] && r[1] === t[1] && p[1] === r[1] && shared(p[0], q[0], r[0], t[0]))

/**
 * Whether the route runs through any of the cards but its own two ends, or along a stretch of
 * another route, where the two could not be told apart.
 */
function blocked(
  points: Pt[],
  cards: readonly Rect[],
  ends: readonly Rect[],
  lines: readonly Pt[][],
): boolean {
  const others = lines.flatMap(runs)
  return runs(points).some(
    ([p, q]) =>
      cards.some(
        (c) =>
          !ends.includes(c) &&
          Math.max(p[0], q[0]) > c.x &&
          Math.min(p[0], q[0]) < c.x + c.w &&
          Math.max(p[1], q[1]) > c.y &&
          Math.min(p[1], q[1]) < c.y + c.h,
      ) || others.some((other) => along([p, q], other)),
  )
}

/**
 * The shortest orthogonal route from the side of `a` that faces `b` to the side of `b` that faces
 * `a`, turning midway, else just past `a`, else just before `b`, whichever first crosses no card
 * and runs along none of the `lines` already drawn. Undefined when every one does. `out` and `into`
 * move its ends along their sides.
 */
export function direct(
  a: Box,
  b: Box,
  cards: readonly Rect[] = [],
  lines: readonly Pt[][] = [],
  out = 0,
  into = 0,
): Pt[] | undefined {
  // Across when one stands wholly beside the other, else up or down: work in x, flipping for y.
  const across = b.x >= a.x + a.w || b.x + b.w <= a.x
  const turn = ({ x, y, w, h }: Rect): Rect =>
    across ? { x, y, w, h } : { x: y, y: x, w: h, h: w }
  const flip = ([x, y]: Pt): Pt => (across ? [x, y] : [y, x])
  const [A, B] = [turn(a), turn(b)]
  const dir = B.x > A.x ? 1 : -1
  const sx = dir > 0 ? A.x + A.w : A.x
  const tx = dir > 0 ? B.x : B.x + B.w
  const sy = A.y + A.h / 2 + out
  const ty = B.y + B.h / 2 + into
  for (const mx of [
    (sx + tx) / 2,
    sx + dir * (Math.abs(out) + FAN),
    tx - dir * (Math.abs(into) + FAN),
  ]) {
    const line: Pt[] =
      sy === ty
        ? [
            [sx, sy],
            [tx, ty],
          ]
        : [
            [sx, sy],
            [mx, sy],
            [mx, ty],
            [tx, ty],
          ]
    const points = line.map(flip)
    if (!blocked(points, cards, [a, b], lines)) return points
  }
  return undefined
}

/** The side of `a` that faces `b`, as `direct` takes it: across when one stands wholly beside the other. */
const facing = (a: Rect, b: Rect) =>
  b.x >= a.x + a.w ? "right" : b.x + b.w <= a.x ? "left" : b.y > a.y ? "bottom" : "top"

/**
 * How far along its target's side an arrow enters: off centre by `FAN`, towards its source, where
 * another arrow leaves that side (a call into the external event whose answer leaves it), else at
 * centre, so the two never meet in one point and read as one line.
 */
export function apart(links: readonly Link[], byId: ReadonlyMap<string, Rect>) {
  const ends = (e: Link) => [byId.get(e.from), byId.get(e.to)] as const
  const leaving = new Set(
    links.flatMap((e) => {
      const [a, b] = ends(e)
      return a && b ? [`${e.from} ${facing(a, b)}`] : []
    }),
  )
  return (e: Link): number => {
    const [a, b] = ends(e)
    if (!a || !b) return 0
    const side = facing(b, a)
    if (!leaving.has(`${e.to} ${side}`)) return 0
    const along =
      side === "left" || side === "right"
        ? a.y + a.h / 2 - (b.y + b.h / 2)
        : a.x + a.w / 2 - (b.x + b.w / 2)
    return along < 0 ? -FAN : FAN
  }
}

/** Round the right side of the cards standing between `a` and `b`, one above the other. */
export function around(a: Box, b: Box, cards: readonly Rect[]): Pt[] {
  const [top, bottom] = a.y < b.y ? [a, b] : [b, a]
  const between = cards.filter(
    (c) =>
      c.y >= top.y + top.h &&
      c.y + c.h <= bottom.y &&
      c.x < Math.max(a.x + a.w, b.x + b.w) &&
      c.x + c.w > Math.min(a.x, b.x),
  )
  const side = Math.max(...[a, b, ...between].map((c) => c.x + c.w)) + FAN
  return [
    [a.x + a.w, a.y + a.h / 2],
    [side, a.y + a.h / 2],
    [side, b.y + b.h / 2],
    [b.x + b.w, b.y + b.h / 2],
  ]
}

/** An SVG path along the points, with rounded corners. */
export function polyline(points: Pt[]): string {
  const [first, ...rest] = points
  if (!first) return ""
  let d = `M${first[0]} ${first[1]}`
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i]
    const next = rest[i + 1]
    if (!corner) break
    if (!next) {
      d += ` L${corner[0]} ${corner[1]}`
      break
    }
    const prev = i === 0 ? first : (rest[i - 1] as Pt)
    const inX = Math.sign(corner[0] - prev[0])
    const inY = Math.sign(corner[1] - prev[1])
    const outX = Math.sign(next[0] - corner[0])
    const outY = Math.sign(next[1] - corner[1])
    const r = Math.min(
      CORNER,
      Math.hypot(corner[0] - prev[0], corner[1] - prev[1]) / 2,
      Math.hypot(next[0] - corner[0], next[1] - corner[1]) / 2,
    )
    d += ` L${corner[0] - inX * r} ${corner[1] - inY * r}`
    d += ` Q${corner[0]} ${corner[1]} ${corner[0] + outX * r} ${corner[1] + outY * r}`
  }
  return d
}

type Placed = Omit<Box, "x" | "y"> & { dx: number }

function labelOf(s: BoardSlice): string {
  if (s.name) return s.name
  if (s.command) return parse(s.command).name
  if (s.read_models?.[0]) return parse(s.read_models[0]).name
  if (s.automation) return s.automation
  if (s.ui) return s.ui.slice(s.ui.indexOf("/") + 1)
  if (s.external_event) return parse(s.external_event).name
  return "slice"
}

/** A command's events are alternatives, so they stand side by side in their lane, and widen it. */
function columnWidth(s: BoardSlice): number {
  const perSystem = new Map<string, number>()
  for (const c of s.calls ?? []) perSystem.set(c.actor, (perSystem.get(c.actor) ?? 0) + 1)
  const beside = Math.max(1, s.events?.length ?? 0, ...perSystem.values())
  return COL_W + (beside - 1) * (CARD_W + STACK_GAP)
}

export function layout(model: Board, measure: Measure): Layout {
  // A `reads` entry is a name. Its fields come from where the view is drawn in full.
  const registry = new Map<string, Element>()
  const kinds = new Map<string, Kind>()
  for (const chapter of model.chapters) {
    for (const slice of chapter.slices) {
      for (const rm of slice.read_models ?? []) {
        const el = parse(rm)
        if (!registry.has(el.name)) registry.set(el.name, el)
        kinds.set(el.name, "readModel")
      }
      for (const ev of slice.events ?? []) kinds.set(parse(ev).name, "event")
      if (slice.command) kinds.set(parse(slice.command).name, "command")
      if (slice.external_event) kinds.set(parse(slice.external_event).name, "external")
      for (const call of slice.calls ?? []) kinds.set(parse(call.event).name, "external")
    }
  }

  const messages = model.messages ?? []
  const marked = (own: Message[]) => {
    const mark = markOf(own)
    return { messages: own, ...(mark && { mark }) }
  }

  const columns: Column[] = []
  const chapters: Chapter[] = []
  let x = LABEL_W
  model.chapters.forEach((chapter, ci) => {
    if (ci > 0) x += CHAPTER_GAP
    const start = x
    for (const slice of chapter.slices) {
      const w = columnWidth(slice)
      columns.push({
        index: columns.length,
        chapter: ci,
        slice,
        label: labelOf(slice),
        title: words(labelOf(slice)),
        note: gravest(slice.notes),
        ...marked(messages.filter((m) => m.slice === slice.id)),
        x,
        w,
      })
      x += w
    }
    if (chapter.slices.length === 0) x += COL_W
    // Assembly leaves the slices in no chapter in a nameless one, last, which has no heading.
    chapters.push({
      name: chapter.name,
      title: words(chapter.name),
      x: start,
      w: x - start,
    })
  })
  // A loose element gets its own column after the story, in a nameless chapter.
  if (model.loose && model.loose.length > 0) {
    if (chapters.length > 0) x += CHAPTER_GAP
    const start = x
    for (const item of model.loose) {
      const el = parse(item.element)
      const card =
        item.kind === "event"
          ? { events: [item.element] }
          : item.kind === "external"
            ? { external_event: item.element }
            : item.kind === "command"
              ? { command: item.element }
              : { read_models: [item.element] }
      const slice: BoardSlice = {
        name: el.name,
        actor: item.actor ?? "",
        aggregate: item.aggregate,
        tests: [],
        ...card,
      }
      columns.push({
        index: columns.length,
        chapter: chapters.length,
        slice,
        label: el.name,
        title: words(el.name),
        note: gravest(model.notes[el.name]),
        ...marked(messages.filter((m) => m.slice === undefined && m.element === el.name)),
        x,
        w: COL_W,
      })
      x += COL_W
    }
    chapters.push({ name: "", title: "", x: start, w: x - start })
  }

  // Draw each element in full once; later cards link back to it.
  const first = new Map<string, Placed>()
  // A screen shows in every slice that names it; its notes go beside the first.
  const screensNoted = new Set<string>()
  let next = 0
  const make = (
    column: number,
    kind: Kind,
    el: Element,
    extra: {
      detail?: string
      compact?: boolean
      reference?: boolean
      form?: string[]
      button?: string
      table?: string[]
      tableRows?: 1
      /** A screen's notes: its name may be its method's, which a command shares. */
      notes?: Note[]
    } = {},
  ): Placed => {
    const key = `${kind === "external" ? "event" : kind}:${el.name}`
    const colW = columns[column]?.w ?? COL_W
    const earlier = extra.reference ? undefined : first.get(key)
    const mark = markOf(columns[column]?.messages.filter((m) => m.element === el.name) ?? [])
    const w = extra.reference ? REF_W : CARD_W
    const box: Placed = {
      id: `b${next++}`,
      kind,
      name: el.name,
      title: titled(el, w - (mark ? MARK_GAP + 2 * MARK_R : 0), earlier !== undefined, measure),
      fields: el.fields,
      keys: el.keys,
      ...(el.list && { list: true }),
      ...(extra.detail === undefined || extra.compact || earlier ? {} : { detail: extra.detail }),
      ...(extra.form === undefined ? {} : { form: extra.form }),
      ...(extra.button === undefined ? {} : { button: extra.button }),
      ...(extra.table === undefined
        ? {}
        : {
            table: extra.table,
            ...(extra.tableRows && { tableRows: extra.tableRows }),
            tableColumns: fitColumns(extra.table, CARD_W - 2 * PAD, measure).columns,
            tableMore: fitColumns(extra.table, CARD_W - 2 * PAD, measure).more,
          }),
      ...(extra.compact || earlier ? { compact: true } : {}),
      ...(earlier ? { canonical: earlier.id } : {}),
      ...(mark && { mark }),
      column,
      dx: extra.reference ? colW - 10 - w : (colW - w) / 2,
      w,
      h: 0,
    }
    box.h = face(box).h
    // An element's notes go on its first card; a gear is the slice's, not an element.
    const own =
      box.compact || kind === "automation"
        ? undefined
        : kind === "ui"
          ? extra.notes
          : model.notes[el.name]
    if (own) box.notes = stickies(own, 0, words(el.name), measure)
    if (!extra.reference && kind !== "ui" && !first.has(key)) first.set(key, box)
    return box
  }

  // Each row is as tall as its tallest stack of cards. A stack is tiers, each of cards side by side.
  const slots = new Map<string, Placed[][][]>()
  const into = (slot: string, column: number, ...tier: Placed[]) => {
    if (tier.length === 0) return
    const stacks = slots.get(slot) ?? columns.map((): Placed[][] => [])
    slots.set(slot, stacks)
    if (tier.length > 1) {
      const room = columns[column]?.w ?? COL_W
      const start = (room - tier.length * CARD_W - (tier.length - 1) * STACK_GAP) / 2
      tier.forEach((b, j) => {
        b.dx = start + j * (CARD_W + STACK_GAP)
      })
    }
    stacks[column]?.push(tier)
  }
  const edges: Edge[] = []
  const edge = (from: Placed, to: Placed, dashed = false) =>
    edges.push({ from: from.id, to: to.id, dashed, points: [] })
  const actorIds: string[] = []
  const useActor = (id: string) => {
    if (!actorIds.includes(id)) actorIds.push(id)
  }
  const eventBoxes = new Map<string, Placed[]>()
  const targets = new Map<number, Placed>()
  const consumers = new Map<number, { command?: Placed; gear?: Placed }>()
  const readLinks: { name: string; column: number; polls: boolean }[] = []

  for (const col of columns) {
    const s = col.slice
    const i = col.index
    const uis: Placed[] = []
    let external: Placed | undefined
    let command: Placed | undefined
    let gear: Placed | undefined
    const readModels: Placed[] = []
    const events: Placed[] = []
    const calls: Placed[] = []

    // The service handles the command and serves the view; the screen shows only its name and form.
    const slash = s.ui?.indexOf("/") ?? -1
    const service = s.ui && slash >= 0 ? { detail: s.ui.slice(0, slash) } : {}
    // A screen in each actor's lane.
    if (s.ui) {
      const method = s.ui.slice(slash + 1)
      // The wireframe is the command's form or the view's table.
      const commandFields = s.command ? parse(s.command).fields : []
      const view = s.read_models?.[0] ? parse(s.read_models[0]) : undefined
      const one = view !== undefined && view.keys.length === 0 && !view.list
      const screenNotes =
        s.screen && !screensNoted.has(s.screen) ? model.notes[s.screen] : undefined
      if (screenNotes && s.screen) screensNoted.add(s.screen)
      for (const actor of s.actors ?? [s.actor]) {
        const ui = make(
          i,
          "ui",
          { name: s.screen ?? method, fields: s.context ?? [], keys: [] },
          {
            form: s.command ? commandFields : (s.context ?? []),
            ...(s.command ? { button: parse(s.command).name } : {}),
            ...(view === undefined ? {} : { table: view.fields }),
            ...(one && { tableRows: 1 as const }),
            ...(screenNotes && { notes: screenNotes }),
          },
        )
        uis.push(ui)
        into(`actor:${actor}`, i, ui)
        useActor(actor)
      }
    }
    // An external event a call already ended in triggers from there, as an event does.
    const called = s.external_event && eventBoxes.has(parse(s.external_event).name)
    if (s.external_event && !called) {
      external = make(i, "external", parse(s.external_event))
      into(`actor:${s.actor}`, i, external)
      useActor(s.actor)
    }
    if (s.automation) {
      gear = make(i, "automation", { name: s.automation, fields: [], keys: [] })
      into(`actor:${s.actor}`, i, gear)
      useActor(s.actor)
    } else if (s.external_event && s.command) {
      // A translation needs a gear the JSON does not name.
      gear = make(i, "automation", { name: s.name || "Translate", fields: [], keys: [] })
      into(`actor:${s.runner ?? "system"}`, i, gear)
      useActor(s.runner ?? "system")
    }
    for (const name of s.reads ?? []) readLinks.push({ name, column: i, polls: false })
    if (s.polls) readLinks.push({ name: s.polls, column: i, polls: true })
    for (const rm of s.read_models ?? []) {
      const box = make(i, "readModel", parse(rm), service)
      readModels.push(box)
      into("middle:top", i, box)
    }
    if (s.command) {
      command = make(i, "command", parse(s.command), service)
      into("middle:bottom", i, command)
    }
    for (const ev of s.events ?? []) {
      const box = make(i, "event", parse(ev))
      events.push(box)
      const seen = eventBoxes.get(box.name) ?? []
      seen.push(box)
      eventBoxes.set(box.name, seen)
    }
    into(`stream:${s.aggregate}`, i, ...events)
    // The external event a call ends in, in its system's lane.
    for (const actor of new Set((s.calls ?? []).map((c) => c.actor))) {
      const ended = (s.calls ?? [])
        .filter((c) => c.actor === actor)
        .map((c) => make(i, "external", parse(c.event)))
      calls.push(...ended)
      for (const box of ended) eventBoxes.set(box.name, [...(eventBoxes.get(box.name) ?? []), box])
      into(`actor:${actor}`, i, ...ended)
      useActor(actor)
    }

    if (command) for (const ui of uis) edge(ui, command)
    if (external) {
      const next = gear ?? command
      if (next) edge(external, next)
    }
    if (!command) for (const ui of uis) for (const rm of readModels) edge(rm, ui)
    if (gear && command) edge(gear, command)
    // A call reads command → external event → the event of ours that keeps its answer, so the
    // command points only at the events that keep none.
    const answered = new Set((s.calls ?? []).flatMap((c) => c.kept ?? []))
    if (command) for (const ev of events) if (!answered.has(ev.name)) edge(command, ev)
    if (command) for (const call of calls) edge(command, call)
    for (const c of s.calls ?? [])
      for (const reply of calls.filter((b) => b.name === parse(c.event).name))
        for (const ev of events.filter((e) => c.kept?.includes(e.name))) edge(reply, ev)
    consumers.set(i, { ...(command ? { command } : {}), ...(gear ? { gear } : {}) })

    // What a trigger points at: the automation, or the view it builds.
    const target = gear ?? readModels[0]
    if (target && (s.external_event ? called : s.trigger)) targets.set(i, target)
  }

  // Reads are dashed from the view into the automation, or else the command.
  for (const link of readLinks) {
    const c = consumers.get(link.column)
    const consumer = c?.gear ?? c?.command
    if (!consumer) continue
    const source = first.get(`readModel:${link.name}`)
    if (source) {
      edge(source, consumer, true)
      continue
    }
    const ref = make(
      link.column,
      "readModel",
      registry.get(link.name) ?? { name: link.name, fields: [], keys: [] },
      { compact: true, reference: true },
    )
    into("middle:top", link.column, ref)
    edge(ref, consumer, true)
  }

  // A trigger comes from the event's nearest emission.
  for (const col of columns) {
    const target = targets.get(col.index)
    const trigger = col.slice.trigger ?? col.slice.external_event
    if (!target || !trigger) continue
    const names = (Array.isArray(trigger) ? trigger : [trigger]).map((t) => parse(t).name)
    for (const name of names) {
      const sources = eventBoxes.get(name) ?? []
      const before = sources.filter((b) => b.column < col.index).at(-1)
      const source = before ?? sources[0]
      if (source) edge(source, target)
    }
  }

  const tierHeight = (tier: Placed[]) => Math.max(0, ...tier.map((b) => b.h))
  const stackHeight = (stack: Placed[][]) =>
    stack.reduce((sum, tier) => sum + tierHeight(tier), 0) +
    Math.max(0, stack.length - 1) * STACK_GAP
  const slotHeight = (slot: string) =>
    Math.max(0, ...(slots.get(slot) ?? []).map((stack) => stackHeight(stack)))

  const rows: Row[] = []
  const boxes: Box[] = []
  const place = (slot: string, top: number) => {
    for (const stack of slots.get(slot) ?? []) {
      let y = top
      for (const tier of stack) {
        for (const { dx, ...b } of tier)
          boxes.push({ ...b, x: (columns[b.column]?.x ?? 0) + dx, y })
        y += tierHeight(tier) + STACK_GAP
      }
    }
  }

  // A slice with notes gets a rail beside it, so its notes take width, not height.
  const noted = (col: Column) =>
    col.slice.notes !== undefined ||
    [...slots.values()].some((stacks) =>
      stacks[col.index]?.some((tier) => tier.some((b) => b.notes)),
    )
  const before = columns.map((col) => col.x)
  const rails = columns.filter(noted)
  const shiftAt = (x: number) =>
    rails.filter((col) => (before[col.index] ?? 0) < x).length * (NOTE_W + NOTE_GAP)
  for (const chapter of chapters) {
    const end = chapter.x + chapter.w
    chapter.x += shiftAt(chapter.x)
    chapter.w = end + shiftAt(end) - chapter.x
  }
  const railX = new Map<Column, number>()
  for (const col of columns) {
    col.x += shiftAt(before[col.index] ?? 0)
    if (!rails.includes(col)) continue
    // A note stands NOTE_GAP right of the cards, and the column ends PAD_X after it, as it begins.
    railX.set(col, col.x + col.w - PAD_X + NOTE_GAP)
    col.w += NOTE_W + NOTE_GAP
  }
  const width =
    PAD_X + Math.max(0, ...chapters.map((c) => c.x + c.w), ...columns.map((c) => c.x + c.w))

  // A chapter's notes stand above its band, left to right from its left edge, wrapping within its
  // width; the canvas makes a row for them as tall as the tallest, and none for no notes.
  const top = HEADER_H - ARROW_H - 12
  let above = 0
  for (const at of chapters) {
    const notes = model.notes[at.name]
    if (!notes) continue
    let [x, y, row] = [at.x, top, 0]
    at.notes = stickies(notes, 0, at.title, measure).map((n) => {
      if (x > at.x && x + NOTE_W > at.x + at.w) [x, y, row] = [at.x, y + row + STICKY_GAP, 0]
      const placed = { ...n, x, y }
      x += NOTE_W + STICKY_GAP
      row = Math.max(row, n.h)
      return placed
    })
    above = Math.max(above, y + row - top + NOTE_GAP)
  }

  const nameY = HEADER_H + above

  // A rail lines each note up with the top of what it is about, the slice's with its first card,
  // and pushes a note down only to clear the one above. Returns where the lowest note placed ends.
  const railEnd = new Map<Column, number>()
  for (const col of rails) col.notes = []
  const stack = (col: Column, list: readonly Sticky[], at: number) => {
    const from = Math.max(at, railEnd.get(col) ?? at)
    for (const n of list) {
      col.notes?.push({ ...n, x: railX.get(col) ?? col.x, y: from + n.y })
      railEnd.set(col, from + n.y + n.h + STICKY_GAP)
    }
  }
  const rail = (cards: readonly Box[]) => {
    let end = 0
    for (const b of [...cards].sort((a, b) => a.y - b.y)) {
      const col = columns[b.column]
      if (!col || !railX.has(col)) continue
      if (!railEnd.has(col)) {
        railEnd.set(col, b.y)
        if (col.slice.notes) stack(col, stickies(col.slice.notes, 0, col.title, measure), b.y)
      }
      if (b.notes) stack(col, b.notes, b.y)
      end = Math.max(end, (railEnd.get(col) ?? 0) - STICKY_GAP)
    }
    return end
  }
  // A lane is as tall as its cards, or the notes beside them: nothing overflows its lane.
  const lane = (y: number, h: number, place: () => void) => {
    const from = boxes.length
    place()
    return Math.max(h, rail(boxes.slice(from)) + LANE_PAD - y)
  }
  let y = nameY + NAME_H
  const actors = new Map(model.actors.map((a) => [a.id, a]))
  // Every actor gets a lane, used or not; an outside system's goes beneath our streams.
  const ids = [...model.actors.map((a) => a.id), ...actorIds.filter((id) => !actors.has(id))]
  const outside = (id: string) => actors.get(id)?.type === "external"
  const lanes = (ids: string[]) => {
    for (const id of ids) {
      const slot = `actor:${id}`
      const h = lane(y, slotHeight(slot) + 2 * LANE_PAD, () => place(slot, y + LANE_PAD))
      const actor = actors.get(id)
      const label = id === "system" ? "Automations" : words(actor?.name ?? id)
      const sub =
        id === "system" || actor?.type === "system"
          ? "System"
          : actor?.type === "admin"
            ? "Admin"
            : actor?.type === "external"
              ? "External"
              : "Actor"
      rows.push({ id: slot, label, sub, kind: "actor", y, h })
      y += h
    }
  }
  lanes(ids.filter((id) => !outside(id)))

  const topH = slotHeight("middle:top")
  const bottomH = slotHeight("middle:bottom")
  const gap = topH > 0 && bottomH > 0 ? SLOT_GAP : 0
  const middleH = lane(y, LANE_PAD + topH + gap + bottomH + LANE_PAD, () => {
    place("middle:top", y + LANE_PAD)
    place("middle:bottom", y + LANE_PAD + topH + gap)
  })
  rows.push({ id: "middle", label: "Interaction", kind: "middle", y, h: middleH })
  y += middleH

  // The channel above the streams carries the arrows between columns that no direct route can take.
  const channelTop = y
  for (const agg of model.aggregates) {
    const slot = `stream:${agg.id}`
    const h = lane(y, Math.max(slotHeight(slot), COMPACT_H) + 2 * LANE_PAD, () =>
      place(slot, y + LANE_PAD),
    )
    rows.push({ id: slot, label: words(agg.name), sub: "Stream", kind: "stream", y, h })
    y += h
  }
  lanes(ids.filter(outside))

  // Every arrow takes the direct route, from the side of its source that faces its target to the
  // side of its target that faces it, unless that crosses a card. Then it goes round: in its own
  // column down the side of what stands between, between columns along the channel, each on its own
  // line. Arrows between columns fan out where they share an end, leaving right of centre (or below
  // it) and entering left (or above), so each one can be followed.
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const ends = (e: Edge) => [byId.get(e.from), byId.get(e.to)] as [Box, Box]
  const between = edges.filter((e) => {
    const [a, b] = ends(e)
    return a.column !== b.column
  })
  const fan = (key: "from" | "to", direction: 1 | -1) => {
    const groups = new Map<string, Edge[]>()
    for (const e of between) groups.set(e[key], [...(groups.get(e[key]) ?? []), e])
    return (e: Edge) =>
      groups.has(e[key]) ? direction * (FAN + (groups.get(e[key])?.indexOf(e) ?? 0) * FAN) : 0
  }
  const fanFrom = fan("from", 1)
  const shared = fan("to", -1)
  const entering = apart(edges, byId)
  const fanTo = (e: Edge) => shared(e) || entering(e)
  const cards = (): Rect[] => [
    ...boxes,
    ...columns.flatMap((c) => (c.notes ?? []).map((n) => ({ ...n, w: NOTE_W }))),
  ]
  // The direct routes, in order, each clear of the ones before it.
  const straight = () => {
    const lines: Pt[][] = []
    return new Map(
      edges.map((e) => {
        const route = direct(...ends(e), cards(), lines, fanFrom(e), fanTo(e))
        if (route) lines.push(route)
        return [e, route]
      }),
    )
  }

  // Whether a route crosses a card or another route does not change as everything below the
  // channel moves down together, so the channel is as tall as the arrows that take it, and only those.
  const planned = straight()
  const channelled = between.filter((e) => !planned.get(e))
  const channelH =
    channelled.length > 0 ? 2 * CHANNEL_PAD + (channelled.length - 1) * CHANNEL_STEP : 0
  for (const b of boxes) if (b.y >= channelTop) b.y += channelH
  for (const r of rows) if (r.y >= channelTop) r.y += channelH
  for (const col of columns) for (const n of col.notes ?? []) if (n.y >= channelTop) n.y += channelH
  y += channelH

  const channel = (e: Edge, a: Box, b: Box): Pt[] => {
    const via = channelTop + CHANNEL_PAD + channelled.indexOf(e) * CHANNEL_STEP
    const sx = a.x + a.w / 2 + fanFrom(e)
    const sy = a.y > channelTop ? a.y : a.y + a.h
    const tx = b.x + b.w / 2 + fanTo(e)
    const up: Pt[] = [
      [sx, sy],
      [sx, via],
      [tx, via],
      [tx, b.y + b.h],
    ]
    if (!blocked(up, cards(), [a, b], [])) return up
    const margin = (columns[b.column]?.x ?? 0) + 10 - fanTo(e) - FAN
    const my = b.y + b.h / 2 + fanTo(e) + FAN
    return [
      [sx, sy],
      [sx, via],
      [margin, via],
      [margin, my],
      [b.x, my],
    ]
  }
  const routes = straight()
  for (const e of edges) {
    const [a, b] = ends(e)
    e.points = routes.get(e) ?? (channelled.includes(e) ? channel(e, a, b) : around(a, b, cards()))
  }

  const specs: Spec[] = columns.flatMap((col) => {
    const view = col.slice.command ? undefined : col.slice.read_models?.[0]
    // An empty then says what happens: a state view's screen shows no rows; with no when, nothing.
    const [about, nothing] = view
      ? [parse(view).name, "no rows"]
      : [col.slice.name, "nothing happens"]
    const none: SpecStep = {
      word: "then",
      cards: [{ kind: "description", name: about, lines: [nothing] }],
    }
    return col.slice.tests.map((t) => {
      const steps: [SpecStep["word"], string[]][] = [
        ["given", t.given],
        ["when", t.when ? [t.when] : []],
        ["then", t.then],
      ]
      return {
        column: col.index,
        title: t.name,
        steps: steps
          .filter(([, clauses]) => clauses.length > 0)
          .map(([word, clauses]) => ({
            word,
            cards: clauses.map((clause): SpecCard => {
              const { name, lines, error, described } = parseClause(clause)
              // A view's when is the context its screen asks for.
              const asked = word === "when" && !col.slice.command
              const kind = error
                ? "error"
                : described
                  ? "description"
                  : asked
                    ? "ui"
                    : (kinds.get(name) ?? "command")
              return { kind, name, lines }
            }),
          }))
          .concat(t.then.length === 0 && (view || !t.when) ? [none] : []),
      }
    })
  })

  const placed = new Set(columns.flatMap((c) => c.messages))
  return {
    width,
    height: y + LANE_PAD,
    nameY,
    chapters,
    columns,
    rows,
    boxes,
    edges,
    specs,
    model: marked(messages.filter((m) => !placed.has(m))),
  }
}

/**
 * What is selected: the model's own messages, a chapter, or a slice, within it a card by kind and
 * name, open at full width or not.
 */
export type Selection =
  | "model"
  | { chapter: number }
  | { column: number; kind?: Kind; name?: string; view?: "slice" }

/** A selection as the URL hash, so Back works and every view is a link. */
export function hashOf(sel: Selection | null): string {
  if (!sel) return ""
  if (sel === "model") return "#model"
  if ("chapter" in sel) return `#ch${sel.chapter}`
  const card = sel.kind && sel.name ? `/${sel.kind}/${encodeURIComponent(sel.name)}` : ""
  return `#${sel.view === "slice" ? "s" : "c"}${sel.column}${card}`
}

export function fromHash(hash: string): Selection | null {
  if (hash === "#model") return "model"
  const chapter = hash.match(/^#ch(\d+)$/)
  if (chapter) return { chapter: Number(chapter[1]) }
  const m = hash.match(/^#([cs])(\d+)(?:\/(\w+)\/(.*))?$/)
  if (!m) return null
  return {
    column: Number(m[2]),
    ...(m[1] === "s" && { view: "slice" as const }),
    ...(m[3] && m[4] && { kind: m[3] as Kind, name: decodeURIComponent(m[4]) }),
  }
}

/** The card a selection names, if it is drawn. */
export function boxOf(layout: Layout, sel: Selection | null): Box | undefined {
  if (!sel || sel === "model" || !("column" in sel) || !sel.name) return undefined
  return layout.boxes.find(
    (b) => b.column === sel.column && b.kind === sel.kind && b.name === sel.name,
  )
}

/** A step of the header's path to what is selected, and what a click on it selects. */
export interface Crumb {
  level: "model" | "chapter" | "slice" | "card"
  text: string
  to: Selection | null
}

/**
 * The model's name, then the selected chapter, or the selected slice's chapter, the slice and the
 * selected card's element, as words. A slice in no chapter skips it.
 */
export function crumbs(name: string, layout: Layout | null, sel: Selection | null): Crumb[] {
  const path: Crumb[] = [{ level: "model", text: name, to: null }]
  if (!layout || !sel || sel === "model") return path
  const column = "column" in sel ? layout.columns[sel.column] : undefined
  const chapter = "chapter" in sel ? sel.chapter : column?.chapter
  const title = chapter === undefined ? undefined : layout.chapters[chapter]?.title
  if (chapter !== undefined && title) path.push({ level: "chapter", text: title, to: { chapter } })
  if (!column || !("column" in sel)) return path
  const view = sel.view ? { view: sel.view } : {}
  path.push({ level: "slice", text: column.title, to: { column: column.index, ...view } })
  const box = boxOf(layout, sel)
  if (box) path.push({ level: "card", text: words(box.name), to: sel })
  return path
}

/** The edges that come from or go to another chapter, which focusing `chapter` dims. */
export function outside(layout: Layout, chapter: number): Set<number> {
  const chapterOf = new Map(layout.boxes.map((b) => [b.id, layout.columns[b.column]?.chapter]))
  const inside = (id: string) => chapterOf.get(id) === chapter
  return new Set(layout.edges.flatMap((e, i) => (inside(e.from) && inside(e.to) ? [] : [i])))
}

/** How far a fitted selection zooms at most: its card text at 1.25 times its size. */
export const MAX_ZOOM = 1.25
/** Room left between a fitted selection and the viewport's edges. */
export const FIT_MARGIN = 24

/** What the canvas fits and fades the other lanes for: a slice, or a chapter, all its slices and its notes. */
export type Scope = { column: number } | { chapter: number }

/** A scope's slices, and what else it draws: a chapter's band and the notes above it. */
function scoped(layout: Layout, scope: Scope) {
  if ("column" in scope) {
    const col = layout.columns[scope.column]
    return { columns: col ? [col] : [], extra: [] }
  }
  const band = { y: layout.nameY - ARROW_H - 12, h: ARROW_H }
  return {
    columns: layout.columns.filter((c) => c.chapter === scope.chapter),
    extra: [band, ...(layout.chapters[scope.chapter]?.notes ?? [])],
  }
}

/**
 * A scope's extent, as its outline draws it: its slices side by side, from their names, or the
 * chapter's notes and band above them, down to their bottom-most card or rail note.
 */
export function bounds(layout: Layout, scope: Scope) {
  const { columns, extra } = scoped(layout, scope)
  if (columns.length === 0) return undefined
  const inside = new Set(columns.map((c) => c.index))
  const items = [
    { y: layout.nameY, h: NAME_H },
    ...layout.boxes.filter((b) => inside.has(b.column)),
    ...columns.flatMap((c) => c.notes ?? []),
    ...extra,
  ]
  const x = Math.min(...columns.map((c) => c.x))
  const y = Math.min(...items.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...columns.map((c) => c.x + c.w)) - x,
    h: Math.max(...items.map((b) => b.y + b.h)) - y,
  }
}

/** The view that fits a scope top to bottom in a viewport, centred, never past `MAX_ZOOM`. */
export function fitTo(layout: Layout, scope: Scope, viewport: { w: number; h: number }) {
  const b = bounds(layout, scope)
  if (!b) return undefined
  const k = Math.min(
    MAX_ZOOM,
    (viewport.h - 2 * FIT_MARGIN) / b.h,
    (viewport.w - 2 * FIT_MARGIN) / b.w,
  )
  return {
    x: viewport.w / 2 - k * (b.x + b.w / 2),
    y: viewport.h / 2 - k * (b.y + b.h / 2),
    k,
  }
}

/** The lanes a scope's slices have a card in. */
export function usedLanes(layout: Layout, scope: Scope): Set<string> {
  const inside = new Set(scoped(layout, scope).columns.map((c) => c.index))
  const cards = layout.boxes.filter((b) => inside.has(b.column))
  return new Set(
    layout.rows.filter((r) => cards.some((b) => b.y >= r.y && b.y < r.y + r.h)).map((r) => r.id),
  )
}

/**
 * Who acts in a slice, as words: who sees it, or the machine of ours that runs it. A translation is
 * run by one of ours, from the External System its event comes from.
 */
export function actorOf(model: Board, s: BoardSlice): { actor: string; from?: string } {
  const name = (id: string) =>
    model.actors.find((a) => a.id === id)?.name ?? (id === "system" ? "System" : undefined)
  const named = (ids: string[]) =>
    ids
      .flatMap((id) => {
        const found = name(id)
        return found === undefined ? [] : [words(found)]
      })
      .join(", ")
  if (s.external_event) return { actor: named([s.runner ?? "system"]), from: named([s.actor]) }
  return { actor: named(s.actors ?? [s.actor]) }
}

/** The service method a slice is served by, `Service/Method`; one with no `.service()` has none. */
export const served = (s: BoardSlice): string | undefined =>
  s.ui?.includes("/") ? s.ui : undefined

/** The strongest of the messages: an error, else a warning, else none. */
export function markOf(messages: readonly Message[]): Mark | undefined {
  if (messages.some((m) => m.kind === "error")) return "error"
  return messages.length > 0 ? "warning" : undefined
}

/**
 * The messages under the element each is about, with its kind as drawn: errors first, then the
 * order given. A message about no element, or one not drawn, has no kind.
 */
export function grouped(
  messages: readonly Message[],
  boxes: readonly Box[],
): { element: string; kind?: Kind; messages: Message[] }[] {
  const rank = (m: Message) => (m.kind === "error" ? 0 : 1)
  const groups = new Map<string, Message[]>()
  for (const m of [...messages].sort((a, b) => rank(a) - rank(b)))
    groups.set(m.element, [...(groups.get(m.element) ?? []), m])
  return [...groups].map(([element, messages]) => {
    // An automation is named after its slice, so a declaration of that name is what is meant.
    const named = boxes.filter((b) => b.name === element)
    const kind = (named.find((b) => b.kind !== "automation") ?? named[0])?.kind
    return { element, ...(kind && { kind }), messages }
  })
}

/**
 * A message in the viewer's words, less the element's name its group shows, cut where its fields
 * are named so they can be set apart.
 */
export function wording(m: Message): { text: string; field?: true }[] {
  const said = m.ui ?? m.message
  const named = `${words(m.element)}: `
  const problem = m.element !== "" && said.startsWith(named) ? said.slice(named.length) : said
  const fields = m.fields ?? []
  if (fields.length === 0) return [{ text: problem }]
  const at = new RegExp(`\\b(${fields.join("|")})\\b`)
  return problem
    .split(at)
    .filter((text) => text !== "")
    .map((text) => (fields.includes(text) ? { text, field: true } : { text }))
}

/**
 * Where E (errors) or W (warnings) goes from `at`: the next slice with one of that kind, or with -1 the
 * one before, wrapping. The model's own come first.
 */
export function nextMark(
  layout: Layout,
  kind: "error" | "warning",
  at: number | "model" | null,
  delta: 1 | -1,
): number | "model" | undefined {
  const MODEL = -1
  const has = (messages: readonly Message[]) => messages.some((m) => m.kind === kind)
  const stops = [
    ...(has(layout.model.messages) ? [MODEL] : []),
    ...layout.columns.filter((c) => has(c.messages)).map((c) => c.index),
  ]
  const here = at === "model" ? MODEL : (at ?? (delta > 0 ? -Infinity : Infinity))
  const stop =
    delta > 0
      ? (stops.find((s) => s > here) ?? stops[0])
      : (stops.findLast((s) => s < here) ?? stops.at(-1))
  return stop === MODEL ? "model" : stop
}
