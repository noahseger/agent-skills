// What assembly reads. The interfaces in index.ts erase to these.
import type { z } from "zod"

export const META = Symbol.for("event-modeling")

// On globalThis, like META, so a model and a CLI holding two copies of the package share them.
const DRAFTS_KEY: unique symbol = Symbol.for("event-modeling.drafts")
const WRITTEN_KEY: unique symbol = Symbol.for("event-modeling.written")
const REGISTRY_KEY: unique symbol = Symbol.for("event-modeling.registry")
const shared = globalThis as {
  [DRAFTS_KEY]?: Set<SliceData>
  [WRITTEN_KEY]?: Set<Written>
  [REGISTRY_KEY]?: Map<string, Registered>
}
shared[DRAFTS_KEY] ??= new Set()
shared[WRITTEN_KEY] ??= new Set()
shared[REGISTRY_KEY] ??= new Map()
/** Every chain step nothing has extended yet: the slices, in or out of a chapter. */
export const DRAFTS: Set<SliceData> = shared[DRAFTS_KEY]

/** A slice as written: its first step and its calls, made at assembly once every module has run. */
export interface Written {
  start: () => object
  calls: [method: string, args: unknown[]][]
}
/** Every slice written that nothing has extended yet, as `DRAFTS` holds them once made. */
export const WRITTEN: Set<Written> = shared[WRITTEN_KEY]

/** A name and what declares it. */
export interface Registered {
  data: Exported
  /** The call that declared it, as `file:///…/model.ts:12:1`. */
  where: string
  /** Each declaration of the name again, which assembly reports. */
  also: { data: Exported; where: string }[]
}
/** Everything declared since the last assembly, by name, in the order declared. */
export const REGISTRY: Map<string, Registered> = shared[REGISTRY_KEY]

/** The call that declares `name`, for a message: `as` is the m. function the step needs. */
function declaredWith(name: string, as?: string): string {
  if (as === undefined) return `m.event("${name}", { … }), m.command or m.view`
  return ["m.event", "m.command", "m.view", "m.service"].includes(as)
    ? `${as}("${name}", …)`
    : `${as}("${name}")`
}

/**
 * Why a step was left out, such as a `d.Name` that names nothing: the terminal's wording,
 * `lead: rest`, and the viewer's problem. `element` is the name, when there is one.
 */
export class Misstep extends Error {
  readonly element: string
  readonly lead: string
  readonly rest: string
  readonly problem: string
  constructor(element: string, lead: string, rest: string, problem: string) {
    super(lead === "" ? rest : `${lead}: ${rest}`)
    this.element = element
    this.lead = lead
    this.rest = rest
    this.problem = problem
  }
}

/** What `d.Name` names, or why it names nothing. `as` is the m. function that would declare it. */
export function resolve(ref: unknown, as?: string): Exported {
  const name = typeof ref === "function" ? ref.name : undefined
  const found = name === undefined ? undefined : REGISTRY.get(name)
  if (found) return found.data
  if (name === undefined)
    throw new Misstep(
      "",
      "",
      `${String(ref)} is not a declaration. Pass d.Name.`,
      "a step names no element",
    )
  throw new Misstep(
    name,
    `d.${name}`,
    `not declared. Declare it with ${declaredWith(name, as)}.`,
    "not declared",
  )
}

export type Fields = Record<string, z.ZodType>

export type Kind = "event" | "command" | "view"

/** What a note flags: a critical one is drawn red, a question amber, info neutral. */
export type NoteKind = "question" | "critical" | "info"

export interface Note {
  text: string
  kind: NoteKind
}

/** Anything named by the string it is declared with. */
export interface Named {
  name?: string
}

export interface DeclData extends Named {
  kind: Kind
  /** Insertion order is the field order on the card and in the proto. */
  fields: Fields
  /** Views only: the columns rows are looked up by. */
  keys: string[]
  /** A list view: each event adds a row, and a lookup gives every row it matches. */
  list?: true
  notes?: Note[]
  /** The stream it joins, as `.stream()` took it: `d.Name`, found when the model assembles. */
  stream?: object
  /** The system we do not own it comes from, as `.external()` took it. */
  system?: object
  /** That system, once assembly finds it. */
  external?: ExternalData
}

export interface ActorData extends Named {
  kind: "actor"
  icon: "user" | "admin" | "system"
  /** How many actors were declared before it. */
  order: number
  notes?: Note[]
}

export interface ServiceData extends Named {
  kind: "service"
  /** The protobuf package, e.g. todo.v1. */
  pkg: string
  notes?: Note[]
}

export interface ScreenData extends Named {
  kind: "screen"
  notes?: Note[]
}

export interface StreamData extends Named {
  kind: "stream"
  /** How many streams were declared before it. */
  order: number
}

export interface ExternalData extends Named {
  kind: "external"
}

export interface ChapterData extends Named {
  kind: "chapter"
  /** Where it comes in the story, once it has a place. */
  number?: number
  /** How many chapters were declared before it, to order two of one number, or of none. */
  order: number
  notes?: Note[]
}

export interface ModelData {
  kind: "model"
  name: string
  description: string
}

export type Exported =
  | DeclData
  | ActorData
  | ServiceData
  | ScreenData
  | StreamData
  | ExternalData
  | ChapterData
  | ModelData

/** A declaration in a slice, rather than a lane or a heading. */
export type Declaration = DeclData | ActorData | ServiceData | ScreenData | ExternalData

/** The named, checked model. The spec JSON and the generators read this. */
export interface Assembled {
  model: ModelData
  streams: Map<string, DeclData[]>
  /** In the order of their numbers, each with its slices in the order written. */
  chapters: { name: string; notes?: Note[]; slices: SliceData[] }[]
  /** The systems we do not own, by name. Each is a lane, with or without events. */
  externals: string[]
  /** Declared and drawn by no slice: storming, each event, command and view a column of its own. */
  loose: Declaration[]
  /** Slices in no chapter. */
  unchaptered: SliceData[]
  /** Every column in story order: each slice, and each event, command and view in no slice. */
  story: (SliceData | DeclData)[]
  /** The errors and warnings, in the order found. A strict assembly throws its errors instead. */
  messages: Message[]
  /** Each slice's own errors: what checking it alone finds, not what connects it to others. */
  errors: Map<SliceData, Message[]>
}

/**
 * What the modeler is told: an error when data is wrong or has no source, a warning when the model
 * is unfinished but nothing is wrong. The viewer marks its element and slice.
 */
export interface Message {
  kind: "error" | "warning"
  /** The terminal's wording: the element first, then the problem and its fix in code. */
  message: string
  /** The viewer's wording: the element's name as words, then the problem, with no code. */
  ui?: string
  element: string
  /** The id of the slice it is about. */
  slice?: string
  /** The fields of `element` that have no value, when that is the problem. */
  fields?: string[]
}

/**
 * Where a mapping function got one target field from: a field before its step, by name; a constant;
 * or a generated value, with what it is made from: fields by name, or, in a state view, the event by
 * declaration. `built` marks one the mapping computed instead, which is an error.
 */
export type Source =
  | { from: string; decl?: DeclData }
  | { generate: (string | DeclData)[]; built?: true }
  | { value: unknown }

/** What a generated value is made from, by name. */
export const inputNames = (s: { generate: (string | DeclData)[] }): string[] =>
  s.generate.map((i) => (typeof i === "string" ? i : (i.name ?? "")))

/** The fields before a step, each with the declaration it comes from. */
export type Context = Record<string, DeclData>

/**
 * A declaration a slice uses; `mapping` lists only fields not copied by name. A query is one too:
 * the view, whose mapping is the filter, every column it names.
 */
export interface Flow {
  decl: DeclData
  mapping: Record<string, Source>
  /** What its step can read: by name, or in the mapping. */
  context: Context
  /** What its mapping threw, which leaves the mapping empty. */
  threw?: string
}

/** A function that fills a declaration's fields; run once on probe values. */
export type MapFn = (context: never) => object

export interface ExampleData {
  decl: DeclData
  data: Record<string, unknown>
}

export interface RejectionData {
  message: string
}

/** An outcome `then` says in words, beyond what its examples show. */
export interface DescriptionData {
  description: string
}

export type ClauseData = ExampleData | RejectionData | DescriptionData

export interface TestData {
  name: string
  given: ExampleData[]
  when?: ExampleData
  /** A state view's `when`: the values of its context. */
  context?: Record<string, unknown>
  then: ClauseData[]
  /** What Zod refused in an example or the context: where in it, and Zod's message. */
  invalid?: { decl: DeclData; path: string; message: string }[]
  /** A specification written as a function, run at assembly once every module has. */
  later?: () => TestData
  /** What that function threw, which leaves the specification empty. */
  threw?: string
}

export interface SliceData {
  /** Given to `m.slice()`, or derived from the command or view at assembly. */
  name?: string
  /** Where `m.slice()` is called, as `file:line:column`. */
  site?: string
  /** What the JSON and a message about the slice name it by: no other slice has it. Set at assembly. */
  id?: string
  notes?: Note[]
  /** Who issues the command or sees the view; each has a screen. */
  actors: ActorData[]
  /** Where the actors see it. */
  screen?: ScreenData
  /** The machine of ours that runs an automation, or a state view no one sees. */
  system?: ActorData
  service?: { service: ServiceData; method?: string }
  /** A state view's context fields. */
  context?: Fields
  /** What starts an automation: an event, or a view it polls for work. */
  trigger?: DeclData
  polls?: DeclData
  /** The view a state view slice builds from `events` and shows. */
  view?: DeclData
  /** In an automation, mapped from what is before it. */
  command?: Flow
  /** The views the slice queries, in order, each with its filter. */
  reads: Flow[]
  /** How many of `reads` an automation queries before its command: it issues one per row. */
  beforeCommand?: number
  /** What the command records; in a state view, what builds the view. */
  events: Flow[]
  tests: TestData[]
  /** The chapters it joined; assembly allows one. */
  chapters: ChapterData[]
  /** What its calls threw when assembly made it, such as naming what nothing declares. */
  failed?: Misstep[]
}

/** The events a slice records. A state view records none. */
export function recorded(slice: SliceData): DeclData[] {
  return slice.view ? [] : slice.events.map((f) => f.decl)
}

/** The fields of `from` a flow takes: by name, by a mapping, or as what a generated value is made from. */
export function taken(flow: Flow, from: DeclData): string[] {
  const { decl, mapping, context } = flow
  // Recording sets an event's timestamp, so it never takes one by name.
  const own = (f: string) => decl.kind === "event" && f === "timestamp"
  const named = Object.keys(decl.fields).filter(
    (f) => !own(f) && !(f in mapping) && context[f] === from,
  )
  // A whole declaration, returned or spread, also sets fields `decl` does not have.
  const sets = Object.entries(mapping).filter(([f]) => f in decl.fields)
  const mapped = sets.flatMap(([, s]) => {
    if ("from" in s) return origin(flow, s) === from ? [s.from] : []
    if (!("generate" in s)) return []
    return s.generate.flatMap((i) => {
      if (typeof i !== "string") return i === from ? Object.keys(from.fields) : []
      return context[i] === from ? [i] : []
    })
  })
  return [...named, ...mapped]
}

/** The events a slice reacts to: its trigger, or what builds its view. */
export function heard(slice: SliceData): DeclData[] {
  if (slice.view) return slice.events.map((f) => f.decl)
  return slice.trigger ? [slice.trigger] : []
}

const SMALL = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
])

/**
 * `DrawsAndResignation` -> `Draws and Resignation`. Names are code; the picture and its messages
 * show words. An acronym is two capitals or more, so `OAuth` is one word.
 */
export function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(" ")
}

/** `2 errors, 1 warning`: how many of each there are, leaving out a kind there are none of. */
export function counted(errors: number, warnings: number): string {
  const of = (n: number, word: string) => (n === 0 ? [] : [`${n} ${word}${n === 1 ? "" : "s"}`])
  return [...of(errors, "error"), ...of(warnings, "warning")].join(", ")
}

/** `ListCreated` -> `list-created`: an id. */
export function slug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** `base`, or else the first of `base-2`, `base-3`… not taken; which is then taken. */
export function unique(base: string, taken: Set<string>): string {
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

/** The declaration a mapped field came from: the one its mapping read, or the one that carries it by name. */
export const origin = (flow: Flow, s: { from: string; decl?: DeclData }): DeclData | undefined =>
  s.decl ?? flow.context[s.from]
