// Everything a model is written with: `m` declares and writes slices, `d` names, `t` builds fields.
// The `__` members exist only for the compiler; assembly reads `META`.
import { createHash } from "node:crypto"
import { z } from "zod"

import { type AnyField, type Fields, isKey, type List, type Row, t, type Value } from "./t.ts"
import {
  type ActorData,
  type ChapterData,
  type Context,
  type DeclData,
  type DeclKind,
  DRAFTS,
  type ExampleData,
  type Exported,
  type ExternalData,
  type Flow,
  type MapFn,
  META,
  type ModelData,
  REGISTRY,
  resolve,
  type Fields as Schemas,
  type ScreenData,
  type ServiceData,
  type SliceData,
  type StreamData,
  type TestData,
  WRITTEN,
  type Written,
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

/** `d.Name`: a declaration by its name. Called with data, it is an example its fields check. */
export interface Decl<N extends string, K extends DeclKind, F extends Fields> {
  (data: Partial<Infer<F>>): Example<K, F>
  readonly [META]: DeclData
  readonly __name: N
  readonly __kind: K
  readonly __fields: F
}

export type EventDecl<N extends string = string, F extends Fields = Fields> = Decl<N, "event", F>
export type CommandDecl<N extends string = string, F extends Fields = Fields> = Decl<
  N,
  "command",
  F
>

/**
 * A view, with its key columns in its fields and whether it is a list, so `.query()` can count the
 * rows it reads.
 */
export interface ViewDecl<
  N extends string = string,
  F extends Fields = Fields,
  L extends boolean = boolean,
> extends Decl<N, "view", F> {
  readonly __list: L
}

/** An event of a system we do not own. */
export interface ExternalEventDecl<N extends string = string, F extends Fields = Fields>
  extends EventDecl<N, F> {
  readonly __external: true
}

/** `d.Name` of a person, a role or a machine. */
export interface Actor {
  readonly [META]: ActorData
}

/** A machine of ours, which can run automations and state views. */
export interface SystemActor extends Actor {
  readonly __system: true
}

export interface Service {
  readonly [META]: ServiceData
}

export interface Screen {
  readonly [META]: ScreenData
}

export interface Stream {
  readonly [META]: StreamData
}

export interface External {
  readonly [META]: ExternalData
}

export interface Chapter {
  readonly [META]: ChapterData
}

/**
 * Every declaration by name. `em types` writes its members into `em-registry.d.ts`, beside the
 * model, from what the model declares.
 */
// biome-ignore lint/suspicious/noEmptyInterface: em types writes the members
export interface Registry {}

/** What a declaration takes after it is declared. A second `.note()` adds to the first. */
export interface Noted {
  note(text: string): this
}

export interface EventNoted extends Noted {
  /** Draws the event in the stream's lane. */
  stream(stream: Stream): this
  /** Makes it the event of a system we do not own, drawn in that system's lane. */
  external(system: External): this
}

/** A second `.note()` adds to the first, on a line of its own. */
function noted(note: string | undefined, text: string): string {
  return note === undefined ? text : `${note}\n${text}`
}

/** The first frame outside this file: the model's call. */
function caller(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1)
  const frame = frames.find((f) => !f.includes(import.meta.url) && !f.includes("node:")) ?? ""
  return /\(?(\S+:\d+:\d+)\)?$/.exec(frame.trim())?.[1] ?? ""
}

/** Lanes, systems and headings are one by name, however often declared; anything else is one declaration. */
const SHARED = new Set(["stream", "external", "chapter"])

/** Names `data`, or returns the lane or heading already declared with its name. */
function declare<D extends Exported>(name: string, data: D): D {
  const where = caller()
  const had = REGISTRY.get(name)
  if (had && had.data.kind === data.kind && SHARED.has(data.kind)) return had.data as D
  data.name = name
  if (had) had.also.push(where)
  else REGISTRY.set(name, { data, where, also: [] })
  return data
}

const handles = new Map<string, unknown>()

/**
 * `d.Name`, looked up when assembly reads it, so a slice may name a declaration from a module that
 * runs later. Called with data, it is an example; its fields check it once the specification has
 * filled its generated values.
 */
function handle(name: string): unknown {
  const made = handles.get(name)
  if (made) return made
  const call = (data: Record<string, unknown>) => ({
    get [META](): ExampleData {
      return { decl: resolve(call) as DeclData, data }
    },
  })
  Object.defineProperty(call, "name", { value: name })
  Object.defineProperty(call, META, { get: () => resolve(call) })
  handles.set(name, call)
  return call
}

/** Each declaration by name: `d.ListCreated`. `em types` types it. */
export const d = new Proxy({} as Registry, {
  get: (_, name) => (typeof name === "string" ? handle(name) : undefined),
})

/** What declaring `data` returns: `.note()` adds to its note. */
function noting(data: { note?: string }): Noted {
  return {
    note(text) {
      data.note = noted(data.note, text)
      return this
    },
  }
}

function decl(name: string, kind: DeclKind, fields: Fields): [Noted, DeclData] {
  const data = declare(name, { kind, fields: fields as unknown as Schemas, keys: [] } as DeclData)
  return [noting(data), data]
}

/** `F`, or, for a field marked `.key()`, the instruction. */
type Unkeyed<F extends Fields> = {
  [K in keyof F]: F[K] extends { readonly __key: true }
    ? `${K & string}: only a view has key columns. Remove .key().`
    : F[K]
}

/** Something that happened, in the past tense, with its fields. */
function event<F extends Fields>(name: string, fields: F & Unkeyed<F>): EventNoted {
  const [builder, data] = decl(name, "event", fields)
  return Object.assign(builder, {
    stream(stream: Stream) {
      data.stream = stream
      return builder
    },
    external(system: External) {
      data.system = system
      return builder
    },
  }) as EventNoted
}

/** What an actor wants to happen, with its fields. */
function command<F extends Fields>(name: string, fields: F & Unkeyed<F>): Noted {
  return decl(name, "command", fields)[0]
}

/**
 * A table built from events, looked up by its fields marked `.key()`. With none it has one row.
 * Given `t.array({ … })`, it is a list: each event adds a row, and a lookup gives every row it
 * matches.
 */
function view<F extends Fields>(name: string, fields: F | List<F>): Noted {
  const list = "_zod" in fields
  const row = list ? (inner(fields as never) as z.ZodObject | undefined)?.shape : fields
  const [builder, data] = decl(name, "view", (row ?? {}) as Fields)
  data.keys = Object.keys(data.fields).filter((k) => isKey(data.fields[k] as object))
  if (list) data.list = true
  return builder
}

let actors = 0

/** A person; `{ icon: "admin" }` for one with authority; `{ icon: "system" }` for a machine of ours. */
function actor(name: string, options: { icon?: "user" | "admin" | "system" } = {}): Noted {
  return noting(
    declare(name, { kind: "actor", icon: options.icon ?? "user", order: actors++ } as ActorData),
  )
}

/** The API a slice's method is on, and its protobuf package, such as `todo.v1`. */
function service(name: string, pkg: string): Noted {
  return noting(declare(name, { kind: "service", pkg } as ServiceData))
}

/** What an actor sees a slice on. Several slices can share one. */
function screen(name: string): Noted {
  return noting(declare(name, { kind: "screen" } as ScreenData))
}

let streams = 0

/** A lane. An event joins it with `.stream()`. */
function stream(name: string): void {
  declare(name, { kind: "stream", order: streams++ } as StreamData)
}

/** A system we do not own: a lane its events join with `.external()`. */
function external(name: string): void {
  declare(name, { kind: "external" } as ExternalData)
}

let chapters = 0

/**
 * A run of slices under one heading. Chapters are drawn in the order of their numbers, so
 * `m.chapter("Capture", 1)` comes first; one with no number yet comes after. A slice joins it with
 * `.chapter()`.
 */
function chapter(name: string, number?: number): Noted {
  const made: ChapterData = { kind: "chapter", order: chapters++ }
  if (number !== undefined) made.number = number
  return noting(declare(name, made))
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

// A mapping runs once, on a copy of each field's schema before its step, to learn which fills each target.
const SOURCE = Symbol("source")
const GENERATE = Symbol("generate")

/** Each copy's field and declaration. A copy per field, so two fields that share a schema stay apart. */
const FIELDS = new WeakMap<object, { field: string; decl: DeclData }>()

/** Each declaration before a step, by its name, as `c` holds it. */
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
    `m.generate() takes fields of c, such as m.generate(c.AddNote.title), not ${String(value)}.`,
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
    // The picture never refuses a model: the step is drawn, and what threw is an error.
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
type AnyCommand = CommandDecl<string, any>
// biome-ignore lint/suspicious/noExplicitAny: any event's fields
type AnyEvent = EventDecl<string, any>
// biome-ignore lint/suspicious/noExplicitAny: any view's columns
type AnyView = ViewDecl<string, any, boolean>

/**
 * Each declaration before a step, in order, by its name: `[name, fields, eq]`.
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

/** A field of `D` that would flow by name but does not fit: the sentence a mapping that sets it gets. */
type Unfit<
  D extends string,
  K extends string,
> = `${D}.${K}: doesn't fit. Set it to a field of its type, a t.literal() or m.generate().`

/** What keeps field `K` of `D` from flowing by name, as the instruction; never if it flows. */
type Problem<
  C extends Ctx,
  D extends string,
  T extends Fields,
  K extends keyof T & string,
  Step extends string,
> =
  Sources<C, K> extends readonly [infer N extends string]
    ? Fits<FieldIn<C, N, K>, T[K]> extends true
      ? never
      : Unfit<D, K>
    : Sources<C, K> extends readonly []
      ? K extends Needed<T>
        ? `${D}.${K}: no source. Add ${K} to a step before ${Step}, or set it in the mapping.`
        : never
      : `${D}.${K}: comes from ${Join<Sources<C, K>>}. Set it in the mapping.`

/** The instruction for each field of `T`, which `D` declares, but those a mapping sets. */
type Problems<
  C extends Ctx,
  D extends string,
  T extends Fields,
  Step extends string,
  Set = never,
> = {
  [K in Exclude<keyof T & string, Set>]: Problem<C, D, T, K, Step>
}[Exclude<keyof T & string, Set>] extends infer P extends string
  ? P
  : never

/** The name `d.Name` carries. */
type NameOf<N> = N extends { readonly __name: infer S extends string } ? S : "it"

/** `N` if it is a declaration of kind `D`, or else the instruction. */
type Single<N, D> = N extends D
  ? N
  : N extends { readonly __name: infer S extends string; readonly __kind: infer K }
    ? `${S}: is ${Article<K>}; pass ${Kinds<D>}.`
    : `not a declaration. Pass ${Kinds<D>} as d.Name.`

type Article<K> = K extends "event" ? "an event" : `a ${K & string}`
type Kinds<D> = D extends { readonly __kind: infer K } ? Article<K> : never

/** One declaration and its own fields, as the context its step starts. */
type Own<N> = readonly [readonly [NameOf<N>, FieldsOf<N>, never]]

/**
 * `d.Name` as written, or, where the context leaves a field of it unfilled and the mapping does not
 * set it, the instruction. The compiler first checks `d.Name` before it infers the mapping's result
 * `O`, while `O` is unknown, so that check passes.
 */
type Filled<
  C extends Ctx,
  N,
  D,
  Step extends string,
  O = Record<never, never>,
> = N extends ExternalEventDecl
  ? Single<N, D>
  : unknown extends O
    ? Single<N, D>
    : [Problems<C, NameOf<N>, FieldsOf<N>, Step, keyof O>] extends [never]
      ? Single<N, D>
      : Problems<C, NameOf<N>, FieldsOf<N>, Step, keyof O>

/** The mapping a step takes: `c` holds each declaration before it, and `O` is what it sets. */
type Mapping<C extends Ctx, A, O> = (c: Scope<C>) => O & Out<FieldsOf<A>>

/** A view's key columns: the fields marked `.key()`. */
type KeysOf<F> = { [K in keyof F]: F[K] extends { readonly __key: true } ? K : never }[keyof F] &
  string

/**
 * One row when the view is no list and the filter names every key column, which a view with none
 * always does; otherwise many.
 */
type Rows<R, L, Cols> = L extends true
  ? "many"
  : [Exclude<KeysOf<R>, Cols>] extends [never]
    ? "one"
    : "many"

/** Why a filter of view `V` picks many rows. */
type Unpicked<V, R, L, Cols> =
  `${NameOf<V>}: many rows (${L extends true ? "the view is a list" : `key column ${Exclude<KeysOf<R>, Cols> & string} isn't in the filter`}); only an automation reads many, before its .command().`

/** The filter's columns, or the instruction. `Fan` says whether many rows are allowed here. */
type Filter<C extends Ctx, V, F, Fan extends boolean> =
  V extends ViewDecl<string, infer R, infer L>
    ? F extends string
      ? F extends keyof R
        ? Sources<C, F> extends readonly [infer N extends string]
          ? Fits<FieldIn<C, N, F>, R[F]> extends true
            ? Rows<R, L, F> extends "one"
              ? F
              : Fan extends true
                ? F
                : Unpicked<V, R, L, F>
            : `${NameOf<V>}.${F}: doesn't fit the column. Map it.`
          : Sources<C, F> extends readonly []
            ? `${NameOf<V>}.${F}: no source. Add ${F} to a step before .query(), or map it: (c) => ({ ${F}: c.… }).`
            : `${NameOf<V>}.${F}: comes from ${Join<Sources<C, F>>}. Map it.`
        : `${NameOf<V>}: no column ${F}.`
      : F extends (c: Marked<C>) => infer O
        ? [Exclude<keyof O, keyof R>] extends [never]
          ? [O] extends [{ [Col in keyof O]: Col extends keyof R ? Fit<R[Col]> : never }]
            ? Rows<R, L, keyof O> extends "one"
              ? F
              : Fan extends true
                ? F
                : (c: Marked<C>) => Unpicked<V, R, L, keyof O>
            : (c: Marked<C>) => { [Col in keyof O]: Col extends keyof R ? Fit<R[Col]> : never }
          : (c: Marked<C>) => `${NameOf<V>}: no column ${Exclude<keyof O, keyof R> & string}.`
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
  readonly [NameOf<N>, FieldsOf<N>, Equal<F>],
]

/** What a slice with no event yet offers in place of `.spec()`: the instruction. */
interface Gate<Msg extends string> {
  spec(name: string, spec: Msg): never
}

/** A translation's start: an external event, or, for anything else, the instruction to fix it. */
type Translated<E> = E extends ExternalEventDecl
  ? E
  : `${NameOf<E>}: not an outside event. Start its slice with .automation(d.${NameOf<E>}).`

/** What a `.query()` of view `N` with no filter is told, unless the view has one row. */
type Unfiltered<N> =
  `${NameOf<N>}: say which rows: a column, a mapping, or () => ({}) for every row.`

/** `N` if it is a view of one row, with no key column, which needs no filter; or else the instruction. */
type OneRow<N> =
  N extends ViewDecl<string, infer R, false>
    ? [KeysOf<R>] extends [never]
      ? Single<N, AnyView>
      : Unfiltered<N>
    : Unfiltered<N>

/** A slice past its first step. Until it is complete it is drawn as far as it goes, and warns of what it lacks. */
export interface Slice {
  /** The chapter it is drawn in; without one, it is drawn after the chapters, with no heading. */
  chapter(chapter: Chapter): this
  note(text: string): this
}

/** A slice that issues a command: an actor's, or an automation's. */
interface Issuing<P extends "change" | "automation"> extends Slice {
  /** Who issues the command; for an automation, the machine of ours that runs it, without one the first declared, or else System. */
  actor(...actors: P extends "change" ? [Actor, ...Actor[]] : [SystemActor]): this
  /** Where the actors see it; without one, the command's form is drawn as their screen. */
  screen(screen: P extends "change" ? Screen : "no one sees an automation. Remove .screen()."): this
  /** The method is named after the command unless given. */
  service(
    service: P extends "change" ? Service : "an automation has no method. Remove .service().",
    method?: string,
  ): this
}

/** A state view. */
interface Showing extends Slice {
  actor(...actors: [Actor, ...Actor[]]): this
  /** Where the actors see it; without one, the view's table is drawn as their screen. */
  screen(screen: Screen): this
  service(service: 'method has no name. Write .service(d.Api, "ListX").'): this
  /** A state view has no command to name its method after. */
  service(service: Service, method: string): this
}

/** A slice is written in story order, each step typed by those before it. Each call takes `d.Name`. */
export interface Start {
  /** State change: the command an actor issues. */
  command<N extends object>(
    command: Single<N, AnyCommand>,
  ): Commanded<Own<N>, FieldsOf<N>, "change">
  /** State view: the view its events build. */
  view<N extends object>(view: Single<N, AnyView>): Viewing<FieldsOf<N>>
  /** Automation: an event of ours as it happens, or each row of a view it polls. */
  automation<N extends object>(
    trigger: N extends ExternalEventDecl
      ? `${NameOf<N>}: comes from outside. Start its slice with .translation(d.${NameOf<N>}).`
      : Single<N, AnyEvent | AnyView>,
  ): Triggered<Own<N>>
  /** Translation: an external event, which becomes a command. */
  translation<N extends object>(
    external: Translated<N> extends string ? Translated<N> : Single<N, AnyEvent>,
  ): Triggered<Own<N>, false>
  chapter(
    chapter: "empty. Start it with .command(), .view(), .automation() or .translation().",
  ): never
}

/** What starts an automation or a translation is known; the command is not yet. */
export interface Triggered<C extends Ctx, Fan extends boolean = true>
  extends Issuing<"automation">,
    Gate<"no command. Add .command() and .event() before .spec()."> {
  /** Reads the one row of a view with no key column. */
  query<N extends object>(
    view: OneRow<N>,
  ): OneRow<N> extends string ? this : Triggered<Queried<C, N, never>, Fan>
  /** Reads a view: the row joins the context. Many rows, one command each. */
  query<N extends object, const F extends FilterArg<C>>(
    view: Single<N, AnyView>,
    filter: Filter<C, N, F, Fan>,
  ): Triggered<Queried<C, N, F>, Fan>
  /** The command it issues. The handler sees only the command, so the context is the command. */
  command<N extends object>(
    command: Filled<C, N, AnyCommand, ".command()">,
  ): Commanded<Own<N>, FieldsOf<N>, "automation">
  command<N extends object, O>(
    command: Filled<C, N, AnyCommand, ".command()", O>,
    map: Mapping<C, N, O>,
  ): Commanded<Own<N>, FieldsOf<N>, "automation">
}

/** An external event brings back what the call got: it joins the context. An event of ours is an outcome. */
type Kept<C extends Ctx, N> = N extends ExternalEventDecl
  ? readonly [...C, readonly [NameOf<N>, FieldsOf<N>, never]]
  : C

/** The command is issued; no event yet. */
export interface Commanded<C extends Ctx, Cmd extends Fields, P extends "change" | "automation">
  extends Issuing<P>,
    Gate<"no event. Add .event() before .spec()."> {
  /** Reads the one row of a view with no key column. */
  query<N extends object>(
    view: OneRow<N>,
  ): OneRow<N> extends string ? this : Commanded<Queried<C, N, never>, Cmd, P>
  /** What the handler reads: one row, so the filter names every key column. The row joins the context. */
  query<N extends object, const F extends FilterArg<C>>(
    view: Single<N, AnyView>,
    filter: Filter<C, N, F, false>,
  ): Commanded<Queried<C, N, F>, Cmd, P>
  /** What it records. An external event is a call, and the event that brings its data back. */
  event<N extends object>(
    event: Filled<C, N, AnyEvent, ".event()">,
  ): Handled<Kept<C, N>, Cmd, FieldsOf<N>, P>
  event<N extends object, O>(
    event: Filled<C, N, AnyEvent, ".event()", O>,
    map: Mapping<C, N, O>,
  ): Handled<Kept<C, N>, Cmd, FieldsOf<N>, P>
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
  ): Handled<Kept<C, N>, Cmd, Em | FieldsOf<N>, P>
  event<N extends object, O>(
    event: Filled<C, N, AnyEvent, ".event()", O>,
    map: Mapping<C, N, O>,
  ): Handled<Kept<C, N>, Cmd, Em | FieldsOf<N>, P>
  spec(name: string, spec: Spec<Cmd, Em> | (() => Spec<Cmd, Em>)): this
}

/** The view's event as `d.Name`, or the instruction. */
type Projected<R extends Fields, N> = N extends ExternalEventDecl
  ? `${NameOf<N>}: not stored. Translate it into an event of ours, then project that.`
  : [Misfit<FieldsOf<N>, R>] extends [never]
    ? Single<N, AnyEvent>
    : Unfit<NameOf<N>, Misfit<FieldsOf<N>, R>>

/** A state view's mapping: `c` holds only its event, and it sets columns. */
type ViewMapping<R extends Fields, N> = (
  c: { [P in NameOf<N>]: FieldsOf<N> },
) => Out<R, Misfit<FieldsOf<N>, R>>

/** The view is known; no event builds it yet. */
export interface Viewing<R extends Fields>
  extends Showing,
    Gate<"no event. Add .event() before .spec()."> {
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
  spec(name: string, spec: ViewSpec<Q, R> | (() => ViewSpec<Q, R>)): this
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
 * compares it as any other. A value Zod refuses is kept as written and is an error.
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
      invalid.push({ decl, path: z.core.toDotPath(issue.path), message: issue.message })
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
  const use = (ref: unknown, as: string) => {
    const decl = resolve(ref, as) as DeclData
    return { decl, entry: [decl.name ?? "", decl] as [string, DeclData] }
  }
  return {
    [META]: data,
    command: (command: unknown, map?: MapFn) => {
      const { decl, entry } = use(command, "m.command")
      // An actor fills a state change's command; an automation's is filled from what is before it.
      const issued =
        data.trigger || data.polls ? probe(decl, context, scope, map) : probe(decl, {}, [])
      return next({ command: issued, beforeCommand: data.reads.length }, contextOf(decl), [entry])
    },
    view: (view: unknown) => next({ view: use(view, "m.view").decl }, {}, []),
    automation: (trigger: unknown) => {
      const { decl, entry } = use(trigger, "m.event")
      return next({ [decl.kind === "view" ? "polls" : "trigger"]: decl }, contextOf(decl), [entry])
    },
    translation: (external: unknown) => {
      const { decl, entry } = use(external, "m.event")
      return next({ trigger: decl }, contextOf(decl), [entry])
    },
    // The row's columns join the context, as an external event's fields do, where it lacks them.
    query: (view: unknown, filter?: string | MapFn) => {
      const { decl, entry } = use(view, "m.view")
      const read =
        typeof filter === "string"
          ? { decl, mapping: { [filter]: { from: filter } }, context }
          : probe(decl, context, scope, filter)
      return next({ reads: [...data.reads, read] }, { ...contextOf(decl), ...context }, [
        ...scope.filter(([name]) => name !== entry[0]),
        entry,
      ])
    },
    // A state view's event projects on its own. An external event brings back what the call got, so
    // its fields join the context; an event of ours is an outcome, and the next is an alternative to it.
    event: (event: unknown, map?: MapFn) => {
      const { decl, entry } = use(event, "m.event")
      if (data.view)
        return next({ events: [...data.events, probe(decl, contextOf(decl), [entry], map)] })
      return next(
        { events: [...data.events, probe(decl, context, scope, map)] },
        decl.external ? { ...contextOf(decl), ...context } : context,
        decl.external ? [...scope, entry] : scope,
      )
    },
    context: (fields: Schemas) => next({ context: fields }),
    // An automation is run by one machine of ours, and no one sees it.
    actor: (...actors: unknown[]) => {
      const named = actors.map((a) => resolve(a, "m.actor") as ActorData)
      return next(
        data.trigger || data.polls
          ? named[0]
            ? { system: named[0] }
            : {}
          : { actors: [...data.actors, ...named] },
      )
    },
    screen: (screen: unknown) => next({ screen: resolve(screen, "m.screen") as ScreenData }),
    service: (service: unknown, method?: string) => {
      const api = resolve(service, "m.service") as ServiceData
      return next({ service: method === undefined ? { service: api } : { service: api, method } })
    },
    // A function runs at assembly, after every module, so its examples may be declared below it.
    spec: (name: string, spec: AnySpec | (() => AnySpec)) => {
      const view = data.view ? data : undefined
      const test: TestData =
        typeof spec === "function"
          ? { name, given: [], then: [], later: () => testData(name, spec(), view) }
          : testData(name, spec, view)
      return next({ tests: [...data.tests, test] })
    },
    note: (text: string) => next({ note: noted(data.note, text) }),
    chapter: (chapter: unknown) =>
      next({ chapters: [...data.chapters, resolve(chapter, "m.chapter") as ChapterData] }),
  }
}

/**
 * A slice as written: each call is kept, and made at assembly, once every module has run, so a slice
 * may name a declaration from a module that runs after it. Like a step, each call copies.
 */
function written(slice: Written): unknown {
  WRITTEN.add(slice)
  return new Proxy(
    {},
    {
      // Not a promise, so a slice an async function returns is the slice.
      get: (_, method) =>
        typeof method !== "string" || method === "then"
          ? undefined
          : (...args: unknown[]) => {
              WRITTEN.delete(slice)
              return written({ ...slice, calls: [...slice.calls, [method, args]] })
            },
    },
  )
}

/** A column of the diagram, written in story order. Pass a name only when the one it would take misleads. */
function slice(name?: string): Start {
  const empty: SliceData = { actors: [], reads: [], events: [], tests: [], chapters: [] }
  if (name !== undefined) empty.name = name
  return written({ start: () => chain(empty, {}, []), calls: [] }) as Start
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
