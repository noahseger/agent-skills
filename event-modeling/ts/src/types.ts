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
  /** Set when an external system groups this event. Such an event is never emitted. */
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

export interface StreamData extends Named {
  kind: "stream"
  members: DeclData[]
}

export interface ExternalData extends Named {
  kind: "external"
  events: DeclData[]
}

export interface ChapterData {
  name: string
  slices: SliceData[]
}

export interface ModelData {
  kind: "model"
  name: string
  description: string
  chapters: ChapterData[]
}

export type Exported = DeclData | ActorData | ServiceData | StreamData | ExternalData | ModelData

/** A named thing a module exports, other than the model or a stream. */
export type Declaration = DeclData | ActorData | ServiceData | ExternalData

/** The named, checked model. The render target and the generators read this. */
export interface Assembled {
  model: ModelData
  streams: Map<string, DeclData[]>
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
export type Source = { from: string } | { count: true } | { value: unknown }

/** An event wired into a slice; `mapping` lists only fields not copied by name. */
export interface Flow {
  event: DeclData
  mapping: Record<string, Source>
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
  actor?: ActorData
  query?: Fields
  reads: DeclData[]
  service?: { service: ServiceData; method?: string }
  command?: DeclData
  emits: Flow[]
  /** The automation's trigger, or the events a projection writes from. */
  on: Flow[]
  polls?: DeclData
  projects?: DeclData
  tests: TestData[]
}
