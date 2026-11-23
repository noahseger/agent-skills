// Everything a model is written with, under `m`.
// `__kind` and `__fields` exist only for the compiler; assembly reads `META`.
import { createHash } from "node:crypto"
import { z } from "zod"

import { type AnyField, type Fields, type Row, t, type Value } from "./t.ts"
import {
  type ActorData,
  type ChapterData,
  type Context,
  type DeclData,
  type DeclKind,
  DRAFTS,
  type ExampleData,
  type ExternalData,
  type Flow,
  type MapFn,
  META,
  type ModelData,
  type Fields as Schemas,
  type ScreenData,
  type ServiceData,
  type SliceData,
  type StreamData,
  type TestData,
} from "./types.ts"

export type { Field, Fields } from "./t.ts"
export { t }

type Infer<F extends Fields> = { [P in keyof F]: Value<F[P]> }
type OneOrMany<T> = T | readonly T[]

/** The fields that must have a value: an optional one may go unfilled in a slice, if another fills it. */
type Needed<T extends Fields> = {
  [K in keyof T]: undefined extends Value<T[K]> ? never : K
}[keyof T]

/**
 * What a target field takes: a field of a string format takes only that format, and any other a
 * field with its values.
 */
type Fit<T extends AnyField> = string extends T["__format"]
  ? { readonly __value: T["__value"] }
  : { readonly __value: T["__value"]; readonly __format: T["__format"] }

/** A field as it flows once set: an optional one's values without undefined. */
type WhenSet<F extends AnyField> = {
  readonly __value: Exclude<F["__value"], undefined>
  readonly __format: F["__format"]
}

/**
 * A mapping's result: for each target field, a field before the step, a `t.literal()` or
 * `m.generate()`. It must set the fields in `Set`. One object type, so a result with no target
 * field is refused.
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
      [K in keyof T & keyof S]: WhenSet<S[K]> extends Fit<T[K]> ? never : K
    }[keyof T & keyof S] &
      string

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export interface Example<K extends DeclKind = DeclKind, F extends Fields = Fields> {
  readonly [META]: ExampleData
  readonly __kind: K
  readonly __fields: F
}

export interface Decl<K extends DeclKind, F extends Fields> {
  /** An example for a given, when or then clause; Zod checks the values. */
  (data: Partial<Infer<F>>): Example<K, F>
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

/** A view, with the key columns the compiler knows, so `.query()` can count the rows it reads. */
export interface ViewDecl<F extends Fields = Fields, K extends string = string>
  extends Decl<"view", F> {
  readonly __key: K
  /** The columns that identify a row. */
  key<const Ks extends (keyof F & string)[]>(...columns: Ks): ViewDecl<F, Ks[number]>
}

/** An event of a system we do not own, as `.external()` returns it. */
export interface ExternalEventDecl<F extends Fields = Fields> extends EventDecl<F> {
  /** Tells it from an event of ours, which has the same fields. */
  readonly __external: true
}

/** A second `.note()` adds to the first, on a line of its own. */
function noted(note: string | undefined, text: string): string {
  return note === undefined ? text : `${note}\n${text}`
}

function decl<K extends DeclKind, F extends Fields>(kind: K, fields: F): Decl<K, F> {
  const data: DeclData = { kind, fields: fields as unknown as Schemas, keys: [] }
  // Zod checks an example once the specification it is in has filled its generated values.
  const call = (arg: Record<string, unknown>): Example<K, F> =>
    ({ [META]: { decl: data, data: arg }, __kind: kind, __fields: fields }) as Example<K, F>
  const declared = Object.assign(call as Decl<K, F>, {
    [META]: data,
    __kind: kind,
    __fields: fields,
    // Mutating is safe: .note() and .key() are called before anything else holds the declaration.
    note(text: string) {
      data.note = noted(data.note, text)
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

function view<F extends Fields>(fields: F): ViewDecl<F, never> {
  const declared = decl("view", fields)
  return Object.assign(declared, {
    key(...columns: string[]) {
      declared[META].keys = columns
      return declared
    },
  }) as unknown as ViewDecl<F, never>
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
      data.note = noted(data.note, text)
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
      data.note = noted(data.note, text)
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
      data.note = noted(data.note, text)
      return this
    },
  }
}

export interface Stream {
  readonly [META]: StreamData
}

let streams = 0

/** A lane, named by its export. An event joins it with `.stream()`. */
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
 * A run of slices under one heading, named by its export. Chapters are drawn in the order of their
 * numbers, so `m.chapter(1)` comes first; one with no number yet comes after. A slice joins it with
 * `.chapter()`.
 */
function chapter(number?: number): Chapter {
  const data: ChapterData = { kind: "chapter", order: chapters++ }
  if (number !== undefined) data.number = number
  return {
    [META]: data,
    note(text) {
      data.note = noted(data.note, text)
      return this
    },
  }
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping runs once, on a copy of each field's schema before its step, to learn which fills each target.
const SOURCE = Symbol("source")
const GENERATE = Symbol("generate")

/** Each copy's field and declaration. A copy per field, so two fields that share a schema stay apart. */
const FIELDS = new WeakMap<object, { field: string; decl: DeclData }>()

/** Each declaration before a step, by the name its call gave it, as `c` holds it. */
type InScope = [string, DeclData][]

/** `c`: each declaration's fields as copies, marked with where they came from; whole, it is the declaration. */
function scoped(scope: InScope): Record<string, Schemas> {
  return Object.fromEntries(
    scope.map(([name, decl]) => {
      const fields: Schemas = {}
      for (const [f, schema] of Object.entries(decl.fields)) {
        const copy = schema.clone()
        FIELDS.set(copy, { field: f, decl })
        fields[f] = copy
      }
      return [name, Object.assign(fields, { [SOURCE]: decl })]
    }),
  )
}

/** The fields of `decl`, each from `decl`. */
function contextOf(decl: DeclData): Context {
  return Object.fromEntries(Object.keys(decl.fields).map((f) => [f, decl]))
}

interface Generated {
  readonly [GENERATE]: (string | DeclData)[]
}

function isGenerated(value: unknown): value is Generated {
  return typeof value === "object" && value !== null && GENERATE in value
}

/** A field by its name; a state view's event, whole, by its declaration. */
function input(value: unknown): string | DeclData {
  const field = typeof value === "object" && value !== null ? FIELDS.get(value) : undefined
  if (field !== undefined) return field.field
  const source = (value as { [SOURCE]?: DeclData } | undefined)?.[SOURCE]
  if (source) return source
  throw new Error(
    `m.generate() takes fields of the mapping's argument, such as m.generate(c.AddNote.title), not ${String(value)}.`,
  )
}

/**
 * A value the handler makes: from fields before its step, such as `m.generate(c.AddNote.title)`; in
 * a state view, from the event, such as `m.generate(c.ItemAdded)` for a count; from nothing,
 * `m.generate()`, it is an id or a clock. In a specification, `m.generate()` is a value of its
 * field's type that no other generated value has. It returns a marker, so the probe can tell it from
 * a field or a constant.
 */
function generate<T = never>(...inputs: unknown[]): T {
  return { [GENERATE]: inputs.map(input) } as T
}

/**
 * What a mapping put in each target: a field before its step, a constant from `t.literal()`, or a
 * generated value. Anything else, such as a field changed by `.describe()`, is computed, and
 * marked `built` for assembly to report.
 */
function probe(decl: DeclData, context: Context, scope: InScope, map?: MapFn): Flow {
  const flow: Flow = { decl, mapping: {}, context }
  if (!map) return flow
  const c = scoped(scope)
  let result: object
  try {
    result = map(c as never)
  } catch (error) {
    // The picture never refuses a model: the step is drawn, and what threw is left to do.
    flow.threw = error instanceof Error ? error.message : String(error)
    return flow
  }
  for (const [field, value] of Object.entries(result)) {
    const from = typeof value === "object" && value !== null ? FIELDS.get(value) : undefined
    const def = (value as { _zod?: { def?: { type?: string; values?: unknown[] } } })?._zod?.def
    // Zod reads an array as the literal's values, so `t.literal([])` has none: it is the empty list.
    const values = def?.values?.length === 0 ? [[]] : def?.values
    flow.mapping[field] = isGenerated(value)
      ? { generate: value[GENERATE] }
      : from !== undefined
        ? { from: from.field, decl: from.decl }
        : def?.type === "literal" && values?.length === 1
          ? { value: values[0] }
          : { generate: [], built: true }
  }
  return flow
}

// ---------------------------------------------------------------------------
// The slice chain
// ---------------------------------------------------------------------------

type Flat<T> = { [K in keyof T]: T[K] } & {}
type FieldsOf<A> = A extends { readonly __fields: infer F extends Fields } ? F : never

// biome-ignore lint/suspicious/noExplicitAny: any command's fields
type AnyCommand = CommandDecl<any>
// biome-ignore lint/suspicious/noExplicitAny: any event's fields
type AnyEvent = EventDecl<any>
// biome-ignore lint/suspicious/noExplicitAny: any view's columns
type AnyView = ViewDecl<any, string>

/**
 * Each declaration before a step, in order, by the name its call gave it: `[name, fields, eq]`.
 * `eq` is the columns a query's filter makes equal to the field of the same name before it.
 */
type Entry = readonly [string, Fields, string]
type Ctx = readonly Entry[]

/** What a mapping's `c` is: each declaration before the step, by name. */
type Scope<C extends Ctx> = Flat<{ [E in C[number] as E[0]]: E[1] }>

/** A field as a query's filter mapping reads it, marked with where it came from. */
interface From<D extends string, F extends string> {
  readonly __from: `${D}.${F}`
}
type Marked<C extends Ctx> = Flat<{
  [E in C[number] as E[0]]: { [F in keyof E[1] & string]: E[1][F] & From<E[0], F> }
}>

/** The declarations that carry `K` by name, in order. A filter column is not a second one. */
type Sources<C, K extends string> = C extends readonly [
  infer E extends Entry,
  ...infer R extends Ctx,
]
  ? K extends keyof E[1]
    ? K extends E[2]
      ? Sources<R, K>
      : [E[0], ...Sources<R, K>]
    : Sources<R, K>
  : []

type FieldIn<C extends Ctx, N extends string, K extends string> = Extract<
  C[number],
  readonly [N, Fields, string]
>[1][K]

type Join<N> = N extends readonly [infer A extends string, infer B extends string]
  ? `${A} and ${B}`
  : N extends readonly [infer A extends string, ...infer R]
    ? `${A}, ${Join<R>}`
    : ""

/** An optional source field fits only an optional target, as it does in a mapping. */
type Fits<S, T extends AnyField> = S extends Fit<T> ? true : false

/** A field that would flow by name but does not fit: the sentence a mapping that sets it gets. */
type Unfit<K extends string> =
  `${K} does not fit: set it to a field of its type, a t.literal() or m.generate()`

/** What keeps target field `K` from flowing by name, as the instruction; never if it flows. */
type Problem<C extends Ctx, T extends Fields, K extends keyof T & string, Step extends string> =
  Sources<C, K> extends readonly [infer N extends string]
    ? Fits<FieldIn<C, N, K>, T[K]> extends true
      ? never
      : Unfit<K>
    : Sources<C, K> extends readonly []
      ? K extends Needed<T>
        ? `add ${K} to a step before ${Step} or set it in the mapping`
        : never
      : `${K} comes from ${Join<Sources<C, K>>}: set it in the mapping`

/** The instruction for each field of `T` but those a mapping sets. */
type Problems<C extends Ctx, T extends Fields, Step extends string, Set = never> = {
  [K in Exclude<keyof T & string, Set>]: Problem<C, T, K, Step>
}[Exclude<keyof T & string, Set>] extends infer P extends string
  ? P
  : never

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  u: infer I,
) => void
  ? I
  : never
type IsUnion<U> = [U] extends [UnionToIntersection<U>] ? false : true

/** The name the call gave, and its declaration. */
type NameOf<N> = keyof N & string
type DeclOf<N> = N[keyof N]

/** `N` if it is one declaration of kind `D` as `{ Name }`, or else the instruction. */
type Single<N, D> = N extends { readonly __kind: unknown }
  ? "pass it as { Name }, so the compiler knows its name"
  : [keyof N] extends [never]
    ? "pass one declaration as { Name }"
    : IsUnion<keyof N> extends true
      ? "pass one declaration as { Name }"
      : DeclOf<N> extends D
        ? N
        : `${NameOf<N>} is ${KindOf<DeclOf<N>>}: pass ${Kinds<D>}`

type Article<K> = K extends "event" ? "an event" : `a ${K & string}`
type KindOf<A> = A extends { readonly __kind: infer K } ? Article<K> : "not a declaration"
type Kinds<D> = D extends { readonly __kind: infer K } ? Article<K> : never

/** One declaration and its own fields, as the context its step starts. */
type Own<N> = readonly [readonly [NameOf<N>, FieldsOf<DeclOf<N>>, never]]

/**
 * `{ Name }` as written, or, where the context leaves a field of it unfilled and the mapping does not
 * set it, the instruction. The compiler first checks `{ Name }` before it infers the mapping's result
 * `O`, while `O` is unknown, so that check passes.
 */
type Filled<C extends Ctx, N, D, Step extends string, O = Record<never, never>> =
  DeclOf<N> extends ExternalEventDecl
    ? Single<N, D>
    : unknown extends O
      ? Single<N, D>
      : [Problems<C, FieldsOf<DeclOf<N>>, Step, keyof O>] extends [never]
        ? Single<N, D>
        : Problems<C, FieldsOf<DeclOf<N>>, Step, keyof O>

/** The mapping a step takes: `c` holds each declaration before it, and `O` is what it sets. */
type Mapping<C extends Ctx, A, O> = (c: Scope<C>) => O & Out<FieldsOf<A>>

/** One row, when the filter names every key column; otherwise many. A view with no key is many. */
type Rows<K extends string, Cols> = [K] extends [never]
  ? "many"
  : [Exclude<K, Cols>] extends [never]
    ? "one"
    : "many"

type Many = "many rows: only an automation reads them, before its .command()"

/** Why a filter picks many rows. A view written in the call is typed before its `.key()` is known. */
type Unpicked<K extends string, Cols> = [K] extends [never]
  ? `the view has no .key(): ${Many}`
  : string extends K
    ? `the view has no .key(): ${Many}`
    : `key column ${Exclude<K, Cols>} is not in the filter: ${Many}`

/** The filter's columns, or the instruction. `Fan` says whether many rows are allowed here. */
type Filter<C extends Ctx, V, F, Fan extends boolean> =
  V extends ViewDecl<infer R, infer K>
    ? F extends string
      ? F extends keyof R
        ? Sources<C, F> extends readonly [infer N extends string]
          ? Fits<FieldIn<C, N, F>, R[F]> extends true
            ? Rows<K, F> extends "one"
              ? F
              : Fan extends true
                ? F
                : Unpicked<K, F>
            : `the ${F} before .query() does not fit the column: map it`
          : Sources<C, F> extends readonly []
            ? `add ${F} to a step before .query(), or map it: (c) => ({ ${F}: c.… })`
            : `${F} comes from ${Join<Sources<C, F>>}: map it`
        : `the view has no column ${F}`
      : F extends (c: Marked<C>) => infer O
        ? [Exclude<keyof O, keyof R>] extends [never]
          ? [O] extends [{ [Col in keyof O]: Col extends keyof R ? Fit<R[Col]> : never }]
            ? Rows<K, keyof O> extends "one"
              ? F
              : Fan extends true
                ? F
                : (c: Marked<C>) => Unpicked<K, keyof O>
            : (c: Marked<C>) => { [Col in keyof O]: Col extends keyof R ? Fit<R[Col]> : never }
          : (c: Marked<C>) => `the view has no column ${Exclude<keyof O, keyof R> & string}`
        : never
    : never

/** A column name, or a mapping from the context to columns; `Filter` checks which. */
type FilterArg<C extends Ctx> = string | ((c: Marked<C>) => object)

/** The columns a filter makes equal to the field of the same name before the query. */
type Equal<F> = F extends string
  ? F
  : F extends (c: never) => infer O
    ? { [K in keyof O & string]: O[K] extends From<string, K> ? K : never }[keyof O & string]
    : never

/** `C` less the entry named `N`. */
type Without<C extends Ctx, N> = C extends readonly [infer E extends Entry, ...infer R extends Ctx]
  ? E[0] extends N
    ? Without<R, N>
    : readonly [E, ...Without<R, N>]
  : readonly []

/**
 * The context after a query: the view joins it, by name, with its filter's equal columns. A view
 * queried again replaces its earlier row, since `c` holds one row per name.
 */
type Queried<C extends Ctx, N, F> = readonly [
  ...Without<C, NameOf<N>>,
  readonly [NameOf<N>, FieldsOf<DeclOf<N>>, Equal<F>],
]

/** What a slice with no event yet offers in place of `.test()`: the instruction. */
interface Gate<Msg extends string> {
  test(name: string, spec: Msg): never
}

/** A translation's start: an external event, or, for anything else, the instruction to fix it. */
type Translated<E> = E extends ExternalEventDecl
  ? E
  : E extends { readonly __kind: "view" }
    ? "is a view: poll it with .automation()"
    : "is ours: start its slice with .automation()"

/** What a `.query()` with no filter is told. */
type Unfiltered = "say which rows: a column or a mapping, () => ({}) for every row"

/** A slice at any step: what assembly reads. */
interface Step {
  readonly [META]: SliceData
}

/** A slice past its first step. Until it is complete it is drawn as far as it goes, and left to do. */
export interface Slice extends Step {
  /** The chapter it is drawn in; without one, it is drawn under "Not in a chapter yet". */
  chapter(chapter: Chapter): this
  note(text: string): this
}

/** A slice that issues a command: an actor's, or an automation's. */
interface Issuing<P extends "change" | "automation"> extends Slice {
  /** Who issues the command; for an automation, the machine of ours that runs it, without one the first declared, or else System. */
  actor(...actors: P extends "change" ? [Actor, ...Actor[]] : [SystemActor]): this
  /** Where the actors see it; without one, the command's form is drawn as their screen. */
  screen(screen: P extends "change" ? Screen : "no one sees an automation"): this
  /** The method is named after the command unless given. */
  service(
    service: P extends "change" ? Service : "an automation has no method",
    method?: string,
  ): this
}

/** A state view. */
interface Showing extends Slice {
  actor(...actors: [Actor, ...Actor[]]): this
  /** Where the actors see it; without one, the view's table is drawn as their screen. */
  screen(screen: Screen): this
  service(service: 'a state view names its method: .service(Api, "ListX")'): this
  /** A state view has no command to name its method after. */
  service(service: Service, method: string): this
}

/** A slice is written in story order, each step typed by those before it. Each call takes `{ Name }`. */
export interface Start extends Step {
  /** State change: the command an actor issues. */
  command<N extends object>(
    command: Single<N, AnyCommand>,
  ): Commanded<Own<N>, FieldsOf<DeclOf<N>>, "change">
  /** State view: the view its events build. */
  view<N extends object>(view: Single<N, AnyView>): Viewing<FieldsOf<DeclOf<N>>>
  /** Automation: an event of ours as it happens, or each row of a view it polls. */
  automation<N extends object>(
    trigger: DeclOf<N> extends ExternalEventDecl
      ? "comes from outside: start its slice with .translation()"
      : Single<N, AnyEvent | AnyView>,
  ): Triggered<Own<N>>
  /** Translation: an external event, which becomes a command. */
  translation<N extends object>(
    external: Translated<DeclOf<N>> extends string ? Translated<DeclOf<N>> : Single<N, AnyEvent>,
  ): Triggered<Own<N>, false>
  chapter(chapter: "start with .command(), .view(), .automation() or .translation()"): never
}

/** What starts an automation or a translation is known; the command is not yet. */
export interface Triggered<C extends Ctx, Fan extends boolean = true>
  extends Issuing<"automation">,
    Gate<"add .command() and .event() before .test()"> {
  query(view: Unfiltered): this
  /** Reads a view: the row joins the context. Many rows, one command each. */
  query<N extends object, const F extends FilterArg<C>>(
    view: Single<N, AnyView>,
    filter: Filter<C, DeclOf<N>, F, Fan>,
  ): Triggered<Queried<C, N, F>, Fan>
  /** The command it issues. The handler sees only the command, so the context is the command. */
  command<N extends object>(
    command: Filled<C, N, AnyCommand, ".command()">,
  ): Commanded<Own<N>, FieldsOf<DeclOf<N>>, "automation">
  command<N extends object, O>(
    command: Filled<C, N, AnyCommand, ".command()", O>,
    map: Mapping<C, DeclOf<N>, O>,
  ): Commanded<Own<N>, FieldsOf<DeclOf<N>>, "automation">
}

/** An external event brings back what the call got: it joins the context. An event of ours is an outcome. */
type Kept<C extends Ctx, N> =
  DeclOf<N> extends ExternalEventDecl
    ? readonly [...C, readonly [NameOf<N>, FieldsOf<DeclOf<N>>, never]]
    : C

/** The command is issued; no event yet. */
export interface Commanded<C extends Ctx, Cmd extends Fields, P extends "change" | "automation">
  extends Issuing<P>,
    Gate<"add .event() before .test()"> {
  query(view: Unfiltered): this
  /** What the handler reads: one row, so the filter names every key column. The row joins the context. */
  query<N extends object, const F extends FilterArg<C>>(
    view: Single<N, AnyView>,
    filter: Filter<C, DeclOf<N>, F, false>,
  ): Commanded<Queried<C, N, F>, Cmd, P>
  /** What it records. An external event is a call, and the event that brings its data back. */
  event<N extends object>(
    event: Filled<C, N, AnyEvent, ".event()">,
  ): Handled<Kept<C, N>, Cmd, FieldsOf<DeclOf<N>>, P>
  event<N extends object, O>(
    event: Filled<C, N, AnyEvent, ".event()", O>,
    map: Mapping<C, DeclOf<N>, O>,
  ): Handled<Kept<C, N>, Cmd, FieldsOf<DeclOf<N>>, P>
}

/** Exactly one of `then`, the events recorded, or `reject`, why the command is refused. */
export type Spec<C extends Fields, Em extends Fields> = {
  given?: OneOrMany<Example<"event">>
  when: Example<"command", C>
} & (
  | { then: OneOrMany<Example<"event", Em> | string>; reject?: never }
  | { reject: string; then?: never }
)

/** A complete slice that handles a command: the command and at least one event. */
export interface Handled<
  C extends Ctx,
  Cmd extends Fields,
  Em extends Fields,
  P extends "change" | "automation",
> extends Issuing<P> {
  /** Another event it can record: outcomes are alternatives, and each specification says which. */
  event<N extends object>(
    event: Filled<C, N, AnyEvent, ".event()">,
  ): Handled<Kept<C, N>, Cmd, Em | FieldsOf<DeclOf<N>>, P>
  event<N extends object, O>(
    event: Filled<C, N, AnyEvent, ".event()", O>,
    map: Mapping<C, DeclOf<N>, O>,
  ): Handled<Kept<C, N>, Cmd, Em | FieldsOf<DeclOf<N>>, P>
  test(name: string, spec: Spec<Cmd, Em> | (() => Spec<Cmd, Em>)): this
}

/** The view's event as `{ Name }`, or the instruction. */
type Projected<R extends Fields, N> =
  DeclOf<N> extends ExternalEventDecl
    ? "isn't stored: translate it into an event of ours, then project that"
    : [Misfit<FieldsOf<DeclOf<N>>, R>] extends [never]
      ? Single<N, AnyEvent>
      : Unfit<Misfit<FieldsOf<DeclOf<N>>, R>>

/** A state view's mapping: `c` holds only its event, and it sets columns. */
type ViewMapping<R extends Fields, N> = (
  c: { [P in NameOf<N>]: FieldsOf<DeclOf<N>> },
) => Out<R, Misfit<FieldsOf<DeclOf<N>>, R>>

/** The view is known; no event builds it yet. */
export interface Viewing<R extends Fields> extends Showing, Gate<"add .event() before .test()"> {
  /** An event that builds it. Each projects on its own, so a mapping reads only its event. */
  event<N extends object>(event: Projected<R, N>): Viewed<R, Record<never, never>>
  event<N extends object>(
    event: Single<N, AnyEvent>,
    map: ViewMapping<R, N>,
  ): Viewed<R, Record<never, never>>
}

/**
 * A state view's example: `given` builds the rows, `when` holds its context's values, and `then` the
 * rows the screen shows. One with no context has no `when`, and a view cannot reject an event.
 */
export type ViewSpec<Q extends Fields, R extends Fields> = {
  given?: OneOrMany<Example<"event">>
  then: OneOrMany<Example<"view", R> | string>
} & ([keyof Q] extends [never] ? { when?: never } : { when: Row<Q> })

/** A complete state view: the view and at least one event. */
export interface Viewed<R extends Fields, Q extends Fields> extends Showing {
  event<N extends object>(event: Projected<R, N>): Viewed<R, Q>
  event<N extends object>(event: Single<N, AnyEvent>, map: ViewMapping<R, N>): Viewed<R, Q>
  /** The fields it is read with, each filtering by equality on its column; without them, none. */
  context<F extends Fields>(fields: F): Viewed<R, F>
  test(name: string, spec: ViewSpec<Q, R> | (() => ViewSpec<Q, R>)): this
}

function many<T>(clauses: OneOrMany<T> | undefined): T[] {
  if (clauses === undefined) return []
  return Array.isArray(clauses) ? [...(clauses as readonly T[])] : [clauses as T]
}

interface AnySpec {
  given?: OneOrMany<Example>
  when?: Example | Record<string, unknown>
  then?: OneOrMany<Example | string>
  reject?: string
}

/**
 * A state view's `when` is its context's values, which Zod checks as it checks an example's. Each
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
  const check = (decl: DeclData, fields: Schemas, data: object) => {
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
    then:
      spec.reject === undefined
        ? many(spec.then).map((c) => (typeof c === "string" ? { description: c } : example(c)))
        : [{ message: spec.reject }],
  }
  if (view?.view && spec.when) test.context = check(view.view, view.context ?? {}, spec.when)
  else if (spec.when) test.when = example(spec.when as Example)
  if (invalid.length > 0) test.invalid = invalid
  return test
}

/** The schema of a value inside one of `schema`'s: an array's element, or an object's field `key`. */
function inner(schema: z.ZodType | undefined, key?: string): z.ZodType | undefined {
  type Def = { innerType?: z.ZodType; element?: z.ZodType; shape?: Schemas }
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
    `PT${(n % 59) + 1}M`,
    `${hex.slice(0, 8)}@example.com`,
    `https://example.com/${hex.slice(0, 8)}`,
    (n % 1000) + 1,
    n % 2 === 0,
    [],
  ]
  return values.find((v) => v !== undefined && schema?.safeParse(v).success) ?? uuid
}

// Each step copies, so a shared chain prefix can start several slices. The steps nothing extends are
// the slices, in the order written, so assembly finds every one. Every step is offered at runtime,
// whatever the compiler allows, so a model with errors is still drawn as far as it goes.
function chain(data: SliceData, context: Context, scope: InScope) {
  DRAFTS.add(data)
  const next = (patch: Partial<SliceData>, after: Context = context, inScope: InScope = scope) => {
    DRAFTS.delete(data)
    return chain({ ...data, ...patch }, after, inScope)
  }
  // `{ Name }` gives the name; a bare declaration has none, which assembly reports.
  const one = (named: object): [string | undefined, DeclData] => {
    if (META in named) return [undefined, (named as { [META]: DeclData })[META]]
    const [name, decl] = Object.entries(named)[0] as [string, { [META]: DeclData }]
    return [name, decl[META]]
  }
  const use = (named: object) => {
    const [name, decl] = one(named)
    const entry: [string, DeclData] = [name ?? decl.name ?? "", decl]
    return { decl, entry, named: [...data.named, [name, decl] as [string | undefined, DeclData]] }
  }
  return {
    [META]: data,
    command: (command: object, map?: MapFn) => {
      const { decl, entry, named } = use(command)
      // An actor fills a state change's command; an automation's is filled from what is before it.
      const issued =
        data.trigger || data.polls ? probe(decl, context, scope, map) : probe(decl, {}, [])
      return next({ command: issued, beforeCommand: data.reads.length, named }, contextOf(decl), [
        entry,
      ])
    },
    view: (view: object) => {
      const { decl, named } = use(view)
      return next({ view: decl, named }, {}, [])
    },
    automation: (trigger: object) => {
      const { decl, entry, named } = use(trigger)
      return next({ [decl.kind === "view" ? "polls" : "trigger"]: decl, named }, contextOf(decl), [
        entry,
      ])
    },
    translation: (external: object) => {
      const { decl, entry, named } = use(external)
      return next({ trigger: decl, named }, contextOf(decl), [entry])
    },
    // The row's columns join the context, as an external event's fields do, where it lacks them.
    query: (view: object, filter: string | MapFn) => {
      const { decl, entry, named } = use(view)
      // A state view's context, as it was once written, is no view.
      if (!decl) return next({})
      const read =
        typeof filter === "string"
          ? { decl, mapping: { [filter]: { from: filter } }, context }
          : probe(decl, context, scope, filter)
      return next({ reads: [...data.reads, read], named }, { ...contextOf(decl), ...context }, [
        ...scope.filter(([name]) => name !== entry[0]),
        entry,
      ])
    },
    // A state view's event projects on its own. An external event brings back what the call got, so
    // its fields join the context; an event of ours is an outcome, and the next is an alternative to it.
    event: (event: object, map?: MapFn) => {
      const { decl, entry, named } = use(event)
      if (data.view)
        return next({
          events: [...data.events, probe(decl, contextOf(decl), [entry], map)],
          named,
        })
      return next(
        { events: [...data.events, probe(decl, context, scope, map)], named },
        decl.external ? { ...contextOf(decl), ...context } : context,
        decl.external ? [...scope, entry] : scope,
      )
    },
    context: (fields: Schemas) => next({ context: fields }),
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
    // A function runs at assembly, after every module, so its examples may be declared below it.
    test: (name: string, spec: AnySpec | (() => AnySpec)) => {
      const view = data.view ? data : undefined
      const test: TestData =
        typeof spec === "function"
          ? { name, given: [], then: [], later: () => testData(name, spec(), view) }
          : testData(name, spec, view)
      return next({ tests: [...data.tests, test] })
    },
    note: (text: string) => next({ note: noted(data.note, text) }),
    chapter: (chapter: Chapter) => next({ chapters: [...data.chapters, chapter[META]] }),
  }
}

/** A column of the diagram, written in story order. Pass a name only when the one it would take misleads. */
function slice(name?: string): Start {
  const empty: SliceData = { actors: [], reads: [], events: [], tests: [], chapters: [], named: [] }
  if (name !== undefined) empty.name = name
  return chain(empty, {}, []) as unknown as Start
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
