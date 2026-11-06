// What the layout draws: the model as columns and lanes, read from the spec JSON by `read.ts`.
// An element is written `Name(field, *key)`, a clause `Name(field=value)` or `Error: reason`.
import type { Source, Warning } from "../../src/types.ts"

export interface BoardTest {
  name: string
  given: string[]
  when: string
  then: string[]
}

export interface BoardSlice {
  name: string
  /** The first of `actors`, or who else starts the slice. */
  actor: string
  /** Every actor with a screen in this slice, when there is more than one. */
  actors?: string[]
  /** The lane of what the slice records. */
  aggregate: string
  /** `Service/Method`, or the method alone; only a slice with an actor has one. */
  ui?: string
  /** The screen the actors see the slice on; several slices can share one. */
  screen?: string
  external_event?: string
  automation?: string
  trigger?: string | string[]
  command?: string
  events?: string[]
  /** The external events the command ends in, each with the system it comes from. */
  calls?: { actor: string; event: string }[]
  reads?: string[]
  read_models?: string[]
  tests: BoardTest[]
  query?: string[]
  polls?: string
  note?: string
  /** Per event or command, the fields a mapping filled and where each came from. */
  mapping?: Record<string, Record<string, Source>>
}

export interface BoardActor {
  id: string
  name: string
  type: "user" | "admin" | "system" | "external"
}

/** A declaration in no slice yet, or an event a slice hears and none records. */
export interface Loose {
  kind: "event" | "external" | "command" | "readModel"
  element: string
  aggregate: string
  /** The system an external event comes from. */
  actor?: string
}

export interface Board {
  name: string
  description?: string
  actors: BoardActor[]
  aggregates: { id: string; name: string }[]
  /** In order; the slices in no chapter come last, in a nameless one. */
  chapters: { name: string; slices: BoardSlice[] }[]
  notes: Record<string, string>
  loose?: Loose[]
  warnings?: Warning[]
}
