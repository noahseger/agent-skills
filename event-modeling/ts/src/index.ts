// The vocabulary a model is written in. One export, `m`, so a model file
// imports one name next to `z`.
//
// Every declaration is anonymous: its name is the export binding, read at
// assembly. The `__kind` and `__fields` members exist only for the compiler,
// so a command cannot fill an event's slot and a mapping function is typed by
// the fields on each side. The runtime carries plain records under `META`.
//
// A slice is a chain in the order the work happens. Each step's return type
// offers only the steps that may follow, and a chain that stops early is not a
// `Slice`, so a chapter refuses it.
import { z } from "zod"

import {
  type ActorData,
  type ChapterData,
  type DeclData,
  type DeclKind,
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

/** Fills fields of the target from the source. Fields it does not return flow by name. */
export type Mapping<S extends Fields, T extends Fields> = (source: Infer<S>) => Partial<Infer<T>>

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
    // A note is set once, right after the declaration, so nothing else holds
    // the object yet and mutating it aliases nobody.
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
function external(events: Record<string, EventDecl>): External {
  const data: ExternalData = { kind: "external", events: Object.values(events).map((e) => e[META]) }
  for (const e of data.events) e.external = data
  return { [META]: data }
}

function rejected(message: string): Rejection {
  return { [META]: { message }, __kind: "rejected" }
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping function is called once, when the slice is built, with a probe in
// place of each source field. What it returns says which target fields it
// fills and where each value came from.
const FIELD = Symbol("field")
const COUNT = Symbol("count")

interface Probe {
  readonly [FIELD]: string
}

function isProbe(value: unknown): value is Probe {
  return typeof value === "object" && value !== null && FIELD in value
}

function probe(fields: Fields, map: (source: never) => object): Record<string, Source> {
  const source = Object.fromEntries(Object.keys(fields).map((f) => [f, { [FIELD]: f }]))
  const mapping: Record<string, Source> = {}
  for (const [field, value] of Object.entries(map(source as never))) {
    mapping[field] =
      value === COUNT ? { count: true } : isProbe(value) ? { from: value[FIELD] } : { value }
  }
  return mapping
}

/** The number of the source's events seen for the row. */
function count(_source: object): number {
  return COUNT as unknown as number
}

function flow(event: DeclData, sourceFields: Fields, map?: (source: never) => object): Flow {
  return { event, mapping: map ? probe(sourceFields, map) : {} }
}

// ---------------------------------------------------------------------------
// The slice chain
// ---------------------------------------------------------------------------

/** A finished slice: the only thing a chapter accepts. */
export interface Slice {
  readonly [META]: SliceData
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

export interface SliceStart {
  actor(actor: Actor): Acting
  /** Automation: the event starts it. */
  on(event: EventDecl): NeedsCommandOrReads
  /** Automation: works through the read model on its own schedule. */
  polls(readModel: ReadModelDecl): NeedsCommand
  /** State view: events build the read model. */
  projects<R extends Fields>(readModel: ReadModelDecl<R>): Projecting<R>
}

export interface Acting {
  reads(readModel: ReadModelDecl): ActingRead
  /** The request fields of a view. */
  query(fields: Fields): Querying
  service(service: Service, method?: string): NeedsCommand
}

export interface ActingRead {
  reads(readModel: ReadModelDecl): ActingRead
  service(service: Service): NeedsCommand
  /** With a method this is a view, and may still go on to a command. */
  service(service: Service, method: string): ViewOrCommand
}

export interface Querying {
  reads(readModel: ReadModelDecl): NeedsMethod
}

export interface NeedsMethod {
  reads(readModel: ReadModelDecl): NeedsMethod
  service(service: Service, method: string): View
}

export interface View extends Slice {
  note(text: string): View
}

export interface ViewOrCommand extends View {
  command<C extends Fields>(command: CommandDecl<C>): NeedsEmits<C>
}

export interface NeedsCommand {
  command<C extends Fields>(command: CommandDecl<C>): NeedsEmits<C>
}

export interface NeedsCommandOrReads extends NeedsCommand {
  /** What the decision looks at; once per read model. */
  reads(readModel: ReadModelDecl): NeedsCommandOrReads
}

export interface NeedsEmits<C extends Fields> {
  emits<E extends Fields>(event: EventDecl<E>, map?: Mapping<C, E>): Complete<C, E>
}

export interface Complete<C extends Fields, Em extends Fields> extends Slice {
  emits<E extends Fields>(event: EventDecl<E>, map?: Mapping<C, E>): Complete<C, Em | E>
  test(name: string, spec: Spec<C, Em>): Complete<C, Em>
  note(text: string): Complete<C, Em>
}

export interface Projecting<R extends Fields> {
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

// Every step returns a fresh object over copied data, so a chain prefix held in
// a variable can start several slices without them sharing a record.
function chain(data: SliceData) {
  const next = (patch: Partial<SliceData>) => chain({ ...data, ...patch })
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
    command: (command: CommandDecl) => next({ command: command[META] }),
    emits: (event: EventDecl, map?: (source: never) => object) =>
      next({ emits: [...data.emits, flow(event[META], data.command?.fields ?? {}, map)] }),
    on: (event: EventDecl, map?: (source: never) => object) =>
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
// Chapters and the model
// ---------------------------------------------------------------------------

export interface Chapter {
  readonly [META]: ChapterData
}

function chapter(slices: readonly Slice[]): Chapter {
  return { [META]: { kind: "chapter", slices: slices.map((s) => s[META]) } }
}

export interface Model {
  readonly [META]: ModelData
}

/** Chapters are listed because their order is the timeline. */
function model(name: string, spec: { description?: string; chapters: readonly Chapter[] }): Model {
  return {
    [META]: {
      kind: "model",
      name,
      description: spec.description ?? "",
      chapters: spec.chapters.map((c) => c[META]),
    },
  }
}

export const m = {
  actor,
  service,
  event,
  command,
  readModel,
  key,
  count,
  rejected,
  external,
  stream,
  slice,
  chapter,
  model,
}
