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
  type ScreenData,
  type ServiceData,
  type SliceData,
  type Source,
  type StreamData,
  type TestData,
} from "./types.ts"

type Infer<F extends Fields> = { [P in keyof F]: z.infer<F[P]> }
type OneOrMany<T> = T | readonly T[]

/** What a function gets as its second argument where a handler fills an event or a projection a row. */
export interface Helpers {
  /**
   * A value the handler makes: from the source, such as `generate(e)` for a count, its fields, such
   * as `generate(c.title)`, and the read models the slice names with `.readModel()`, such as
   * `generate(e.pageId, Pages)`; from nothing, `generate()`, it is an id or a clock.
   */
  generate<T>(...inputs: unknown[]): T
}

/** An automation's command is filled from its trigger with no helpers. */
type NoHelpers = Record<never, never>

/** The fields that must have a value: an optional one may go unfilled in a slice, if another fills it. */
type Needed<T extends Fields> = {
  [K in keyof T]: undefined extends z.input<T[K]> ? never : K
}[keyof T]

type Unfilled<S extends Fields, T extends Fields> = Exclude<Needed<T>, keyof S> & string

/**
 * Puts the fields the source lacks into the editor's error, so the fix is in front of you. Spelled
 * out rather than `Unfilled`, which the error would print by name and hide the fields.
 */
type FilledBy<S extends Fields, T extends Fields, From extends string> = [Unfilled<S, T>] extends [
  never,
]
  ? unknown
  : {
      readonly [K in `add to the ${From} or set in the mapping`]: Exclude<Needed<T>, keyof S> &
        string
    }

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
    ? (event: Infer<F>, helpers: Helpers) => Partial<Infer<R>>
    : P extends Into<infer S, infer H>
      ? (source: Infer<S>, helpers: H) => Pick<Infer<F>, Unfilled<S, F>> & Partial<Infer<F>>
      : never

/**
 * A function where an example's data goes is a mapper outside a slice. No result has this key, so
 * the compiler's error names the fix; the parameters are typed, so that error is the only one.
 */
type SliceMapper = (
  source: Record<string, unknown>,
  helpers: Helpers,
) => {
  readonly "a mapper only works inside a slice: .event(...), .command(...) or a projection": never
}

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
    arg: [P] extends [never] ? Partial<Infer<F>> | SliceMapper : Mapper<F, P>,
  ): [P] extends [never] ? Example<K, F> : Mapped<K, F, P>
  readonly [META]: DeclData
  readonly __kind: K
  readonly __fields: F
  note(text: string): this
}

export interface EventDecl<F extends Fields = Fields> extends Decl<"event", F> {
  /** Draws the event in the stream's lane. */
  stream(stream: Stream): this
  /** Makes it the event of a system we do not own, drawn in that system's lane. */
  external(system: External): ExternalEventDecl<F>
}
export type CommandDecl<F extends Fields = Fields> = Decl<"command", F>
export type ReadModelDecl<F extends Fields = Fields> = Decl<"readModel", F>

/**
 * An event of a system we do not own, as `.external()` returns it. Its fields come from outside,
 * so it passes the check that the command carries them: `never` fills any list of missing fields.
 */
export interface ExternalEventDecl<F extends Fields = Fields> extends EventDecl<F> {
  readonly "add to the command or set in the mapping": never
  /** A projection refuses an event with this key, so the editor's error names the fix. */
  readonly "isn't stored: translate it into an event of ours, then project that": true
}

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
  const declared = decl("event", fields)
  return Object.assign(declared, {
    stream(stream: Stream) {
      stream[META].members.push(declared[META])
      return declared
    },
    external(system: External) {
      declared[META].external = system[META]
      return declared
    },
  }) as EventDecl<F>
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
  note(text: string): this
}

/** A machine of ours, which can run automations and projections. */
export interface SystemActor extends Actor {
  readonly __system: true
}

let actors = 0

/** A person; `{ icon: "admin" }` for one with authority; `{ icon: "system" }` for a machine of ours. */
function actor(options: { icon: "system" }): SystemActor
function actor(options?: { icon?: "user" | "admin" }): Actor
function actor(options: { icon?: "user" | "admin" | "system" } = {}): Actor {
  const data: ActorData = { kind: "actor", icon: options.icon ?? "user", order: actors++ }
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

export interface Screen {
  readonly [META]: ScreenData
  note(text: string): Screen
}

/** What an actor sees a slice on, named by its export. Several slices can share one. */
function screen(): Screen {
  const data: ScreenData = { kind: "screen" }
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

let streams = 0

/** A lane, named by its export, drawn in the order written. An event joins it with `.stream()`. */
function stream(): Stream {
  return { [META]: { kind: "stream", order: streams++, members: [] } }
}

export interface External {
  readonly [META]: ExternalData
}

/** A system we do not own, named by its export: a lane its events join with `.external()`. */
function external(): External {
  return { [META]: { kind: "external" } }
}

export interface Chapter {
  readonly [META]: ChapterData
  note(text: string): Chapter
}

let chapters = 0

/**
 * A run of slices under one heading, named by its export, drawn in the order written. A slice
 * joins it with `.chapter()`.
 */
function chapter(): Chapter {
  const data: ChapterData = { kind: "chapter", order: chapters++ }
  return {
    [META]: data,
    note(text) {
      data.note = text
      return this
    },
  }
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping runs once, on probe values, to learn which source fills each field.
const FIELD = Symbol("field")
const SOURCE = Symbol("source")
const GENERATE = Symbol("generate")

interface Probe {
  readonly [FIELD]: string
}

interface Generated {
  readonly [GENERATE]: (string | DeclData)[]
}

function isProbe(value: unknown): value is Probe {
  return typeof value === "object" && value !== null && FIELD in value
}

function isGenerated(value: unknown): value is Generated {
  return typeof value === "object" && value !== null && GENERATE in value
}

/** A source field by its name; the source, or a read model, by its declaration. */
function input(value: unknown): string | DeclData {
  if (isProbe(value)) return value[FIELD]
  const source = (value as { [SOURCE]?: DeclData } | undefined)?.[SOURCE]
  if (source) return source
  const decl = (value as Partial<ReadModelDecl> | undefined)?.[META]
  if (decl?.kind === "readModel") return decl
  throw new Error(
    `generate() takes the source, its fields and read models, such as generate(e.pageId, Pages), not ${String(value)}.`,
  )
}

// Each helper returns its marker, so the probe can tell it from a source field or a constant.
const helpers = {
  generate: (...inputs: unknown[]): Generated => ({ [GENERATE]: inputs.map(input) }),
}

// Private use, so no text a model writes contains it.
const SPLICE = "\u{E000}"
const SPLICED = new RegExp(`${SPLICE}(\\w+)${SPLICE}`, "gu")

/**
 * A mapping that computes a value is recorded as generated from the fields it used, and marked
 * `built` for assembly to report. In a string a field reads as its name between markers. In
 * arithmetic it is NaN, which carries no name, so every field used as a number in this mapping is
 * named: the probe cannot tell which target each went into.
 */
function probe(from: DeclData, map: MapFn): Record<string, Source> {
  const counted: string[] = []
  const numeric = (f: string) => from.fields[f]?.safeParse(0).success === true
  const fields = Object.fromEntries(
    Object.keys(from.fields).map((f) => [
      f,
      {
        [FIELD]: f,
        [Symbol.toPrimitive]: (hint: string) => {
          if (hint === "string" || (hint === "default" && !numeric(f)))
            return `${SPLICE}${f}${SPLICE}`
          counted.push(f)
          return Number.NaN
        },
      },
    ]),
  )
  const source = { ...fields, [SOURCE]: from }
  const mapping: Record<string, Source> = {}
  for (const [field, value] of Object.entries(map(source as never, helpers as never))) {
    const spliced =
      typeof value === "string" ? [...value.matchAll(SPLICED)].map((m) => m[1] ?? "") : []
    mapping[field] = isGenerated(value)
      ? { generate: value[GENERATE] }
      : isProbe(value)
        ? { from: value[FIELD] }
        : spliced.length > 0
          ? { generate: [...new Set(spliced)], built: "string" }
          : Number.isNaN(value) && counted.length > 0
            ? { generate: [...new Set(counted)], built: "number" }
            : { value }
  }
  return mapping
}

type Used = { readonly [META]: DeclData | MappedData }

/** A declaration as a slice uses it: as it is, or called with a function that reads `source`. */
function flow(use: Used, source?: DeclData): Flow {
  const data = use[META]
  if (!("map" in data)) return { decl: data, mapping: {} }
  return { decl: data.decl, mapping: probe(source ?? data.decl, data.map) }
}

// ---------------------------------------------------------------------------
// The slice chain
// ---------------------------------------------------------------------------

/** A started slice, of any pattern. */
export interface Slice {
  readonly [META]: SliceData
  /** The chapter it is drawn in; without one, it is drawn under "Not in a chapter yet". */
  chapter(chapter: Chapter): this
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

/** A row of a read model `D`. */
type Row<D> = D extends ReadModelDecl<infer R> ? Example<"readModel", R> : never

/**
 * A view's example: `when` holds the query's values, and `then` the rows the screen shows. A view
 * with no query has no `when`.
 */
export type ViewSpec<Q extends Fields, Rows> = {
  given?: OneOrMany<Example<"event">>
  then: OneOrMany<Rows>
} & ([keyof Q] extends [never] ? { when?: never } : { when: z.input<z.ZodObject<Q>> })

type Actors = [Actor, ...Actor[]]

/** An event command `C` records: `Event`, or `Event(map)` to fill what `C` does not carry. */
type Outcome<C extends Fields, E extends Fields> =
  | (EventDecl<E> & FilledBy<C, E, "command">)
  | Mapped<"event", E, Into<C, Helpers>>

/** An automation's command, filled from `S`: `Command`, or `Command(map)`. `From` names `S` in the editor's error. */
type Issue<S extends Fields, C extends Fields, From extends string> =
  | (CommandDecl<C> & FilledBy<S, C, From>)
  | Mapped<"command", C, Into<S, NoHelpers>>

/** An event of ours, `Event`, or `Event(map)` to fill columns the event does not carry by name. */
type ProjectedEvent<R extends Fields, E extends Fields> =
  | (EventDecl<E> & {
      readonly "isn't stored: translate it into an event of ours, then project that"?: never
    })
  | Mapped<"event", E, Onto<R>>

/** A slice starts with its whole pattern, so an incomplete one does not compile where it is written. */
export interface SliceStart {
  /** State change: the command an actor issues, and an event it records. */
  command<C extends Fields, E extends Fields>(
    command: CommandDecl<C>,
    event: Outcome<C, E>,
  ): StateChange<C, E>
  /** View: the read models it shows. */
  view<Shown extends [ReadModelDecl, ...ReadModelDecl[]]>(
    ...readModels: Shown
  ): View<Record<never, never>, Row<Shown[number]>>
  /** Automation: the event that starts it, the command it issues, and an event that records. */
  trigger<T extends Fields, C extends Fields, E extends Fields>(
    trigger: EventDecl<T>,
    command: Issue<T, C, "trigger">,
    event: Outcome<C, E>,
  ): Automation<C, E>
  /** Automation: the to-do list it works through on its own schedule, the command, and an event. */
  todoList<R extends Fields, C extends Fields, E extends Fields>(
    todoList: ReadModelDecl<R>,
    command: Issue<R, C, "to-do list">,
    event: Outcome<C, E>,
  ): Automation<C, E>
  /** State view: the read model, and an event that builds it. */
  projection<R extends Fields, E extends Fields>(
    readModel: ReadModelDecl<R>,
    event: ProjectedEvent<R, E>,
  ): Projection<R>
}

export interface View<Q extends Fields, Rows> extends Slice {
  /** The request fields; without them the request is empty. */
  query<F extends Fields>(fields: F): View<F, Rows>
  actor(...actors: Actors): View<Q, Rows>
  /** Where the actors see it; without one, the read model's table is drawn as their screen. */
  screen(screen: Screen): View<Q, Rows>
  /** A view has no command to name its method after. */
  service(service: Service, method: string): View<Q, Rows>
  test(name: string, spec: ViewSpec<Q, Rows>): View<Q, Rows>
  note(text: string): View<Q, Rows>
}

export interface StateChange<C extends Fields, Em extends Fields> extends Slice {
  /** What the handler reads to decide; once per read model. */
  readModel(readModel: ReadModelDecl): StateChange<C, Em>
  /** Another event the command can record instead. */
  event<E extends Fields>(event: Outcome<C, E>): StateChange<C, Em | E>
  actor(...actors: Actors): StateChange<C, Em>
  /** Where the actors see it; without one, the command's form is drawn as their screen. */
  screen(screen: Screen): StateChange<C, Em>
  /** The method is named after the command unless given. */
  service(service: Service, method?: string): StateChange<C, Em>
  test(name: string, spec: Spec<C, Em>): StateChange<C, Em>
  note(text: string): StateChange<C, Em>
}

export interface Automation<C extends Fields, Em extends Fields> extends Slice {
  /** What the handler reads to decide; once per read model. */
  readModel(readModel: ReadModelDecl): Automation<C, Em>
  /** Another event the command can record instead. */
  event<E extends Fields>(event: Outcome<C, E>): Automation<C, Em | E>
  /** The machine of ours that runs it; without one, the first declared, or else System. */
  actor(actor: SystemActor): Automation<C, Em>
  test(name: string, spec: Spec<C, Em>): Automation<C, Em>
  note(text: string): Automation<C, Em>
}

export interface Projection<R extends Fields> extends Slice {
  /** Another event that writes the read model. */
  event<E extends Fields>(event: ProjectedEvent<R, E>): Projection<R>
  /** The machine of ours that runs it; without one, the first declared, or else System. */
  actor(actor: SystemActor): Projection<R>
  test(name: string, spec: ProjectionSpec<R>): Projection<R>
  note(text: string): Projection<R>
}

function many<T>(clauses: OneOrMany<T> | undefined): T[] {
  if (clauses === undefined) return []
  return Array.isArray(clauses) ? [...(clauses as readonly T[])] : [clauses as T]
}

interface AnySpec {
  given?: OneOrMany<Example>
  when?: Example | Record<string, unknown>
  then?: OneOrMany<Example>
  reject?: string
}

/** A view's `when` is its query's values, which Zod checks as it checks an example's. */
function testData(name: string, spec: AnySpec, view?: SliceData): TestData {
  const test: TestData = {
    name,
    given: many(spec.given).map((c) => c[META]),
    then:
      spec.reject === undefined ? many(spec.then).map((c) => c[META]) : [{ message: spec.reject }],
  }
  if (view && spec.when)
    test.query = z
      .object(view.query ?? {})
      .partial()
      .parse(spec.when)
  else if (spec.when) test.when = (spec.when as Example)[META]
  return test
}

// Each step copies, so a shared chain prefix can start several slices. The
// steps nothing extends are the slices, in the order written, so assembly finds every one.
function chain(data: SliceData) {
  DRAFTS.add(data)
  const next = (patch: Partial<SliceData>) => {
    DRAFTS.delete(data)
    return chain({ ...data, ...patch })
  }
  return {
    [META]: data,
    readModel: (readModel: ReadModelDecl) =>
      next({ readModels: [...data.readModels, readModel[META]] }),
    // A projection's event is its own source; a handler's source is the command.
    event: (event: Used) =>
      next({
        events: [...data.events, flow(event, data.projection ? undefined : data.command?.decl)],
      }),
    query: (fields: Fields) => next({ query: fields }),
    // An automation or a projection is run by one machine of ours, and no one sees it.
    actor: (first: Actor, ...rest: Actor[]) =>
      next(
        data.trigger || data.todoList || data.projection
          ? { system: first[META] }
          : { actors: [...data.actors, ...[first, ...rest].map((a) => a[META])] },
      ),
    screen: (screen: Screen) => next({ screen: screen[META] }),
    service: (service: Service, method?: string) =>
      next({
        service:
          method === undefined ? { service: service[META] } : { service: service[META], method },
      }),
    test: (name: string, spec: AnySpec) =>
      next({
        tests: [...data.tests, testData(name, spec, data.shows.length > 0 ? data : undefined)],
      }),
    note: (text: string) => next({ note: text }),
    chapter: (chapter: Chapter) => next({ chapters: [...data.chapters, chapter[META]] }),
  }
}

/** A column of the diagram. Pass a name only when the one it would take misleads. */
function slice(name?: string): SliceStart {
  const empty: SliceData = {
    actors: [],
    shows: [],
    readModels: [],
    events: [],
    tests: [],
    chapters: [],
  }
  if (name !== undefined) empty.name = name
  // A command's events read the command; an automation's command reads what starts it. A missing
  // argument is the compiler's error to report; the slice keeps what it has, so it is still drawn.
  const handled = (from: Partial<SliceData>, command?: Used, event?: Used, source?: DeclData) => {
    const issued = command && flow(command, source)
    const events = event ? [flow(event, issued?.decl)] : []
    return chain({ ...empty, ...from, ...(issued && { command: issued }), events })
  }
  const start = {
    command: (command?: Used, event?: Used) => handled({}, command, event),
    view: (...readModels: ReadModelDecl[]) =>
      chain({ ...empty, shows: readModels.map((r) => r[META]) }),
    trigger: (trigger?: EventDecl, command?: Used, event?: Used) =>
      handled(trigger ? { trigger: trigger[META] } : {}, command, event, trigger?.[META]),
    todoList: (todoList?: ReadModelDecl, command?: Used, event?: Used) =>
      handled(todoList ? { todoList: todoList[META] } : {}, command, event, todoList?.[META]),
    projection: (readModel?: ReadModelDecl, event?: Used) =>
      chain({
        ...empty,
        ...(readModel && { projection: readModel[META] }),
        events: event ? [flow(event)] : [],
      }),
  }
  return start as unknown as SliceStart
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface Model {
  readonly [META]: ModelData
}

function model(name: string, spec: { description?: string } = {}): Model {
  return { [META]: { kind: "model", name, description: spec.description ?? "" } }
}

export const m = {
  actor,
  screen,
  service,
  event,
  command,
  readModel,
  key,
  external,
  stream,
  chapter,
  slice,
  model,
}
