// Everything a model is written with, under `m`.
// `__kind` and `__fields` exist only for the compiler; assembly reads `META`.
import { z } from "zod"

// One copy of Zod for the model and the package.
export { z }

import {
  type ActorData,
  type ChapterData,
  type DeclData,
  type DeclKind,
  DRAFTS,
  type ExampleData,
  type ExternalData,
  type Fields,
  type Flow,
  type MapFn,
  type MappedData,
  META,
  type ModelData,
  type ServiceData,
  type SliceData,
  type Source,
  type StreamData,
  type TestData,
} from "./types.ts"

type Infer<F extends Fields> = { [P in keyof F]: z.infer<F[P]> }
type OneOrMany<T> = T | readonly T[]

/** What a function gets as its second argument where a command's handler fills an event. */
export interface EmitHelpers {
  /** A value the handler assigns, such as an id or a clock. */
  generate<T>(): T
}

/** What a function gets as its second argument in a projection. */
export interface ProjectionHelpers {
  /** The number of the source's events seen for the row. */
  count(source: object): number
}

/** An automation's command is filled from its trigger with no helpers. */
type NoHelpers = Record<never, never>

type Unfilled<S extends Fields, T extends Fields> = Exclude<keyof T, keyof S> & string

/** Puts the fields the source lacks into the editor's error, so the fix is in front of you. */
type FilledBy<S extends Fields, T extends Fields, From extends string> = [Unfilled<S, T>] extends [
  never,
]
  ? unknown
  : { readonly [K in `add to the ${From} or set in the mapping`]: Unfilled<S, T> }

/** A use where a handler fills the declaration from `S`'s fields. */
export interface Into<S extends Fields, H> {
  readonly source: S
  readonly helpers: H
}

/** A use in a projection, where the event fills `R`'s columns. */
export interface Onto<R extends Fields> {
  readonly readModel: R
}

export type Place = Into<Fields, unknown> | Onto<Fields>

/**
 * The function a declaration with fields `F` is called with, typed by where the slice uses it. A
 * handler's must set every field its source lacks; a projection's sets any columns.
 */
export type Mapper<F extends Fields, P> =
  P extends Onto<infer R>
    ? (event: Infer<F>, helpers: ProjectionHelpers) => Partial<Infer<R>>
    : P extends Into<infer S, infer H>
      ? (source: Infer<S>, helpers: H) => Pick<Infer<F>, Unfilled<S, F>> & Partial<Infer<F>>
      : never

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export interface Example<K extends DeclKind = DeclKind, F extends Fields = Fields> {
  readonly [META]: ExampleData
  readonly __kind: K
  readonly __fields: F
}

/** A declaration called with a function: its use in a slice, filling what does not flow by name. */
export interface Mapped<K extends DeclKind, F extends Fields, P extends Place> {
  readonly [META]: MappedData
  readonly __kind: K
  readonly __fields: F
  readonly __place: P
}

export interface Decl<K extends DeclKind, F extends Fields> {
  /**
   * With data, an example for a given, when or then clause; Zod checks the values. With a function,
   * its use in a slice, filling the fields its source does not carry by name. One signature, not two
   * overloads, so the compiler's error is about the form written. The slice step decides `P`.
   */
  <P extends Place = never>(
    arg: [P] extends [never] ? Partial<Infer<F>> : Mapper<F, P>,
  ): [P] extends [never] ? Example<K, F> : Mapped<K, F, P>
  readonly [META]: DeclData
  readonly __kind: K
  readonly __fields: F
  note(text: string): this
}

export type EventDecl<F extends Fields = Fields> = Decl<"event", F>
export type CommandDecl<F extends Fields = Fields> = Decl<"command", F>
export type ReadModelDecl<F extends Fields = Fields> = Decl<"readModel", F>

function decl<K extends DeclKind, F extends Fields>(kind: K, fields: F): Decl<K, F> {
  const keys = Object.keys(fields).filter((f) => fields[f]?.meta()?.key === true)
  const data: DeclData = { kind, fields, keys }
  const schema = z.object(fields).partial()
  // A function makes a use for a slice; anything else is an example.
  const call = (arg: object): object =>
    typeof arg === "function"
      ? { [META]: { decl: data, map: arg as MapFn } }
      : { [META]: { decl: data, data: schema.parse(arg) }, __kind: kind, __fields: fields }
  const declared = Object.assign(call as Decl<K, F>, {
    [META]: data,
    __kind: kind,
    __fields: fields,
    // Mutating is safe: .note() is called on the declaration before anything else holds it.
    note(text: string) {
      data.note = text
      return declared
    },
  })
  return declared
}

function event<F extends Fields>(fields: F): EventDecl<F> {
  return decl("event", fields)
}

function command<F extends Fields>(fields: F): CommandDecl<F> {
  return decl("command", fields)
}

function readModel<F extends Fields>(fields: F): ReadModelDecl<F> {
  return decl("readModel", fields)
}

/** Marks a read model column as part of the row's identity. */
function key<S extends z.ZodType>(schema: S): S {
  return schema.meta({ key: true })
}

export interface Actor {
  readonly [META]: ActorData
  note(text: string): Actor
}

/** A person; `{ icon: "admin" }` for one with authority; `{ icon: "system" }` for a machine of ours. */
function actor(options: { icon?: "user" | "admin" | "system" } = {}): Actor {
  const data: ActorData = { kind: "actor", icon: options.icon ?? "user" }
  return {
    [META]: data,
    note(text) {
      data.note = text
      return this
    },
  }
}

export interface Service {
  readonly [META]: ServiceData
  note(text: string): Service
}

/** The service is named after its export; this is its protobuf package. */
function service(pkg: string): Service {
  const data: ServiceData = { kind: "service", pkg }
  return {
    [META]: data,
    note(text) {
      data.note = text
      return this
    },
  }
}

export interface Stream {
  readonly [META]: StreamData
}

/** The events and commands drawn in one lane. */
function stream(members: Record<string, EventDecl | CommandDecl>): Stream {
  return { [META]: { kind: "stream", members: Object.values(members).map((d) => d[META]) } }
}

export interface External {
  readonly [META]: ExternalData
}

/** A system we do not own. Its events can be received and never emitted. */
function external<const E extends Record<string, EventDecl>>(events: E): External & E {
  const data: ExternalData = { kind: "external", events: [] }
  for (const [key, event] of Object.entries(events)) {
    event[META].name ??= key
    event[META].external = data
    data.events.push(event[META])
  }
  return { ...events, [META]: data }
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping runs once, on probe values, to learn which source fills each field.
const FIELD = Symbol("field")
const COUNT = Symbol("count")
const GENERATE = Symbol("generate")

// Each helper returns its marker, so the probe can tell it from a source field or a constant.
const helpers = { count: () => COUNT, generate: () => GENERATE }

interface Probe {
  readonly [FIELD]: string
}

function isProbe(value: unknown): value is Probe {
  return typeof value === "object" && value !== null && FIELD in value
}

function probe(fields: Fields, map: MapFn): Record<string, Source> {
  const source = Object.fromEntries(Object.keys(fields).map((f) => [f, { [FIELD]: f }]))
  const mapping: Record<string, Source> = {}
  for (const [field, value] of Object.entries(map(source as never, helpers as never))) {
    mapping[field] =
      value === COUNT
        ? { count: true }
        : value === GENERATE
          ? { generate: true }
          : isProbe(value)
            ? { from: value[FIELD] }
            : { value }
  }
  return mapping
}

type Used = { readonly [META]: DeclData | MappedData }

/** A declaration as a slice uses it: as it is, or called with a function that reads `source`. */
function flow(use: Used, source?: Fields): Flow {
  const data = use[META]
  if (!("map" in data)) return { decl: data, mapping: {} }
  return { decl: data.decl, mapping: probe(source ?? data.decl.fields, data.map) }
}

// ---------------------------------------------------------------------------
// The slice chain
// ---------------------------------------------------------------------------

/** A finished slice: the only thing a chapter accepts. */
export interface Slice {
  readonly [META]: SliceData
}

/** Makes the error in `m.model()`'s chapters name the missing step. */
export interface Unfinished<Next extends string> {
  readonly "finish this slice with": Next
}

/** Exactly one of `then`, the events recorded, or `reject`, why the command is refused. */
export type Spec<C extends Fields, Em extends Fields> = {
  given?: OneOrMany<Example<"event">>
  when: Example<"command", C>
} & ({ then: OneOrMany<Example<"event", Em>>; reject?: never } | { reject: string; then?: never })

/** A read model cannot reject an event, so a projection's example has no `when`. */
export interface ProjectionSpec<R extends Fields> {
  given: OneOrMany<Example<"event">>
  then: OneOrMany<Example<"readModel", R>>
}

type Actors = [Actor, ...Actor[]]

export interface SliceStart
  extends Unfinished<".command(), .view(), .trigger(), .todoList() or .projection()"> {
  /** State change: the command an actor issues, or `.command("Name", fields)` to declare it here. */
  command<C extends Fields>(command: CommandDecl<C>): Handling<C>
  command<C extends Fields>(name: string, fields: C): Handling<C>
  /** View: the read models it shows. */
  view(...readModels: [ReadModelDecl, ...ReadModelDecl[]]): View
  /** Automation: the event that starts it, a translation when the event is external. */
  trigger<E extends Fields>(event: EventDecl<E>): NeedsCommand<E, "trigger">
  /** Automation: the to-do list it works through on its own schedule. */
  todoList<R extends Fields>(readModel: ReadModelDecl<R>): NeedsCommand<R, "to-do list">
  /** State view: the read model that events build. */
  projection<R extends Fields>(readModel: ReadModelDecl<R>): Projecting<R>
}

export interface View extends Slice {
  /** The request fields; without them the request is empty. */
  query(fields: Fields): View
  actor(...actors: Actors): View
  /** A view has no command to name its method after. */
  service(service: Service, method: string): View
  note(text: string): View
}

/** `S` is the trigger's fields or the to-do row's; `From` names which in the editor's error. */
export interface NeedsCommand<S extends Fields, From extends string>
  extends Unfinished<".command(Command)"> {
  /** `.command(Command)`, `.command(Command(map))`, or `.command("Name", fields)` to declare it here. */
  command<C extends Fields>(
    command: (CommandDecl<C> & FilledBy<S, C, From>) | Mapped<"command", C, Into<S, NoHelpers>>,
  ): Deciding<C>
  command<C extends Fields>(name: string, fields: C & FilledBy<S, C, From>): Deciding<C>
}

type Who = "actor" | "system"

/** The next step of a state change (an actor's) or an automation (the system's). */
type After<W extends Who, C extends Fields, Em extends Fields> = [Em] extends [never]
  ? W extends "actor"
    ? Handling<C>
    : Deciding<C>
  : W extends "actor"
    ? StateChange<C, Em>
    : Automation<C, Em>

/** What the command's handler reads and records. */
interface Handles<C extends Fields, Em extends Fields, W extends Who> {
  /** What the handler reads to decide; once per read model. */
  readModel(readModel: ReadModelDecl): After<W, C, Em>
  /**
   * `.event(Event)`, `.event(Event(map))`, or `.event("Name", fields)` to declare it here.
   * The compiler reports the last overload that fails, so the common form comes last.
   */
  event<E extends Fields>(name: string, fields: E & FilledBy<C, E, "command">): After<W, C, Em | E>
  event<E extends Fields>(
    event: (EventDecl<E> & FilledBy<C, E, "command">) | Mapped<"event", E, Into<C, EmitHelpers>>,
  ): After<W, C, Em | E>
}

/** Who issues a state change's command, and the method it goes through. */
interface Issued<C extends Fields, Em extends Fields> {
  actor(...actors: Actors): After<"actor", C, Em>
  /** The method is named after the command unless given. */
  service(service: Service, method?: string): After<"actor", C, Em>
}

export interface Deciding<C extends Fields>
  extends Unfinished<".event(Event)">,
    Handles<C, never, "system"> {}

export interface Handling<C extends Fields>
  extends Unfinished<".event(Event)">,
    Handles<C, never, "actor">,
    Issued<C, never> {}

export interface Automation<C extends Fields, Em extends Fields>
  extends Slice,
    Handles<C, Em, "system"> {
  test(name: string, spec: Spec<C, Em>): Automation<C, Em>
  note(text: string): Automation<C, Em>
}

export interface StateChange<C extends Fields, Em extends Fields>
  extends Slice,
    Handles<C, Em, "actor">,
    Issued<C, Em> {
  test(name: string, spec: Spec<C, Em>): StateChange<C, Em>
  note(text: string): StateChange<C, Em>
}

/** `.event(Event)`, or `.event(Event(map))` to fill columns the event does not carry by name. */
type ProjectedEvent<R extends Fields, E extends Fields> = EventDecl<E> | Mapped<"event", E, Onto<R>>

export interface Projecting<R extends Fields> extends Unfinished<".event(Event)"> {
  event<E extends Fields>(event: ProjectedEvent<R, E>): Projection<R>
}

export interface Projection<R extends Fields> extends Slice {
  event<E extends Fields>(event: ProjectedEvent<R, E>): Projection<R>
  test(name: string, spec: ProjectionSpec<R>): Projection<R>
  note(text: string): Projection<R>
}

function many<T>(clauses: OneOrMany<T> | undefined): T[] {
  if (clauses === undefined) return []
  return Array.isArray(clauses) ? [...(clauses as readonly T[])] : [clauses as T]
}

interface AnySpec {
  given?: OneOrMany<Example>
  when?: Example
  then?: OneOrMany<Example>
  reject?: string
}

function testData(name: string, spec: AnySpec): TestData {
  const test: TestData = {
    name,
    given: many(spec.given).map((c) => c[META]),
    then:
      spec.reject === undefined ? many(spec.then).map((c) => c[META]) : [{ message: spec.reject }],
  }
  if (spec.when) test.when = spec.when[META]
  return test
}

/** A declaration written in place, named by its string. */
function named<K extends DeclKind>(kind: K, name: string, fields: Fields): Flow {
  const data = decl(kind, fields)[META]
  data.name = name
  return { decl: data, mapping: {} }
}

// Each step copies, so a shared chain prefix can start several slices. The
// steps nothing extends are the slices, so assembly finds one in no chapter.
function chain(data: SliceData) {
  DRAFTS.add(data)
  const next = (patch: Partial<SliceData>) => {
    DRAFTS.delete(data)
    return chain({ ...data, ...patch })
  }
  return {
    [META]: data,
    command: (command: Used | string, fields: Fields = {}) =>
      next({
        command:
          typeof command === "string"
            ? named("command", command, fields)
            : flow(command, (data.trigger ?? data.todoList)?.fields),
      }),
    view: (...readModels: ReadModelDecl[]) => next({ shows: readModels.map((r) => r[META]) }),
    trigger: (event: EventDecl) => next({ trigger: event[META] }),
    todoList: (readModel: ReadModelDecl) => next({ todoList: readModel[META] }),
    projection: (readModel: ReadModelDecl) => next({ projection: readModel[META] }),
    readModel: (readModel: ReadModelDecl) =>
      next({ readModels: [...data.readModels, readModel[META]] }),
    // A projection's event is its own source; a handler's source is the command.
    event: (event: Used | string, fields: Fields = {}) =>
      next({
        events: [
          ...data.events,
          typeof event === "string"
            ? named("event", event, fields)
            : flow(event, data.projection ? undefined : (data.command?.decl.fields ?? {})),
        ],
      }),
    query: (fields: Fields) => next({ query: fields }),
    actor: (...actors: Actor[]) =>
      next({ actors: [...data.actors, ...actors.map((a) => a[META])] }),
    service: (service: Service, method?: string) =>
      next({
        service:
          method === undefined ? { service: service[META] } : { service: service[META], method },
      }),
    test: (name: string, spec: AnySpec) => next({ tests: [...data.tests, testData(name, spec)] }),
    note: (text: string) => next({ note: text }),
  }
}

/** A column of the diagram. Pass a name only when the one it would take misleads. */
function slice(name?: string): SliceStart {
  const data: SliceData = { actors: [], shows: [], readModels: [], events: [], tests: [] }
  if (name !== undefined) data.name = name
  return chain(data) as unknown as SliceStart
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** An unfinished slice fails here, naming its missing step. Distributes over an array's union. */
type Finished<S> = S extends Slice
  ? S
  : S extends Unfinished<infer Next>
    ? `finish this slice with ${Next}`
    : Slice

// Generic over the array, so the mapping keeps it an array.
type Slices<T> = { [I in keyof T]: Finished<T[I]> }
type Chapters<C> = { [K in keyof C]: Slices<C[K]> }

export interface Model {
  readonly [META]: ModelData
}

/** Each chapter is named by its key, in timeline order; none while storming. */
function model<const C extends Record<string, readonly unknown[]>>(
  name: string,
  spec: { description?: string; chapters?: C & Chapters<C> } = {},
): Model {
  const chapters = Object.entries(spec.chapters ?? {}).map(
    ([name, slices]): ChapterData => ({
      name,
      slices: (slices as readonly Slice[]).map((s) => s[META]),
    }),
  )
  return { [META]: { kind: "model", name, description: spec.description ?? "", chapters } }
}

export const m = {
  actor,
  service,
  event,
  command,
  readModel,
  key,
  external,
  stream,
  slice,
  model,
}
