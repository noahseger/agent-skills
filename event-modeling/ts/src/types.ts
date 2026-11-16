// What assembly reads. The interfaces in index.ts erase to these.
import type { z } from "zod"

export const META = Symbol.for("event-modeling")

// On globalThis, like META, so a model and a CLI holding two copies of the package share it.
const DRAFTS_KEY: unique symbol = Symbol.for("event-modeling.drafts")
const shared = globalThis as { [DRAFTS_KEY]?: Set<SliceData> }
shared[DRAFTS_KEY] ??= new Set()
/** Every chain step nothing has extended yet: the slices, in or out of a chapter. */
export const DRAFTS: Set<SliceData> = shared[DRAFTS_KEY]

export type Fields = Record<string, z.ZodType>

export type DeclKind = "event" | "command" | "view"

/** Anything named by its export binding. Assembly fills in `name`. */
export interface Named {
  name?: string
}

export interface DeclData extends Named {
  kind: DeclKind
  /** Insertion order is the field order on the card and in the proto. */
  fields: Fields
  /** Views only: the columns that identify a row. */
  keys: string[]
  note?: string
  /** Set when the event is a system's we do not own. */
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
  /** The events that joined it, in the order they did. */
  members: DeclData[]
}

export interface ExternalData extends Named {
  kind: "external"
}

export interface ChapterData extends Named {
  kind: "chapter"
  /** How many chapters were declared before it. */
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

/** A named thing a module exports, other than the model, a stream or a chapter. */
export type Declaration = DeclData | ActorData | ServiceData | ScreenData | ExternalData

/** The named, checked model. The spec JSON and the generators read this. */
export interface Assembled {
  model: ModelData
  streams: Map<string, DeclData[]>
  /** In the order declared, each with its slices in the order written. */
  chapters: { name: string; note?: string; slices: SliceData[] }[]
  /** The systems we do not own, by name. Each is a lane, with or without events. */
  externals: string[]
  /** Exported but in no slice. Only a partial assembly keeps them; otherwise one is an error. */
  loose: Declaration[]
  /** Slices in no chapter, likewise. */
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

export type ClauseData = ExampleData | RejectionData

export interface TestData {
  name: string
  given: ExampleData[]
  when?: ExampleData
  /** A state view's `when`: the values its request is asked with. */
  request?: Record<string, unknown>
  then: ClauseData[]
  /** What Zod refused in an example or the request, with where in it. */
  invalid?: { decl: DeclData; message: string }[]
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
  /** A state view's request fields. */
  request?: Fields
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
  /** Each declaration a call took, with the name its `{ Name }` gave; none for a bare declaration. */
  named: [string | undefined, DeclData][]
}

/** The events a slice records. A state view records none. */
export function recorded(slice: SliceData): DeclData[] {
  return slice.view ? [] : slice.events.map((f) => f.decl)
}

/** The fields of `from` a flow takes: by name, by a mapping, or as what a generated value is made from. */
export function taken(flow: Flow, from: DeclData): string[] {
  const { decl, mapping, context } = flow
  const named = Object.keys(decl.fields).filter((f) => !(f in mapping) && context[f] === from)
  const mapped = Object.values(mapping).flatMap((s) => {
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
