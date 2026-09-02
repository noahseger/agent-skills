// The assembled JSON -> positioned boxes and the edges between them. Pure, so
// node --test covers it without a browser; the Vue components only draw it.
//
// The canvas is the one from eventmodeling.org. Time runs left to right, one
// column per slice, chapters in order. Actors are lanes along the top with
// their screens, their automations, and the events that arrive from outside.
// Commands and read models sit in the middle. Each stream is a lane below that
// holds its events, and the specifications sit under the slice they belong to.
import type { ModelJson, SliceJson } from "../../src/json.ts"

export type Kind = "ui" | "external" | "command" | "event" | "readModel" | "automation"
export type Pt = [number, number]

export interface Box {
  id: string
  kind: Kind
  /** The declaration's name; a ui card is named by its service method. */
  name: string
  fields: string[]
  keys: string[]
  /** A second line under the name: the service of a ui card. */
  detail?: string
  /** Name only: a reference to a read model, or a later appearance of an element. */
  compact?: boolean
  /** The first appearance of this element, when this card is a later one. */
  canonical?: string
  /** The element carries a note. */
  noted?: boolean
  /** A screen's wireframe: the inputs it collects, the button it presses, the table it shows. */
  form?: string[]
  button?: string
  table?: string[]
  /** The columns of `table` that fit the card, and how many did not. */
  tableColumns?: { name: string; x: number; w: number }[]
  tableMore?: number
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
  /** The route, corner by corner, for an edge between columns. */
  points?: Pt[]
}

export interface Row {
  id: string
  label: string
  /** What the lane is: Actor, System, or Stream. */
  sub?: string
  kind: "actor" | "middle" | "stream" | "specs"
  y: number
  h: number
}

export interface Column {
  index: number
  chapter: number
  slice: SliceJson
  /** The slice's name, or the name of what it is about. */
  label: string
  noted: boolean
  x: number
  w: number
}

export interface Chapter {
  name: string
  x: number
  w: number
}

export interface SpecCard {
  kind: Kind | "error"
  name: string
  /** One `field = value` per line. */
  lines: string[]
  x: number
  y: number
  w: number
  h: number
}

export interface SpecStep {
  word: "given" | "when" | "then"
  y: number
  cards: SpecCard[]
}

export interface Spec {
  column: number
  title: string[]
  x: number
  y: number
  w: number
  h: number
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
export const FIELD_H = 15
export const COMPACT_H = 34
export const CHANNEL_PAD = 10
export const CHANNEL_STEP = 7
export const CORNER = 12
export const FAN = 8
export const INPUT_H = 22
export const BUTTON_H = 28
export const TABLE_H = 52
export const TABLE_CHAR = 5.2
export const TABLE_PAD = 12
export const TABLE_MORE_W = 26
export const SPEC_TITLE_LINE = 14
export const SPEC_WORD_H = 20
export const SPEC_CARD_TITLE = 30
export const SPEC_LINE_H = 13
export const SPEC_GAP = 6
export const SPEC_TEST_GAP = 20
export const SPEC_TITLE_CHARS = 26

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

/** `Name(a=1, b=[x, y])` or `Error: message` -> a name and one line per field. */
export function parseClause(clause: string): { name: string; lines: string[]; error: boolean } {
  if (clause.startsWith("Error:")) {
    return { name: "Rejected", lines: [clause.slice("Error:".length).trim()], error: true }
  }
  const open = clause.indexOf("(")
  if (open < 0) return { name: clause.trim(), lines: [], error: false }
  const lines: string[] = []
  let depth = 0
  let current = ""
  for (const ch of clause.slice(open + 1, clause.lastIndexOf(")"))) {
    if (ch === "[") depth++
    if (ch === "]") depth--
    if (ch === "," && depth === 0) {
      lines.push(current)
      current = ""
    } else current += ch
  }
  if (current.trim().length > 0) lines.push(current)
  return {
    name: clause.slice(0, open).trim(),
    lines: lines.map((l) => l.trim().replace("=", " = ")),
    error: false,
  }
}

/** Word wrap by character count. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line.length > 0 && line.length + 1 + word.length > max) {
      lines.push(line)
      line = word
    } else line = line.length > 0 ? `${line} ${word}` : word
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** As many columns as fit the width, left to right, leaving room for a `+n`. */
export function fitColumns(
  names: string[],
  width: number,
): { columns: { name: string; x: number; w: number }[]; more: number } {
  const columns: { name: string; x: number; w: number }[] = []
  let x = 0
  for (let i = 0; i < names.length; i++) {
    const name = names[i] ?? ""
    const w = name.length * TABLE_CHAR + TABLE_PAD
    const limit = i < names.length - 1 ? width - TABLE_MORE_W : width
    if (columns.length > 0 && x + w > limit) break
    columns.push({ name, x, w })
    x += w
  }
  return { columns, more: names.length - columns.length }
}

export function cardHeight(
  box: Pick<Box, "kind" | "fields" | "detail" | "compact" | "form" | "button" | "table">,
): number {
  if (box.compact) return COMPACT_H
  const detail = box.detail === undefined ? 0 : 14
  if (box.kind === "ui") {
    const form = (box.form?.length ?? 0) * INPUT_H
    const button = box.button === undefined ? 0 : BUTTON_H
    const table = box.table === undefined ? 0 : TABLE_H
    return TITLE_H + detail + form + button + table + 10
  }
  return TITLE_H + detail + box.fields.length * FIELD_H + (box.fields.length > 0 ? 10 : 6)
}

/** An SVG path from the edge of one box to the edge of another, in one column. */
export function path(a: Box, b: Box): string {
  const up = a.y > b.y
  const sx = a.x + a.w / 2
  const sy = up ? a.y : a.y + a.h
  const tx = b.x + b.w / 2
  const ty = up ? b.y + b.h : b.y
  if (Math.abs(sx - tx) < 1) return `M${sx} ${sy} L${tx} ${ty}`
  const dy = (ty - sy) / 2
  return `M${sx} ${sy} C${sx} ${sy + dy} ${tx} ${ty - dy} ${tx} ${ty}`
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

function labelOf(s: SliceJson): string {
  if (s.name) return s.name
  if (s.command) return parse(s.command).name
  if (s.read_models?.[0]) return parse(s.read_models[0]).name
  if (s.automation) return s.automation
  if (s.ui) return s.ui.slice(s.ui.indexOf("/") + 1)
  if (s.external_event) return parse(s.external_event).name
  return "slice"
}

export function layout(model: ModelJson): Layout {
  // A `reads` entry is a name. Its fields come from where the read model is drawn in full.
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
    }
  }

  const columns: Column[] = []
  const chapters: Chapter[] = []
  let x = LABEL_W
  model.chapters.forEach((chapter, ci) => {
    if (ci > 0) x += CHAPTER_GAP
    const start = x
    for (const slice of chapter.slices) {
      columns.push({
        index: columns.length,
        chapter: ci,
        slice,
        label: labelOf(slice),
        noted: slice.note !== undefined,
        x,
        w: COL_W,
      })
      x += COL_W
    }
    if (chapter.slices.length === 0) x += COL_W
    chapters.push({ name: chapter.name, x: start, w: x - start })
  })
  const width = x + PAD_X

  // The first card of an element is drawn in full. Every later one is the name
  // and a link back, so a read model or an event has one place to be read.
  const first = new Map<string, Placed>()
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
    } = {},
  ): Placed => {
    const key = `${kind === "external" ? "event" : kind}:${el.name}`
    const earlier = extra.reference ? undefined : first.get(key)
    const box: Placed = {
      id: `b${next++}`,
      kind,
      name: el.name,
      fields: el.fields,
      keys: el.keys,
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
      ...(extra.form === undefined ? {} : { form: extra.form }),
      ...(extra.button === undefined ? {} : { button: extra.button }),
      ...(extra.table === undefined
        ? {}
        : {
            table: extra.table,
            tableColumns: fitColumns(extra.table, CARD_W - 24).columns,
            tableMore: fitColumns(extra.table, CARD_W - 24).more,
          }),
      ...(extra.compact || earlier ? { compact: true } : {}),
      ...(earlier ? { canonical: earlier.id } : {}),
      ...(model.notes[el.name] === undefined ? {} : { noted: true }),
      column,
      dx: extra.reference ? COL_W - 10 - REF_W : PAD_X,
      w: extra.reference ? REF_W : CARD_W,
      h: 0,
    }
    box.h = cardHeight(box)
    if (!extra.reference && kind !== "ui" && !first.has(key)) first.set(key, box)
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
    let ui: Placed | undefined
    let external: Placed | undefined
    let command: Placed | undefined
    let gear: Placed | undefined
    const readModels: Placed[] = []
    const events: Placed[] = []

    if (s.ui) {
      const slash = s.ui.indexOf("/")
      const service = slash < 0 ? undefined : s.ui.slice(0, slash)
      const method = slash < 0 ? s.ui : s.ui.slice(slash + 1)
      // The screen is drawn from the model: a form for the command it sends, a
      // table for the read model it shows, with the query as its filters.
      const commandFields = s.command ? parse(s.command).fields : []
      const shown = s.read_models?.[0] ? parse(s.read_models[0]).fields : undefined
      ui = make(
        i,
        "ui",
        { name: method, fields: s.query ?? [], keys: [] },
        {
          ...(service === undefined ? {} : { detail: service }),
          form: s.command ? commandFields : (s.query ?? []),
          ...(s.command ? { button: parse(s.command).name } : {}),
          ...(shown === undefined ? {} : { table: shown }),
        },
      )
      into(`actor:${s.actor}`, i, ui)
      useActor(s.actor)
    }
    if (s.external_event) {
      external = make(i, "external", parse(s.external_event))
      into(`actor:${s.actor}`, i, external)
      useActor(s.actor)
    }
    if (s.automation) {
      gear = make(i, "automation", { name: s.automation, fields: [], keys: [] })
      into(`actor:${s.actor}`, i, gear)
      useActor(s.actor)
    }
    for (const name of s.reads ?? []) readLinks.push({ name, column: i, polls: false })
    if (s.polls) readLinks.push({ name: s.polls, column: i, polls: true })
    for (const rm of s.read_models ?? []) {
      const box = make(i, "readModel", parse(rm))
      readModels.push(box)
      into("middle:top", i, box)
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
    if (gear && command) edge(gear, command)
    if (command) for (const ev of events) edge(command, ev)
    consumers.set(i, { ...(command ? { command } : {}), ...(gear ? { gear } : {}) })

    // What a trigger points at: the automation, or the read model it builds.
    const target = gear ?? readModels[0]
    if (target && s.trigger && !s.external_event) targets.set(i, target)
  }

  // What a slice reads is drawn back from the read model's own card, dashed.
  // Only a read model that is never drawn in full gets a reference card.
  const crossing: Edge[] = []
  for (const link of readLinks) {
    const c = consumers.get(link.column)
    const consumer = link.polls ? c?.gear : (c?.command ?? c?.gear)
    if (!consumer) continue
    const source = first.get(`readModel:${link.name}`)
    if (source) {
      crossing.push({ from: source.id, to: consumer.id, dashed: true })
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

  // Triggers point back to where the event was last emitted, or forward to its
  // first emission when the slice comes before it in the story. They cross
  // columns, so they get the channel between the middle row and the streams.
  for (const col of columns) {
    const target = targets.get(col.index)
    const trigger = col.slice.trigger
    if (!target || !trigger) continue
    const names = (Array.isArray(trigger) ? trigger : [trigger]).map((t) => parse(t).name)
    for (const name of names) {
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
      for (const { dx, ...b } of stack) {
        boxes.push({ ...b, x: (columns[b.column]?.x ?? 0) + dx, y })
        y += b.h + STACK_GAP
      }
    }
  }

  let y = HEADER_H + NAME_H
  const nameY = HEADER_H
  const actors = new Map(model.actors.map((a) => [a.id, a]))
  for (const id of actorIds) {
    const slot = `actor:${id}`
    const h = slotHeight(slot) + 2 * LANE_PAD
    const actor = actors.get(id)
    const label = actor?.type === "system" ? "Automations" : (actor?.name ?? id)
    const sub = actor?.type === "user" ? "Actor" : "System"
    rows.push({ id: slot, label, sub, kind: "actor", y, h })
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

  const channelTop = y
  if (crossing.length > 0) y += 2 * CHANNEL_PAD + (crossing.length - 1) * CHANNEL_STEP

  for (const agg of model.aggregates) {
    const slot = `stream:${agg.id}`
    const h = Math.max(slotHeight(slot), COMPACT_H) + 2 * LANE_PAD
    rows.push({ id: slot, label: agg.name, sub: "Stream", kind: "stream", y, h })
    const top = y + LANE_PAD
    place(slot, () => top)
    y += h
  }

  // A crossing edge leaves the top of its event or the bottom of its read
  // model, runs along its own line in the channel, and rises in the target's
  // column: to the bottom of a read model, or up the left margin into the side
  // of a command or an automation. Edges that share an end fan out there, so
  // each one can be followed.
  const byId = new Map(boxes.map((b) => [b.id, b]))
  const fan = (key: "from" | "to") => {
    const groups = new Map<string, Edge[]>()
    for (const e of crossing) groups.set(e[key], [...(groups.get(e[key]) ?? []), e])
    return (e: Edge) => {
      const group = groups.get(e[key]) ?? []
      return (group.indexOf(e) - (group.length - 1) / 2) * FAN
    }
  }
  const fanFrom = fan("from")
  const fanTo = fan("to")
  crossing.forEach((e, i) => {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) return
    const via = channelTop + CHANNEL_PAD + i * CHANNEL_STEP
    const sx = a.x + a.w / 2 + fanFrom(e)
    const sy = a.kind === "event" ? a.y : a.y + a.h
    if (b.kind !== "readModel") {
      const margin = (columns[b.column]?.x ?? 0) + 10 + fanTo(e)
      const my = b.y + b.h / 2 + fanTo(e)
      e.points = [
        [sx, sy],
        [sx, via],
        [margin, via],
        [margin, my],
        [b.x, my],
      ]
    } else {
      const tx = b.x + b.w / 2 + fanTo(e)
      e.points = [
        [sx, sy],
        [sx, via],
        [tx, via],
        [tx, b.y + b.h],
      ]
    }
  })

  // Specifications, under the slice they belong to.
  const specs: Spec[] = []
  const specsTop = y + LANE_PAD
  let specsBottom = specsTop
  for (const col of columns) {
    let sy = specsTop
    for (const t of col.slice.tests) {
      const title = wrap(t.name, SPEC_TITLE_CHARS)
      const spec: Spec = {
        column: col.index,
        title,
        x: col.x + PAD_X,
        y: sy,
        w: CARD_W,
        h: 0,
        steps: [],
      }
      let cy = sy + title.length * SPEC_TITLE_LINE + SPEC_GAP
      const steps: [SpecStep["word"], string[]][] = [
        ["given", t.given],
        ["when", t.when ? [t.when] : []],
        ["then", t.then],
      ]
      for (const [word, clauses] of steps) {
        if (clauses.length === 0) continue
        const step: SpecStep = { word, y: cy, cards: [] }
        cy += SPEC_WORD_H
        for (const clause of clauses) {
          const { name, lines, error } = parseClause(clause)
          const h = lines.length > 0 ? SPEC_CARD_TITLE + lines.length * SPEC_LINE_H + 2 : 24
          step.cards.push({
            kind: error ? "error" : (kinds.get(name) ?? "command"),
            name,
            lines,
            x: spec.x,
            y: cy,
            w: CARD_W,
            h,
          })
          cy += h + SPEC_GAP
        }
        spec.steps.push(step)
      }
      spec.h = cy - sy
      specs.push(spec)
      sy = cy + SPEC_TEST_GAP
    }
    specsBottom = Math.max(specsBottom, sy)
  }
  if (specs.length > 0) {
    const h = specsBottom - specsTop + LANE_PAD
    rows.push({ id: "specs", label: "Specifications", kind: "specs", y, h })
    y += h
  }

  return { width, height: y + LANE_PAD, nameY, chapters, columns, rows, boxes, edges, specs }
}
