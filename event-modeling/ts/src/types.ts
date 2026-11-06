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

export type DeclKind = "event" | "command" | "readModel"

/** Anything named by its export binding. Assembly fills in `name`. */
export interface Named {
  name?: string
}

export interface DeclData extends Named {
  kind: DeclKind
  /** Insertion order is the field order on the card and in the proto. */
  fields: Fields
  /** Read models only: the columns that identify a row. */
  keys: string[]
  note?: string
  /** Set when the event is a system's we do not own. */
  external?: ExternalData
}

export interface ActorData extends Named {
  kind: "actor"
  icon: "user" | "admin" | "system"
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

/** The named, checked model. The render target and the generators read this. */
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
}

/** A dead end, with the element and slice the viewer marks. */
export interface Warning {
  message: string
  element: string
  slice?: string
}

/** Where a mapping function got one target field from. */
export type Source = { from: string } | { count: true } | { generate: true } | { value: unknown }

/** A declaration a slice uses; `mapping` lists only fields not copied by name. */
export interface Flow {
  decl: DeclData
  mapping: Record<string, Source>
}

/** A function that fills a declaration's fields; run once on probe values. */
export type MapFn = (source: never, helpers: never) => object

/** A declaration called with a function, before a slice knows its source. */
export interface MappedData {
  decl: DeclData
  map: MapFn
}

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
  then: ClauseData[]
}

export interface SliceData {
  /** Given to `m.slice()`, or derived from the command or read model at assembly. */
  name?: string
  note?: string
  /** Who issues the command or reads the view; each has a screen. */
  actors: ActorData[]
  /** Where the actors see it. */
  screen?: ScreenData
  service?: { service: ServiceData; method?: string }
  /** A view's request fields. */
  query?: Fields
  /** The read models a view shows. */
  shows: DeclData[]
  /** What starts an automation: an event, or a to-do list it works through. */
  trigger?: DeclData
  todoList?: DeclData
  /** The read model a state view builds from `events`. */
  projection?: DeclData
  /** In an automation, mapped from the trigger or the to-do row. */
  command?: Flow
  /** What the command's handler reads. */
  readModels: DeclData[]
  /** What the command records; in a projection, what builds the read model. */
  events: Flow[]
  tests: TestData[]
  /** The chapters it joined; assembly allows one. */
  chapters: ChapterData[]
}

/** The events a slice records. A projection records none. */
export function recorded(slice: SliceData): DeclData[] {
  return slice.projection ? [] : slice.events.map((f) => f.decl)
}

/** The events a slice reacts to: its trigger, or what builds its projection. */
export function heard(slice: SliceData): DeclData[] {
  if (slice.projection) return slice.events.map((f) => f.decl)
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
