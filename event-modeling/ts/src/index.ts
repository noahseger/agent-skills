// Everything a model is written with, under `m`.
// `__kind` and `__fields` exist only for the compiler; assembly reads `META`.
import { createHash } from "node:crypto"
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

/** The fields that must have a value: an optional one may go unfilled in a slice, if another fills it. */
type Needed<T extends Fields> = {
  [K in keyof T]: undefined extends z.input<T[K]> ? never : K
}[keyof T]

declare const REF: unique symbol

/**
 * A field of a declaration, as `.fields` gives it: a mapping's result or an input to
 * `m.generate()`, never a schema to declare a field with.
 */
export interface FieldRef<S extends z.ZodType = z.ZodType> {
  readonly [REF]: S
}

/**
 * What a target field takes: a string format takes only that format, and any other type any schema
 * with its output, or a reference to a field that does.
 */
type Fit<T extends z.ZodType> = Schema<T> | FieldRef<Schema<T>>
type Schema<T extends z.ZodType> =
  T extends z.ZodStringFormat<infer F> ? z.ZodStringFormat<F> : z.ZodType<z.output<T>>

/**
 * A mapping's result: for each target field, a source field, a `z.literal()` or `m.generate()`. It
 * must set the fields in `Set`. One object type, so a result with no target field is refused.
 */
type Out<T extends Fields, Set extends keyof T = never> = {
  [K in keyof (Partial<T> & Pick<T, Set>)]: Fit<T[K]>
}

/**
 * The fields that would flow by name from `S` but do not fit `T`'s. An optional source field flows
 * when it is set. A source not yet inferred has no fields to judge.
 */
type Misfit<S extends Fields, T extends Fields> = string extends keyof S
  ? never
  : {
      [K in keyof T & keyof S]: (S[K] extends z.ZodOptional<infer U> ? U : S[K]) extends Fit<T[K]>
        ? never
        : K
    }[keyof T & keyof S] &
      string

/** What the mapping must set: what `S` lacks, and what it has that does not fit. */
type Unfilled<S extends Fields, T extends Fields> =
  | (Exclude<Needed<T>, keyof S> & string)
  | Misfit<S, T>

/**
 * The declaration `A`, or, where `S` lacks a field it needs, the instruction to fix that: the editor
 * says the parameter's type is the sentence. `From` names `S` in it. An external event's fields come
 * from outside, so it always passes. `Use` is the mapped form; a mapping is typed against it while
 * `A` is still being inferred, which is what types the mapping's arguments.
 */
type FilledBy<S extends Fields, A, From extends string, Use> = [A] extends [never]
  ? Use
  : A extends ExternalEventDecl
    ? A
    : A extends Decl<DeclKind, infer T>
      ? [Unfilled<S, T>] extends [never]
        ? A
        : [Misfit<S, T>] extends [never]
          ? `add ${Unfilled<S, T>} to the ${From} or set it in the mapping`
          : `the ${From}'s ${Misfit<S, T>} does not fit: set it in the mapping`
      : Use

/** A use where a handler fills the declaration from `S`'s fields. */
export interface Into<S extends Fields> {
  readonly source: S
}

/** A use in a state view, where the event fills the view `R`'s columns. */
export interface Onto<R extends Fields> {
  readonly view: R
}

/** A use as one of a handler's events: the mapping reads the command `C`; the slice checks the rest. */
export interface Within<C extends Fields> {
  readonly within: C
}

export type Place = Into<Fields> | Onto<Fields> | Within<Fields>

/**
 * The function a declaration with fields `F` is called with, typed by where the slice uses it. Its
 * argument is the source's schemas, so each result is a schema the target field takes. A handler's
 * event's sets fields of the event, `O`, and the slice checks what it leaves unset; an automation's
 * command's must set every field its source lacks or has in a type that does not fit; a state
 * view's sets any columns, and must set those its event has in a type that does not fit.
 */
export type Mapper<F extends Fields, P, O = unknown> =
  P extends Within<infer C>
    ? (command: C) => { [K in keyof O]: K extends keyof F ? Fit<F[K]> : never }
    : P extends Onto<infer R>
      ? (event: F) => Out<R, Misfit<F, R>>
      : P extends Into<infer S>
        ? (source: S) => Out<F, Unfilled<S, F>>
        : never

/**
 * A function where an example's data goes is a mapper outside a slice. No result has this key, so
 * the compiler's error names the fix; the parameters are typed, so that error is the only one.
 */
type SliceMapper = (source: Record<string, unknown>) => {
  readonly "a mapper only works inside a slice's first call": never
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
export interface Mapped<K extends DeclKind, F extends Fields, P extends Place, S = PropertyKey> {
  readonly [META]: MappedData
  readonly __kind: K
  readonly __fields: F
  readonly __place: P
  /** The fields the mapping sets. */
  readonly __set: S
}

export interface Decl<K extends DeclKind, F extends Fields> {
  /**
   * With data, an example for a given, when or then clause; Zod checks the values. With a function,
   * its use in a slice, filling the fields its source does not carry by name. One signature, not two
   * overloads, so the compiler's error is about the form written. The slice step decides `P`.
   */
  <P extends Place = never, O = unknown>(
    arg: [P] extends [never] ? Partial<Infer<F>> | SliceMapper : Mapper<F, P, O>,
  ): [P] extends [never] ? Example<K, F> : Mapped<K, F, P, keyof O>
  readonly [META]: DeclData
  /** Its fields, for a mapping in the same slice to read: `PageCreated.fields.pageId`. */
  readonly fields: { readonly [K in keyof F]: FieldRef<F[K]> }
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
export interface ViewDecl<F extends Fields = Fields> extends Decl<"view", F> {
  /** The columns that identify a row. */
  key(...columns: (keyof F & string)[]): this
}

/** An event of a system we do not own, as `.external()` returns it. */
export interface ExternalEventDecl<F extends Fields = Fields> extends EventDecl<F> {
  /** A state view and an automation refuse an event with these keys, so the error names the fix. */
  readonly "isn't stored: translate it into an event of ours, then project that": true
  readonly "comes from outside: start its slice with .translation()": true
}

function decl<K extends DeclKind, F extends Fields>(kind: K, fields: F): Decl<K, F> {
  const data: DeclData = { kind, fields, keys: [] }
  // A function makes a use for a slice; anything else is an example, which Zod checks once the
  // specification it is in has filled its generated values.
  const call = (arg: object): object =>
    typeof arg === "function"
      ? { [META]: { decl: data, map: arg as MapFn } }
      : {
          [META]: { decl: data, data: arg as Record<string, unknown> },
          __kind: kind,
          __fields: fields,
        }
  const declared = Object.assign(call as Decl<K, F>, {
    [META]: data,
    __kind: kind,
    __fields: fields,
    fields: copies(fields, data),
    // Mutating is safe: .note() and .key() are called before anything else holds the declaration.
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

function view<F extends Fields>(fields: F): ViewDecl<F> {
  const declared = decl("view", fields)
  return Object.assign(declared, {
    key(...columns: string[]) {
      declared[META].keys = columns
      return declared
    },
  }) as ViewDecl<F>
}

export interface Actor {
  readonly [META]: ActorData
  note(text: string): this
}

/** A machine of ours, which can run automations and state views. */
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

// A mapping runs once, on a copy of each source field's schema, to learn which fills each target.
const SOURCE = Symbol("source")
const GENERATE = Symbol("generate")
/** The declarations whose `.fields` a generated value is made from. */
const READS = Symbol("reads")

/** Each copy's field name. A copy per field, so two fields that share a schema stay apart. */
const FIELDS = new WeakMap<object, string>()

/** The declaration whose `.fields` a copy came from. */
const OWNER = new WeakMap<object, DeclData>()

/** A copy of each field's schema, marked with its name and, for `.fields`, its declaration. */
function copies(fields: Fields, owner?: DeclData): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([f, schema]) => {
      const copy = schema.clone()
      FIELDS.set(copy, f)
      if (owner) OWNER.set(copy, owner)
      return [f, copy]
    }),
  )
}

/** The declarations whose `.fields` a value reads. */
function owners(value: unknown): DeclData[] {
  if (typeof value !== "object" || value === null) return []
  if (isGenerated(value)) return value[READS]
  const owner = OWNER.get(value)
  return owner ? [owner] : []
}

interface Generated {
  readonly [GENERATE]: (string | DeclData)[]
  readonly [READS]: DeclData[]
}

function isGenerated(value: unknown): value is Generated {
  return typeof value === "object" && value !== null && GENERATE in value
}

/** A source field by its name; the source, or a view, by its declaration. */
function input(value: unknown): string | DeclData {
  const field = typeof value === "object" && value !== null ? FIELDS.get(value) : undefined
  if (field !== undefined) return field
  const source = (value as { [SOURCE]?: DeclData } | undefined)?.[SOURCE]
  if (source) return source
  const decl = (value as Partial<ViewDecl> | undefined)?.[META]
  if (decl?.kind === "view") return decl
  throw new Error(
    `m.generate() takes the source, its fields and views, such as m.generate(e.pageId, Pages), not ${String(value)}.`,
  )
}

/**
 * A value the handler makes: from the source, such as `m.generate(e)` for a count, its fields, such
 * as `m.generate(c.title)`, and the views the slice names with `.view()`, such as
 * `m.generate(e.pageId, Pages)`; from nothing, `m.generate()`, it is an id or a clock. In a
 * specification, `m.generate()` is a value of its field's type that no other generated value has.
 * It returns a marker, so the probe can tell it from a source field or a constant.
 */
function generate<T = never>(...inputs: unknown[]): T {
  return { [GENERATE]: inputs.map(input), [READS]: inputs.flatMap(owners) } as T
}

/**
 * What a mapping put in each target: a source field, a constant from `z.literal()`, or a generated
 * value. Anything else, such as a field's schema changed by a Zod method, is computed, and marked
 * `built` for assembly to report.
 */
function probe(decl: DeclData, from: DeclData, map: MapFn): Flow {
  const source = { ...copies(from.fields), [SOURCE]: from }
  const mapping: Record<string, Source> = {}
  const reads: DeclData[] = []
  for (const [field, value] of Object.entries(map(source as never))) {
    reads.push(...owners(value))
    const from = typeof value === "object" && value !== null ? FIELDS.get(value) : undefined
    const def = (value as { _zod?: { def?: { type?: string; values?: unknown[] } } })?._zod?.def
    mapping[field] = isGenerated(value)
      ? { generate: value[GENERATE] }
      : from !== undefined
        ? { from }
        : def?.type === "literal" && def.values?.length === 1
          ? { value: def.values[0] }
          : { generate: [], built: true }
  }
  return { decl, mapping, ...(reads.length > 0 && { reads: [...new Set(reads)] }) }
}

type Used = { readonly [META]: DeclData | MappedData }

/** A declaration as a slice uses it: as it is, or called with a function that reads `source`. */
function flow(use: Used, source?: DeclData): Flow {
  const data = use[META]
  if (!("map" in data)) return { decl: data, mapping: {} }
  return probe(data.decl, source ?? data.decl, data.map)
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

/**
 * A state view's example: `given` builds the rows, `when` holds the query's values, and `then` the
 * rows the screen shows. One with no query has no `when`, and a view cannot reject an event.
 */
export type ViewSpec<Q extends Fields, R extends Fields> = {
  given?: OneOrMany<Example<"event">>
  then: OneOrMany<Example<"view", R>>
} & ([keyof Q] extends [never] ? { when?: never } : { when: z.input<z.ZodObject<Q>> })

type Actors = [Actor, ...Actor[]]

/** The fields an external event `A` brings back to the slice that called it: its reply. */
type Reply<A> = A extends ExternalEventDecl<infer F> ? F : Record<never, never>

/** What an event of ours is filled from: the command's fields, and the replies' the command lacks. */
type Sent<C extends Fields, R extends Fields> = Omit<R, keyof C> & C

/** An event as a handler's slice takes it: as declared, or mapped from the command `C`. */
// biome-ignore lint/suspicious/noExplicitAny: any event's fields
type Handled<C extends Fields> = EventDecl<any> | Mapped<"event", any, Within<C>>

type Intersect<U> = (U extends unknown ? (u: U) => void : never) extends (u: infer I) => void
  ? I
  : never

/** What all of a slice's external events bring back. */
type Replies<Es extends readonly unknown[]> = Intersect<Reply<Es[number]>> & Record<never, never>

/** Of the fields `Of` names, those event `A` does not set in its mapping. */
type Unset<A, Of> = A extends Mapped<"event", Fields, Place, infer Set> ? Exclude<Of, Set> : Of

/**
 * Event `A` filled from `S`, the command's fields and the slice's replies: `A` as written or, where
 * `S` leaves a field unset, the instruction to fix it. An external event's fields come from outside.
 */
type Outcome<S extends Fields, A> = A extends ExternalEventDecl
  ? A
  : A extends { readonly __fields: infer F extends Fields }
    ? [Unset<A, Unfilled<S, F>>] extends [never]
      ? A
      : [Unset<A, Misfit<S, F>>] extends [never]
        ? `add ${Unset<A, Unfilled<S, F>> & string} to the command or set it in the mapping`
        : `the command's ${Unset<A, Misfit<S, F>> & string} does not fit: set it in the mapping`
    : A

/**
 * A handler's events, each checked against the command `C` and every reply in the slice. One
 * argument does not see another; this sees them all, once they are inferred.
 */
type Outcomes<C extends Fields, Es extends readonly unknown[]> = [Es] extends [never]
  ? readonly Handled<C>[]
  : { [K in keyof Es]: Outcome<Sent<C, Replies<Es>>, Es[K]> }

/** An automation's command, filled from its trigger `T`: `Command`, or `Command(map)`. */
type Issue<T extends Fields, A> = FilledBy<T, A, "trigger", Mapped<"command", Fields, Into<T>>>

// biome-ignore lint/suspicious/noExplicitAny: any event's fields
type AnyEvent = EventDecl<any> | Mapped<"event", any, Place>
// biome-ignore lint/suspicious/noExplicitAny: any command's fields
type AnyCommand = CommandDecl<any> | Mapped<"command", any, Place>

/**
 * An event of ours that builds the view `R`: `Event`, or `Event(map)` to fill columns the event does
 * not carry by name or carries in a type that does not fit. Otherwise, the instruction to fix it.
 */
type ViewedEvent<R extends Fields, A> = A extends ExternalEventDecl
  ? "isn't stored: translate it into an event of ours, then project that"
  : A extends EventDecl<infer E>
    ? [Misfit<E, R>] extends [never]
      ? A
      : `the event's ${Misfit<E, R>} does not fit: set it in the mapping`
    : A

/** A state view's events, each as written or the instruction to fix it. */
type Viewed<R extends Fields, Es extends readonly unknown[]> = [Es] extends [never]
  ? // biome-ignore lint/suspicious/noExplicitAny: any event's fields
    readonly (EventDecl<any> | Mapped<"event", any, Onto<R>>)[]
  : { [K in keyof Es]: ViewedEvent<R, Es[K]> }

/** A slice's events: at least one, in any order. */
type Events = readonly [AnyEvent, ...AnyEvent[]]

/** What starts an automation: an event of ours, or a view it polls. */
type Started<T extends Fields> =
  | (EventDecl<T> & {
      readonly "comes from outside: start its slice with .translation()"?: never
    })
  | ViewDecl<T>

/** A translation's start: an external event, or, for anything else, the instruction to fix it. */
type Translated<E> = E extends {
  readonly "comes from outside: start its slice with .translation()": true
}
  ? E
  : E extends { readonly __kind: "view" }
    ? "is a view: poll it with .automation()"
    : "is ours: start its slice with .automation()"

/**
 * A slice starts with its whole pattern, all its events included, so an incomplete one does not
 * compile where it is written. A handler's events are what it can record, in any order; an external
 * one is a call, and what it brings back an event of ours in the same slice can keep.
 */
export interface SliceStart {
  /** State change: the command an actor issues, and the events it records. */
  command<C extends Fields, const Es extends Events>(
    command: CommandDecl<C>,
    ...events: Outcomes<C, Es>
  ): StateChange<C, Es[number]["__fields"]>
  /** State view: the view, and the events that build it. */
  view<R extends Fields, const Es extends Events>(
    view: ViewDecl<R>,
    ...events: Viewed<R, Es>
  ): StateView<Record<never, never>, R>
  /**
   * Automation: what starts it, the command it issues, and the events it records. An event starts it
   * as it happens; a view, polled on the automation's own schedule, starts it once per row.
   */
  automation<T extends Fields, I extends AnyCommand, const Es extends Events>(
    trigger: Started<T>,
    command: Issue<T, I>,
    ...events: Outcomes<I["__fields"], Es>
  ): Automation<I["__fields"], Es[number]["__fields"]>
  /** Translation: an external event, the command it becomes, and the events of ours that record it. */
  translation<
    E extends { readonly __fields: Fields },
    I extends AnyCommand,
    const Es extends Events,
  >(
    external: Translated<E>,
    command: Issue<E["__fields"], I>,
    ...events: Outcomes<I["__fields"], Es>
  ): Automation<I["__fields"], Es[number]["__fields"]>
}

export interface StateView<Q extends Fields, R extends Fields> extends Slice {
  /** The request fields; without them the request is empty. */
  query<F extends Fields>(fields: F): StateView<F, R>
  actor(...actors: Actors): StateView<Q, R>
  /** Where the actors see it; without one, the view's table is drawn as their screen. */
  screen(screen: Screen): StateView<Q, R>
  /** A state view has no command to name its method after. */
  service(service: Service, method: string): StateView<Q, R>
  test(name: string, spec: ViewSpec<Q, R> | (() => ViewSpec<Q, R>)): StateView<Q, R>
  note(text: string): StateView<Q, R>
}

export interface StateChange<C extends Fields, Em extends Fields> extends Slice {
  /** What the handler reads to decide; once per view. */
  view(view: ViewDecl): StateChange<C, Em>
  actor(...actors: Actors): StateChange<C, Em>
  /** Where the actors see it; without one, the command's form is drawn as their screen. */
  screen(screen: Screen): StateChange<C, Em>
  /** The method is named after the command unless given. */
  service(service: Service, method?: string): StateChange<C, Em>
  test(name: string, spec: Spec<C, Em> | (() => Spec<C, Em>)): StateChange<C, Em>
  note(text: string): StateChange<C, Em>
}

export interface Automation<C extends Fields, Em extends Fields> extends Slice {
  /** What the handler reads to decide; once per view. */
  view(view: ViewDecl): Automation<C, Em>
  /** The machine of ours that runs it; without one, the first declared, or else System. */
  actor(actor: SystemActor): Automation<C, Em>
  test(name: string, spec: Spec<C, Em> | (() => Spec<C, Em>)): Automation<C, Em>
  note(text: string): Automation<C, Em>
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

/**
 * A state view's `when` is its query's values, which Zod checks as it checks an example's. Each
 * generated value, at any depth, becomes one value wherever the specification uses it, so the check
 * compares it as any other. A value Zod refuses is kept as written and left to do.
 */
function testData(name: string, spec: AnySpec, view?: SliceData): TestData {
  const made = new Map<unknown, unknown>()
  const fill = (schema: z.ZodType | undefined, value: unknown): unknown => {
    if (isGenerated(value)) {
      if (!made.has(value)) made.set(value, sample(schema, `${name}:${made.size}`))
      return made.get(value)
    }
    if (Array.isArray(value)) return value.map((v) => fill(inner(schema), v))
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return value
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(inner(schema, k), v)]))
  }
  const invalid: NonNullable<TestData["invalid"]> = []
  const check = (decl: DeclData, fields: Fields, data: object) => {
    const filled = fill(z.object(fields), data)
    const parsed = z.object(fields).partial().safeParse(filled)
    for (const issue of parsed.error?.issues ?? [])
      invalid.push({ decl, message: `${z.core.toDotPath(issue.path)}: ${issue.message}` })
    return (parsed.data ?? filled) as Record<string, unknown>
  }
  const example = (c: Example): ExampleData => ({
    decl: c[META].decl,
    data: check(c[META].decl, c[META].decl.fields, c[META].data),
  })
  const test: TestData = {
    name,
    given: many(spec.given).map(example),
    then: spec.reject === undefined ? many(spec.then).map(example) : [{ message: spec.reject }],
  }
  if (view?.view && spec.when) test.query = check(view.view, view.query ?? {}, spec.when)
  else if (spec.when) test.when = example(spec.when as Example)
  if (invalid.length > 0) test.invalid = invalid
  return test
}

/** The schema of a value inside one of `schema`'s: an array's element, or an object's field `key`. */
function inner(schema: z.ZodType | undefined, key?: string): z.ZodType | undefined {
  type Def = { innerType?: z.ZodType; element?: z.ZodType; shape?: Fields }
  let def = schema?._zod.def as Def | undefined
  while (def?.innerType) def = def.innerType._zod.def as Def
  return key === undefined ? def?.element : def?.shape?.[key]
}

/** A value `schema` accepts, the same on every run for the same seed. */
function sample(schema: z.ZodType | undefined, seed: string): unknown {
  const hex = createHash("sha256").update(seed).digest("hex")
  const n = Number.parseInt(hex.slice(0, 8), 16)
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  const time = new Date(Date.UTC(2026, 0, 1) + (n % 525_600) * 60_000).toISOString()
  let options: unknown[] = []
  try {
    options =
      (z.toJSONSchema(schema ?? z.never(), { io: "input" }) as { enum?: unknown[] }).enum ?? []
  } catch {}
  const values = [
    options[n % options.length],
    uuid,
    time,
    time.slice(0, 10),
    (n % 1000) + 1,
    n % 2 === 0,
    [],
  ]
  return values.find((v) => v !== undefined && schema?.safeParse(v).success) ?? uuid
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
    view: (view: ViewDecl) => next({ reads: [...data.reads, view[META]] }),
    query: (fields: Fields) => next({ query: fields }),
    // An automation is run by one machine of ours, and no one sees it.
    actor: (first: Actor, ...rest: Actor[]) =>
      next(
        data.trigger || data.polls
          ? { system: first[META] }
          : { actors: [...data.actors, ...[first, ...rest].map((a) => a[META])] },
      ),
    screen: (screen: Screen) => next({ screen: screen[META] }),
    service: (service: Service, method?: string) =>
      next({
        service:
          method === undefined ? { service: service[META] } : { service: service[META], method },
      }),
    test: (name: string, spec: AnySpec | (() => AnySpec)) =>
      next({
        tests: [
          ...data.tests,
          testData(name, typeof spec === "function" ? spec() : spec, data.view ? data : undefined),
        ],
      }),
    note: (text: string) => next({ note: text }),
    chapter: (chapter: Chapter) => next({ chapters: [...data.chapters, chapter[META]] }),
  }
}

/** A column of the diagram. Pass a name only when the one it would take misleads. */
function slice(name?: string): SliceStart {
  const empty: SliceData = {
    actors: [],
    reads: [],
    events: [],
    tests: [],
    chapters: [],
  }
  if (name !== undefined) empty.name = name
  // A command's events read the command; an automation's command reads what starts it. A missing
  // argument is the compiler's error to report; the slice keeps what it has, so it is still drawn.
  const handled = (from: Partial<SliceData>, command?: Used, events: Used[] = []) => {
    const source = from.trigger ?? from.polls
    const issued = command && flow(command, source)
    return chain({
      ...empty,
      ...from,
      ...(issued && { command: issued }),
      events: events.map((e) => flow(e, issued?.decl)),
    })
  }
  const start = {
    command: (command?: Used, ...events: Used[]) => handled({}, command, events),
    view: (view?: ViewDecl, ...events: Used[]) =>
      chain({ ...empty, ...(view && { view: view[META] }), events: events.map((e) => flow(e)) }),
    automation: (trigger?: EventDecl | ViewDecl, command?: Used, ...events: Used[]) =>
      handled(
        trigger ? { [trigger[META].kind === "view" ? "polls" : "trigger"]: trigger[META] } : {},
        command,
        events,
      ),
    translation: (external?: EventDecl, command?: Used, ...events: Used[]) =>
      handled(external ? { trigger: external[META] } : {}, command, events),
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
  view,
  generate,
  external,
  stream,
  chapter,
  slice,
  model,
}
