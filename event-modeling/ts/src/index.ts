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
  META,
  type ModelData,
  type RejectionData,
  type ServiceData,
  type SliceData,
  type Source,
  type StreamData,
  type TestData,
} from "./types.ts"

type Infer<F extends Fields> = { [P in keyof F]: z.infer<F[P]> }
type OneOrMany<T> = T | readonly T[]

/** What a `.emits()` mapping gets as its second argument. */
export interface EmitHelpers {
  /** A value the handler assigns, such as an id or a clock. */
  auto<T>(): T
}

/** What a projection's `.on()` mapping gets as its second argument. */
export interface ProjectionHelpers {
  /** The number of the source's events seen for the row. */
  count(source: object): number
}

/** Fills target fields from the source; the rest copy by name. */
export type Mapping<S extends Fields, T extends Fields> = (
  source: Infer<S>,
  helpers: ProjectionHelpers,
) => Partial<Infer<T>>

type Unfilled<S extends Fields, T extends Fields> = Exclude<keyof T, keyof S> & string

/** Puts the event fields the command lacks into the editor's error, so the fix is in front of you. */
type FilledBy<S extends Fields, T extends Fields> = [Unfilled<S, T>] extends [never]
  ? unknown
  : { readonly "add to the command or set in the mapping": Unfilled<S, T> }

/** A mapping must set every event field the command lacks. */
type FillsRest<S extends Fields, T extends Fields> = (
  source: Infer<S>,
  helpers: EmitHelpers,
) => Pick<Infer<T>, Unfilled<S, T>> & Partial<Infer<T>>

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export interface Example<K extends DeclKind = DeclKind, F extends Fields = Fields> {
  readonly [META]: ExampleData
  readonly __kind: K
  readonly __fields: F
}

export interface Rejection {
  readonly [META]: RejectionData
  readonly __kind: "rejected"
}

export interface Decl<K extends DeclKind, F extends Fields> {
  readonly [META]: DeclData
  readonly __kind: K
  readonly __fields: F
  /** Example data for a given, when or then clause. Zod checks the values. */
  with(data: Partial<Infer<F>>): Example<K, F>
  note(text: string): this
}

export type EventDecl<F extends Fields = Fields> = Decl<"event", F>
export type CommandDecl<F extends Fields = Fields> = Decl<"command", F>
export type ReadModelDecl<F extends Fields = Fields> = Decl<"readModel", F>

function decl<K extends DeclKind, F extends Fields>(kind: K, fields: F): Decl<K, F> {
  const keys = Object.keys(fields).filter((f) => fields[f]?.meta()?.key === true)
  const data: DeclData = { kind, fields, keys }
  const schema = z.object(fields).partial()
  return {
    [META]: data,
    __kind: kind,
    __fields: fields,
    with: (values) => ({
      [META]: { decl: data, data: schema.parse(values) },
      __kind: kind,
      __fields: fields,
    }),
    // Mutating is safe: .note() is called on the declaration before anything else holds it.
    note(text) {
      data.note = text
      return this
    },
  }
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

function reject(message: string): Rejection {
  return { [META]: { message }, __kind: "rejected" }
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping runs once, on probe values, to learn which source fills each field.
const FIELD = Symbol("field")
const COUNT = Symbol("count")
const AUTO = Symbol("auto")

// Each helper returns its marker, so the probe can tell it from a source field or a constant.
const helpers = { count: () => COUNT, auto: () => AUTO }

interface Probe {
  readonly [FIELD]: string
}

function isProbe(value: unknown): value is Probe {
  return typeof value === "object" && value !== null && FIELD in value
}

type MapFn = (source: never, helpers: never) => object

function probe(fields: Fields, map: MapFn): Record<string, Source> {
  const source = Object.fromEntries(Object.keys(fields).map((f) => [f, { [FIELD]: f }]))
  const mapping: Record<string, Source> = {}
  for (const [field, value] of Object.entries(map(source as never, helpers as never))) {
    mapping[field] =
      value === COUNT
        ? { count: true }
        : value === AUTO
          ? { auto: true }
          : isProbe(value)
            ? { from: value[FIELD] }
            : { value }
  }
  return mapping
}

function flow(event: DeclData, sourceFields: Fields, map?: MapFn): Flow {
  return { event, mapping: map ? probe(sourceFields, map) : {} }
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

export interface Spec<C extends Fields, Em extends Fields> {
  given?: OneOrMany<Example<"event">>
  when: Example<"command", C>
  then: OneOrMany<Example<"event", Em> | Rejection>
}

/** A read model cannot reject an event, so a projection's example has no `when`. */
export interface ProjectionSpec<R extends Fields> {
  given: OneOrMany<Example<"event">>
  then: OneOrMany<Example<"readModel", R>>
}

export interface SliceStart extends Unfinished<".actor(), .on(), .polls() or .projects()"> {
  actor(actor: Actor): Acting
  /** Automation: the event starts it. */
  on(event: EventDecl): NeedsCommandOrReads
  /** Automation: works through the read model on its own schedule. */
  polls(readModel: ReadModelDecl): NeedsCommand
  /** State view: events build the read model. */
  projects<R extends Fields>(readModel: ReadModelDecl<R>): Projecting<R>
}

export interface Acting extends Unfinished<".service(), .query() or .reads()"> {
  reads(readModel: ReadModelDecl): ActingRead
  /** The request fields of a view. */
  query(fields: Fields): Querying
  service(service: Service, method?: string): NeedsCommand
}

export interface ActingRead
  extends Unfinished<'.service(Service, "Method") to show data, or .service(Service).command(Command) to change it'> {
  reads(readModel: ReadModelDecl): ActingRead
  service(service: Service): NeedsCommand
  /** With a method this is a view, and may still go on to a command. */
  service(service: Service, method: string): ViewOrCommand
}

export interface Querying extends Unfinished<".reads(ReadModel)"> {
  reads(readModel: ReadModelDecl): NeedsMethod
}

export interface NeedsMethod extends Unfinished<'.service(Service, "Method")'> {
  reads(readModel: ReadModelDecl): NeedsMethod
  service(service: Service, method: string): View
}

export interface View extends Slice {
  note(text: string): View
}

/** `.command(Command)`, or `.command("Name", fields)` to declare it here. */
interface Commands {
  command<C extends Fields>(command: CommandDecl<C>): NeedsEmits<C>
  command<C extends Fields>(name: string, fields: C): NeedsEmits<C>
}

/**
 * `.emits(Event)`, or `.emits("Name", fields)` to declare it here; `Em` is what came before.
 * The compiler reports the last overload that fails, so the common form comes last.
 */
interface Emits<C extends Fields, Em extends Fields> {
  emits<E extends Fields>(name: string, fields: E & FilledBy<C, E>): Complete<C, Em | E>
  emits<E extends Fields>(name: string, fields: E, map: FillsRest<C, E>): Complete<C, Em | E>
  emits<E extends Fields>(event: EventDecl<E> & FilledBy<C, E>): Complete<C, Em | E>
  emits<E extends Fields>(event: EventDecl<E>, map: FillsRest<C, E>): Complete<C, Em | E>
}

export interface ViewOrCommand extends View, Commands {}

export interface NeedsCommand extends Unfinished<".command(Command)">, Commands {}

export interface NeedsCommandOrReads extends NeedsCommand {
  /** What the decision looks at; once per read model. */
  reads(readModel: ReadModelDecl): NeedsCommandOrReads
}

export interface NeedsEmits<C extends Fields>
  extends Unfinished<".emits(Event)">,
    Emits<C, never> {}

export interface Complete<C extends Fields, Em extends Fields> extends Slice, Emits<C, Em> {
  test(name: string, spec: Spec<C, Em>): Complete<C, Em>
  note(text: string): Complete<C, Em>
}

export interface Projecting<R extends Fields> extends Unfinished<".on(Event)"> {
  on<E extends Fields>(event: EventDecl<E>, map?: Mapping<E, R>): Projection<R>
}

export interface Projection<R extends Fields> extends Slice {
  on<E extends Fields>(event: EventDecl<E>, map?: Mapping<E, R>): Projection<R>
  test(name: string, spec: ProjectionSpec<R>): Projection<R>
  note(text: string): Projection<R>
}

function many<T>(clauses: OneOrMany<T> | undefined): T[] {
  if (clauses === undefined) return []
  return Array.isArray(clauses) ? [...(clauses as readonly T[])] : [clauses as T]
}

function testData(name: string, spec: Partial<Spec<Fields, Fields>>): TestData {
  const test: TestData = {
    name,
    given: many(spec.given).map((c) => c[META]),
    then: many(spec.then).map((c) => c[META]),
  }
  if (spec.when) test.when = spec.when[META]
  return test
}

/** A declaration written in place, named by its string. */
function named<K extends DeclKind>(kind: K, name: string, fields: Fields): DeclData {
  const data = decl(kind, fields)[META]
  data.name = name
  return data
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
    actor: (actor: Actor) => next({ actor: actor[META] }),
    query: (fields: Fields) => next({ query: fields }),
    reads: (readModel: ReadModelDecl) => next({ reads: [...data.reads, readModel[META]] }),
    service: (service: Service, method?: string) =>
      next({
        service:
          method === undefined ? { service: service[META] } : { service: service[META], method },
      }),
    command: (command: CommandDecl | string, fields: Fields = {}) =>
      next({
        command: typeof command === "string" ? named("command", command, fields) : command[META],
      }),
    emits: (event: EventDecl | string, ...rest: [map?: MapFn] | [fields: Fields, map?: MapFn]) => {
      const [emitted, map] =
        typeof event === "string"
          ? [named("event", event, rest[0] as Fields), rest[1]]
          : [event[META], rest[0] as MapFn | undefined]
      if (map !== undefined && typeof map !== "function")
        throw new Error(
          "The second argument to .emits() is a function that fills the event's fields. To emit another event, chain another .emits().",
        )
      return next({ emits: [...data.emits, flow(emitted, data.command?.fields ?? {}, map)] })
    },
    on: (event: EventDecl, map?: MapFn) =>
      next({ on: [...data.on, flow(event[META], event[META].fields, map)] }),
    polls: (readModel: ReadModelDecl) => next({ polls: readModel[META] }),
    projects: (readModel: ReadModelDecl) => next({ projects: readModel[META] }),
    test: (name: string, spec: Partial<Spec<Fields, Fields>>) =>
      next({ tests: [...data.tests, testData(name, spec)] }),
    note: (text: string) => next({ note: text }),
  }
}

/** A column of the diagram. Pass a name only when the command's would mislead. */
function slice(name?: string): SliceStart {
  const data: SliceData = { reads: [], emits: [], on: [], tests: [] }
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
  reject,
  external,
  stream,
  slice,
  model,
}
