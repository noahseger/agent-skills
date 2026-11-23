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
  /** Each call that declared the name again, which assembly reports. */
  also: string[]
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

/** What `d.Name` names, or why it names nothing. `as` is the m. function that would declare it. */
export function resolve(ref: unknown, as?: string): Exported {
  const name = typeof ref === "function" ? ref.name : undefined
  const found = name === undefined ? undefined : REGISTRY.get(name)
  if (found) return found.data
  if (name === undefined) throw new Error(`${String(ref)} is not a declaration: pass d.Name.`)
  throw new Error(`d.${name} is not declared. Declare it with ${declaredWith(name, as)}.`)
}

export type Fields = Record<string, z.ZodType>

export type DeclKind = "event" | "command" | "view"

/** Anything named by the string it is declared with. */
export interface Named {
  name?: string
}

export interface DeclData extends Named {
  kind: DeclKind
  /** Insertion order is the field order on the card and in the proto. */
  fields: Fields
  /** Views only: the columns rows are looked up by. */
  keys: string[]
  /** A list view: each event adds a row, and a lookup gives every row it matches. */
  list?: true
  note?: string
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
  note?: string
}

export interface ServiceData extends Named {
  kind: "service"
  /** The protobuf package, e.g. todo.v1. */
  pkg: string
  note?: string
}

export interface ScreenData extends Named {
  kind: "screen"
  note?: string
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
  note?: string
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
  chapters: { name: string; note?: string; slices: SliceData[] }[]
  /** The systems we do not own, by name. Each is a lane, with or without events. */
  externals: string[]
  /** Declared but in no slice: storming, drawn on its own. */
  loose: Declaration[]
  /** Slices in no chapter, drawn after the chapters with no heading. */
  unchaptered: SliceData[]
  /** The dead ends a partial assembly went on past. Empty otherwise. */
  warnings: Warning[]
  /** Each slice's own dead ends: what checking it alone finds, not what connects it to others. */
  unfinished: Map<SliceData, string[]>
}

/** A dead end, with the element and slice the viewer marks. */
export interface Warning {
  message: string
  element: string
  slice?: string
  /** The fields of `element` that have no value, when that is the dead end. */
  fields?: string[]
}

/**
 * Where a mapping function got one target field from: a field before its step, by name; a constant;
 * or a generated value, with what it is made from: fields by name, or, in a state view, the event by
 * declaration. `built` marks one the mapping computed instead, which is left to do.
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
  /** What Zod refused in an example or the context, with where in it. */
  invalid?: { decl: DeclData; message: string }[]
  /** A specification written as a function, run at assembly once every module has. */
  later?: () => TestData
  /** What that function threw, which leaves the specification empty. */
  threw?: string
}

export interface SliceData {
  /** Given to `m.slice()`, or derived from the command or view at assembly. */
  name?: string
  note?: string
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
  failed?: string[]
}

/** The events a slice records. A state view records none. */
export function recorded(slice: SliceData): DeclData[] {
  return slice.view ? [] : slice.events.map((f) => f.decl)
}

/** The fields of `from` a flow takes: by name, by a mapping, or as what a generated value is made from. */
export function taken(flow: Flow, from: DeclData): string[] {
  const { decl, mapping, context } = flow
  const named = Object.keys(decl.fields).filter((f) => !(f in mapping) && context[f] === from)
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

/** `ListCreated` -> `list-created`: an id. */
export function slug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** The declaration a mapped field came from: the one its mapping read, or the one that carries it by name. */
export const origin = (flow: Flow, s: { from: string; decl?: DeclData }): DeclData | undefined =>
  s.decl ?? flow.context[s.from]
