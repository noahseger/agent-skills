// The assembled JSON -> positioned boxes and the edges between them. Pure, so
// node --test covers it without a browser; the Vue components only draw it.
//
// The canvas is the one from eventmodeling.org. Time runs left to right, one
// column per slice, chapters in order. Actors are lanes along the top with
// their screens and the events that arrive from outside. Commands, read models
// and automations sit in the middle. Each stream is a lane at the bottom that
// holds its events.
import type { ModelJson, SliceJson } from "../../src/json.ts"

export type Kind = "ui" | "external" | "command" | "event" | "readModel" | "automation"

export interface Box {
  id: string
  kind: Kind
  /** The declaration's name; a ui card is named by its service method. */
  name: string
  fields: string[]
  keys: string[]
  /** A second line under the name: the service of a ui card. */
  detail?: string
  /** A reference to a read model declared elsewhere: name only. */
  compact?: boolean
  column: number
  x: number
  y: number
  w: number
  h: number
}

export interface Edge {
  from: string
  to: string
  dashed: boolean
  /** The y of a horizontal run through the channel, for an edge between columns. */
  via?: number
}

export interface Row {
  id: string
  label: string
  kind: "actor" | "middle" | "stream"
  y: number
  h: number
}

export interface Column {
  index: number
  chapter: number
  slice: SliceJson
  x: number
  w: number
}

export interface Chapter {
  name: string
  x: number
  w: number
}

export interface Layout {
  width: number
  height: number
  /** Where the slice names go, under the chapter header. */
  nameY: number
  chapters: Chapter[]
  columns: Column[]
  rows: Row[]
  boxes: Box[]
  edges: Edge[]
}

export const COL_W = 208
export const CARD_W = 168
export const LABEL_W = 132
export const HEADER_H = 48
export const NAME_H = 26
export const CHAPTER_GAP = 40
export const LANE_PAD = 16
export const STACK_GAP = 12
export const SLOT_GAP = 32
export const TITLE_H = 30
export const FIELD_H = 15
export const COMPACT_H = 34
export const CHANNEL_PAD = 10
export const CHANNEL_STEP = 7
export const CORNER = 8

const PAD_X = (COL_W - CARD_W) / 2

export interface Element {
  name: string
  fields: string[]
  keys: string[]
}

/** `Name(a, *b)` -> the name, the fields, and the key columns marked `*`. */
export function parse(element: string): Element {
  const open = element.indexOf("(")
  if (open < 0) return { name: element.trim(), fields: [], keys: [] }
  const name = element.slice(0, open).trim()
  const raw = element
    .slice(open + 1, element.lastIndexOf(")"))
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
  return {
    name,
    fields: raw.map((f) => f.replace(/^\*/, "")),
    keys: raw.filter((f) => f.startsWith("*")).map((f) => f.slice(1)),
  }
}

export function cardHeight(box: Pick<Box, "fields" | "detail" | "compact">): number {
  if (box.compact) return COMPACT_H
  const detail = box.detail === undefined ? 0 : 14
  return TITLE_H + detail + box.fields.length * FIELD_H + (box.fields.length > 0 ? 10 : 6)
}

/**
 * An SVG path from the edge of one box to the edge of another. With `via` it
 * runs vertically to that y, across, and vertically again, with rounded
 * corners; that keeps an edge between columns out of the cards in between.
 */
export function path(a: Box, b: Box, via?: number): string {
  const up = a.y > b.y
  const sx = a.x + a.w / 2
  const sy = up ? a.y : a.y + a.h
  const tx = b.x + b.w / 2
  const ty = up ? b.y + b.h : b.y
  if (Math.abs(sx - tx) < 1) return `M${sx} ${sy} L${tx} ${ty}`
  if (via === undefined || Math.abs(sx - tx) < 2 * CORNER) {
    const dy = (ty - sy) / 2
    return `M${sx} ${sy} C${sx} ${sy + dy} ${tx} ${ty - dy} ${tx} ${ty}`
  }
  const dx = tx > sx ? 1 : -1
  const dy = via > sy ? 1 : -1
  return [
    `M${sx} ${sy}`,
    `L${sx} ${via - dy * CORNER}`,
    `Q${sx} ${via} ${sx + dx * CORNER} ${via}`,
    `L${tx - dx * CORNER} ${via}`,
    `Q${tx} ${via} ${tx} ${via + dy * CORNER}`,
    `L${tx} ${ty}`,
  ].join(" ")
}

type Placed = Omit<Box, "x" | "y">

export function layout(model: ModelJson): Layout {
  // A `reads` entry is a name. Its fields come from where the read model is drawn in full.
  const registry = new Map<string, Element>()
  for (const chapter of model.chapters) {
    for (const slice of chapter.slices) {
      for (const rm of slice.read_models ?? []) {
        const el = parse(rm)
        if (!registry.has(el.name)) registry.set(el.name, el)
      }
    }
  }

  const columns: Column[] = []
  const chapters: Chapter[] = []
  let x = LABEL_W
  model.chapters.forEach((chapter, ci) => {
    if (ci > 0) x += CHAPTER_GAP
    const start = x
    for (const slice of chapter.slices) {
      columns.push({ index: columns.length, chapter: ci, slice, x, w: COL_W })
      x += COL_W
    }
    if (chapter.slices.length === 0) x += COL_W
    chapters.push({ name: chapter.name, x: start, w: x - start })
  })
  const width = x + PAD_X

  let next = 0
  const make = (
    column: number,
    kind: Kind,
    el: Element,
    extra: { detail?: string; compact?: boolean } = {},
  ): Placed => {
    const box: Placed = {
      id: `b${next++}`,
      kind,
      name: el.name,
      fields: el.fields,
      keys: el.keys,
      ...extra,
      column,
      w: CARD_W,
      h: 0,
    }
    box.h = cardHeight(box)
    return box
  }

  // Every card is planned into a slot; the rows get their heights from the
  // tallest stack, then the cards get their y.
  const slots = new Map<string, Placed[][]>()
  const into = (slot: string, column: number, box: Placed) => {
    const stacks = slots.get(slot) ?? columns.map((): Placed[] => [])
    slots.set(slot, stacks)
    stacks[column]?.push(box)
  }
  const edges: Edge[] = []
  const edge = (from: Placed, to: Placed, dashed = false) =>
    edges.push({ from: from.id, to: to.id, dashed })
  const actorIds: string[] = []
  const eventBoxes = new Map<string, Placed[]>()
  const targets = new Map<number, Placed>()

  for (const col of columns) {
    const s = col.slice
    const i = col.index
    let ui: Placed | undefined
    let external: Placed | undefined
    let command: Placed | undefined
    let gear: Placed | undefined
    const references: Placed[] = []
    const readModels: Placed[] = []
    const events: Placed[] = []

    if (s.ui) {
      const slash = s.ui.indexOf("/")
      const service = slash < 0 ? undefined : s.ui.slice(0, slash)
      const method = slash < 0 ? s.ui : s.ui.slice(slash + 1)
      ui = make(
        i,
        "ui",
        { name: method, fields: s.query ?? [], keys: [] },
        service === undefined ? {} : { detail: service },
      )
      into(`actor:${s.actor}`, i, ui)
      if (!actorIds.includes(s.actor)) actorIds.push(s.actor)
    }
    if (s.external_event) {
      external = make(i, "external", parse(s.external_event))
      into(`actor:${s.actor}`, i, external)
      if (!actorIds.includes(s.actor)) actorIds.push(s.actor)
    }
    for (const name of [...(s.reads ?? []), ...(s.polls ? [s.polls] : [])]) {
      const el = registry.get(name) ?? { name, fields: [], keys: [] }
      const ref = make(i, "readModel", el, { compact: true })
      references.push(ref)
      into("middle:top", i, ref)
    }
    for (const rm of s.read_models ?? []) {
      const box = make(i, "readModel", parse(rm))
      readModels.push(box)
      into("middle:top", i, box)
    }
    if (s.automation) {
      gear = make(i, "automation", { name: s.automation, fields: [], keys: [] })
      into("middle:top", i, gear)
    }
    if (s.command) {
      command = make(i, "command", parse(s.command))
      into("middle:bottom", i, command)
    }
    for (const ev of s.events ?? []) {
      const box = make(i, "event", parse(ev))
      events.push(box)
      into(`stream:${s.aggregate}`, i, box)
      const seen = eventBoxes.get(box.name) ?? []
      seen.push(box)
      eventBoxes.set(box.name, seen)
    }

    if (ui && command) edge(ui, command)
    if (external && command) edge(external, command)
    if (ui && !command) for (const rm of readModels) edge(rm, ui)
    const consumer = gear ?? command
    if (consumer) for (const ref of references) edge(ref, consumer, true)
    if (gear && command) edge(gear, command)
    if (command) for (const ev of events) edge(command, ev)

    // What a trigger points at: the automation, or the read model it builds.
    const target = gear ?? readModels[0]
    if (target && s.trigger && !s.external_event) targets.set(i, target)
  }

  // Triggers point back to where the event was last emitted, or forward to its
  // first emission when the slice comes before it in the story. They cross
  // columns, so they get the channel between the middle row and the streams.
  const crossing: Edge[] = []
  for (const col of columns) {
    const target = targets.get(col.index)
    const trigger = col.slice.trigger
    if (!target || !trigger) continue
    for (const name of (Array.isArray(trigger) ? trigger : [trigger]).map((t) => parse(t).name)) {
      const sources = eventBoxes.get(name) ?? []
      const before = sources.filter((b) => b.column < col.index).at(-1)
      const source = before ?? sources[0]
      if (source) crossing.push({ from: source.id, to: target.id, dashed: false })
    }
  }
  edges.push(...crossing)

  const stackHeight = (stack: Placed[]) =>
    stack.reduce((sum, b) => sum + b.h, 0) + Math.max(0, stack.length - 1) * STACK_GAP
  const slotHeight = (slot: string) =>
    Math.max(0, ...(slots.get(slot) ?? []).map((stack) => stackHeight(stack)))

  const rows: Row[] = []
  const boxes: Box[] = []
  const place = (slot: string, top: (stack: Placed[]) => number) => {
    for (const stack of slots.get(slot) ?? []) {
      let y = top(stack)
      for (const b of stack) {
        boxes.push({ ...b, x: (columns[b.column]?.x ?? 0) + PAD_X, y })
        y += b.h + STACK_GAP
      }
    }
  }

  let y = HEADER_H + NAME_H
  const nameY = HEADER_H
  const actorNames = new Map(model.actors.map((a) => [a.id, a.name]))
  for (const id of actorIds) {
    const slot = `actor:${id}`
    const h = slotHeight(slot) + 2 * LANE_PAD
    rows.push({ id: slot, label: actorNames.get(id) ?? id, kind: "actor", y, h })
    const top = y + LANE_PAD
    place(slot, () => top)
    y += h
  }

  const topH = slotHeight("middle:top")
  const bottomH = slotHeight("middle:bottom")
  const middleH = LANE_PAD + topH + (topH > 0 && bottomH > 0 ? SLOT_GAP : 0) + bottomH + LANE_PAD
  rows.push({ id: "middle", label: "", kind: "middle", y, h: middleH })
  const topEnd = y + LANE_PAD + topH
  place("middle:top", (stack) => topEnd - stackHeight(stack))
  const bottomTop = topEnd + (topH > 0 && bottomH > 0 ? SLOT_GAP : 0)
  place("middle:bottom", () => bottomTop)
  y += middleH

  if (crossing.length > 0) {
    crossing.forEach((e, i) => {
      e.via = y + CHANNEL_PAD + i * CHANNEL_STEP
    })
    y += 2 * CHANNEL_PAD + (crossing.length - 1) * CHANNEL_STEP
  }

  for (const agg of model.aggregates) {
    const slot = `stream:${agg.id}`
    const h = Math.max(slotHeight(slot), COMPACT_H) + 2 * LANE_PAD
    rows.push({ id: slot, label: agg.name, kind: "stream", y, h })
    const top = y + LANE_PAD
    place(slot, () => top)
    y += h
  }

  return { width, height: y + LANE_PAD, nameY, chapters, columns, rows, boxes, edges }
}
