// Everything a model is written with, under `m`.
// `__kind` and `__fields` exist only for the compiler; assembly reads `META`.
import { createHash } from "node:crypto"
import { z } from "zod"

// One copy of Zod for the model and the package.
export { z }

import {
  type ActorData,
  type ChapterData,
  type Context,
  type DeclData,
  type DeclKind,
  DRAFTS,
  type ExampleData,
  type ExternalData,
  type Fields,
  type Flow,
  type MapFn,
  META,
  type ModelData,
  type ScreenData,
  type ServiceData,
  type SliceData,
  type StreamData,
  type TestData,
} from "./types.ts"

type Infer<F extends Fields> = { [P in keyof F]: z.infer<F[P]> }
type OneOrMany<T> = T | readonly T[]

/** The fields that must have a value: an optional one may go unfilled in a slice, if another fills it. */
type Needed<T extends Fields> = {
  [K in keyof T]: undefined extends z.input<T[K]> ? never : K
}[keyof T]

/**
 * What a target field takes: a string format takes only that format, and any other type any schema
 * with its output.
 */
type Fit<T extends z.ZodType> =
  T extends z.ZodStringFormat<infer F> ? z.ZodStringFormat<F> : z.ZodType<z.output<T>>

/**
 * A mapping's result: for each target field, a field before the step, a `z.literal()` or
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
      [K in keyof T & keyof S]: (S[K] extends z.ZodOptional<infer U> ? U : S[K]) extends Fit<T[K]>
        ? never
        : K
    }[keyof T & keyof S] &
      string

/** What the mapping must set: what `S` lacks, and what it has that does not fit. */
type Unfilled<S extends Fields, T extends Fields> =
  | (Exclude<Needed<T>, keyof S> & string)
  | Misfit<S, T>

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

function decl<K extends DeclKind, F extends Fields>(kind: K, fields: F): Decl<K, F> {
  const data: DeclData = { kind, fields, keys: [] }
  // Zod checks an example once the specification it is in has filled its generated values.
  const call = (arg: Record<string, unknown>): Example<K, F> =>
    ({ [META]: { decl: data, data: arg }, __kind: kind, __fields: fields }) as Example<K, F>
  const declared = Object.assign(call as Decl<K, F>, {
    [META]: data,
    __kind: kind,
    __fields: fields,
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

// A mapping runs once, on a copy of each field's schema before its step, to learn which fills each target.
const SOURCE = Symbol("source")
const GENERATE = Symbol("generate")

/** Each copy's field name. A copy per field, so two fields that share a schema stay apart. */
const FIELDS = new WeakMap<object, string>()

/** A copy of each field's schema in the context, marked with its name. */
function copies(context: Context): Fields {
  return Object.fromEntries(
    Object.entries(context).map(([f, from]) => {
      const copy = (from.fields[f] ?? z.unknown()).clone()
      FIELDS.set(copy, f)
      return [f, copy]
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
  if (field !== undefined) return field
  const source = (value as { [SOURCE]?: DeclData } | undefined)?.[SOURCE]
  if (source) return source
  throw new Error(
    `m.generate() takes fields of the mapping's argument, such as m.generate(c.title), not ${String(value)}.`,
  )
}

/**
 * A value the handler makes: from fields before its step, such as `m.generate(c.title)`; in a state
 * view, from the event, such as `m.generate(e)` for a count; from nothing, `m.generate()`, it is an
 * id or a clock. In a specification, `m.generate()` is a value of its field's type that no other
 * generated value has. It returns a marker, so the probe can tell it from a field or a constant.
 */
function generate<T = never>(...inputs: unknown[]): T {
  return { [GENERATE]: inputs.map(input) } as T
}

/**
 * What a mapping put in each target: a field before its step, a constant from `z.literal()`, or a
 * generated value. Anything else, such as a field's schema changed by a Zod method, is computed, and
 * marked `built` for assembly to report. `whole` is what `m.generate(e)` stands for.
 */
function probe(decl: DeclData, context: Context, map?: MapFn, whole?: DeclData): Flow {
  const flow: Flow = { decl, mapping: {}, context }
  if (!map) return flow
  const c = { ...copies(context), ...(whole && { [SOURCE]: whole }) }
  for (const [field, value] of Object.entries(map(c as never))) {
    const from = typeof value === "object" && value !== null ? FIELDS.get(value) : undefined
    const def = (value as { _zod?: { def?: { type?: string; values?: unknown[] } } })?._zod?.def
    flow.mapping[field] = isGenerated(value)
      ? { generate: value[GENERATE] }
      : from !== undefined
        ? { from }
        : def?.type === "literal" && def.values?.length === 1
          ? { value: def.values[0] }
          : { generate: [], built: true }
  }
  return flow
}

// ---------------------------------------------------------------------------
// The slice chain
// ---------------------------------------------------------------------------

type Flat<T> = { [K in keyof T]: T[K] } & {}
/** The context after a step: everything before it, and what it adds that is not there yet. */
type Joined<A extends Fields, B extends Fields> = Flat<A & Omit<B, keyof A>>
type FieldsOf<A> = A extends { readonly __fields: infer F extends Fields } ? F : never

// biome-ignore lint/suspicious/noExplicitAny: any command's fields
type AnyCommand = CommandDecl<any>
// biome-ignore lint/suspicious/noExplicitAny: any event's fields
type AnyEvent = EventDecl<any>
// biome-ignore lint/suspicious/noExplicitAny: any view's columns
type AnyView = ViewDecl<any, string>

/** `A` as written, or, where the context leaves a field of it unfilled, the instruction. */
type Filled<Ctx extends Fields, A, Step extends string> = A extends ExternalEventDecl
  ? A
  : [Unfilled<Ctx, FieldsOf<A>>] extends [never]
    ? A
    : [Misfit<Ctx, FieldsOf<A>>] extends [never]
      ? `add ${Unfilled<Ctx, FieldsOf<A>>} to a step before ${Step} or set it in the mapping`
      : `the ${Misfit<Ctx, FieldsOf<A>>} before ${Step} does not fit: set it in the mapping`

/** The mapping a step takes: `c` is the context, and it must set what the context leaves unfilled. */
type Mapping<Ctx extends Fields, A> = (c: Ctx) => Out<FieldsOf<A>, Unfilled<Ctx, FieldsOf<A>>>

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
type Filter<Ctx extends Fields, V, F, Fan extends boolean> =
  V extends ViewDecl<infer R, infer K>
    ? F extends string
      ? F extends keyof R
        ? F extends keyof Ctx
          ? [Misfit<Pick<Ctx, F>, R>] extends [never]
            ? Rows<K, F> extends "one"
              ? F
              : Fan extends true
                ? F
                : Unpicked<K, F>
            : `the ${F} before .query() does not fit the column: map it`
          : `add ${F} to a step before .query(), or map it: (c) => ({ ${F}: c.… })`
        : `the view has no column ${F}`
      : F extends (c: Ctx) => infer O
        ? [Exclude<keyof O, keyof R>] extends [never]
          ? [O] extends [{ [C in keyof O]: C extends keyof R ? Fit<R[C]> : never }]
            ? Rows<K, keyof O> extends "one"
              ? F
              : Fan extends true
                ? F
                : (c: Ctx) => Unpicked<K, keyof O>
            : (c: Ctx) => { [C in keyof O]: C extends keyof R ? Fit<R[C]> : never }
          : (c: Ctx) => `the view has no column ${Exclude<keyof O, keyof R> & string}`
        : never
    : never

/** A column name, or a mapping from the context to columns; `Filter` checks which. */
type FilterArg<Ctx extends Fields> = string | ((c: Ctx) => object)

/** What an incomplete slice offers in place of `.chapter()` and `.test()`: the instruction. */
interface Gate<Msg extends string> {
  chapter(chapter: Msg): never
  test(name: string, spec: Msg): never
}

/** A translation's start: an external event, or, for anything else, the instruction to fix it. */
type Translated<E> = E extends ExternalEventDecl
  ? E
  : E extends { readonly __kind: "view" }
    ? "is a view: poll it with .automation()"
    : "is ours: start its slice with .automation()"

/** A slice at any step: what assembly reads. */
interface Step {
  readonly [META]: SliceData
}

/** A complete slice. */
export interface Slice extends Step {
  /** The chapter it is drawn in; without one, it is drawn under "Not in a chapter yet". */
  chapter(chapter: Chapter): this
}

/** A slice is written in story order, each step typed by those before it. */
export interface Start extends Step {
  /** State change: the command an actor issues. */
  command<A extends AnyCommand>(command: A): Commanded<FieldsOf<A>, FieldsOf<A>, "change">
  /** State view: the view its events build. */
  view<V extends AnyView>(view: V): Viewing<FieldsOf<V>>
  /** Automation: an event of ours as it happens, or each row of a view it polls. */
  automation<T extends AnyEvent | AnyView>(
    trigger: T extends ExternalEventDecl
      ? "comes from outside: start its slice with .translation()"
      : T,
  ): Triggered<FieldsOf<T>>
  /** Translation: an external event, which becomes a command. */
  translation<E extends AnyEvent | AnyView>(external: Translated<E>): Triggered<FieldsOf<E>, false>
  chapter(chapter: "start with .command(), .view(), .automation() or .translation()"): never
}

/** What starts an automation or a translation is known; the command is not yet. */
export interface Triggered<Ctx extends Fields, Fan extends boolean = true>
  extends Step,
    Gate<"add .command() and .event() before .chapter()"> {
  /** Reads a view: the row's columns join the context. Many rows, one command each. */
  query<V extends AnyView, const F extends FilterArg<Ctx>>(
    view: V,
    filter: Filter<Ctx, V, F, Fan>,
  ): Triggered<Joined<Ctx, FieldsOf<V>>, Fan>
  /** The command it issues. The handler sees only the command, so the context is its fields. */
  command<A extends AnyCommand>(
    command: Filled<Ctx, A, ".command()">,
  ): Commanded<FieldsOf<A>, FieldsOf<A>, "automation">
  command<A extends AnyCommand>(
    command: A,
    map: Mapping<Ctx, A>,
  ): Commanded<FieldsOf<A>, FieldsOf<A>, "automation">
}

/** An external event's fields are a reply: they join the context. An event of ours is an outcome. */
type Kept<Ctx extends Fields, A> = A extends ExternalEventDecl<infer R> ? Joined<Ctx, R> : Ctx

/** The command is issued; no event yet. */
export interface Commanded<Ctx extends Fields, C extends Fields, P extends "change" | "automation">
  extends Step,
    Gate<"add .event() before .chapter()"> {
  /** What the handler reads: one row, so the filter names every key column. Its columns join the context. */
  query<V extends AnyView, const F extends FilterArg<Ctx>>(
    view: V,
    filter: Filter<Ctx, V, F, false>,
  ): Commanded<Joined<Ctx, FieldsOf<V>>, C, P>
  /** What it records. An external event is a call, and the event that brings its data back. */
  event<A extends AnyEvent>(
    event: Filled<Ctx, A, ".event()">,
  ): Handled<Kept<Ctx, A>, C, FieldsOf<A>, P>
  event<A extends AnyEvent>(
    event: A,
    map: Mapping<Ctx, A>,
  ): Handled<Kept<Ctx, A>, C, FieldsOf<A>, P>
}

/** Exactly one of `then`, the events recorded, or `reject`, why the command is refused. */
export type Spec<C extends Fields, Em extends Fields> = {
  given?: OneOrMany<Example<"event">>
  when: Example<"command", C>
} & ({ then: OneOrMany<Example<"event", Em>>; reject?: never } | { reject: string; then?: never })

/** A complete slice that handles a command: the command and at least one event. */
export interface Handled<
  Ctx extends Fields,
  C extends Fields,
  Em extends Fields,
  P extends "change" | "automation",
> extends Slice {
  /** Another event it can record: outcomes are alternatives, and each specification says which. */
  event<A extends AnyEvent>(
    event: Filled<Ctx, A, ".event()">,
  ): Handled<Kept<Ctx, A>, C, Em | FieldsOf<A>, P>
  event<A extends AnyEvent>(
    event: A,
    map: Mapping<Ctx, A>,
  ): Handled<Kept<Ctx, A>, C, Em | FieldsOf<A>, P>
  chapter(chapter: Chapter): this
  test(name: string, spec: Spec<C, Em> | (() => Spec<C, Em>)): this
  /** Who issues the command; for an automation, the machine of ours that runs it, without one the first declared, or else System. */
  actor(...actors: P extends "change" ? [Actor, ...Actor[]] : [SystemActor]): this
  /** Where the actors see it; without one, the command's form is drawn as their screen. */
  screen(screen: P extends "change" ? Screen : "no one sees an automation"): this
  /** The method is named after the command unless given. */
  service(
    service: P extends "change" ? Service : "an automation has no method",
    method?: string,
  ): this
  note(text: string): this
}

/** The view's event as written, or the instruction. */
type Projected<R extends Fields, A> = A extends ExternalEventDecl
  ? "isn't stored: translate it into an event of ours, then project that"
  : [Misfit<FieldsOf<A>, R>] extends [never]
    ? A
    : `the event's ${Misfit<FieldsOf<A>, R>} does not fit: set it in the mapping`

/** A state view's mapping: its argument is the event's fields, and it sets columns. */
type ViewMapping<R extends Fields, A> = (e: FieldsOf<A>) => Out<R, Misfit<FieldsOf<A>, R>>

/** The view is known; no event builds it yet. */
export interface Viewing<R extends Fields> extends Step, Gate<"add .event() before .chapter()"> {
  /** An event that builds it. Each projects on its own, so a mapping reads only its event. */
  event<A extends AnyEvent>(event: Projected<R, A>): Viewed<R, Record<never, never>>
  event<A extends AnyEvent>(event: A, map: ViewMapping<R, A>): Viewed<R, Record<never, never>>
}

/**
 * A state view's example: `given` builds the rows, `when` holds the request's values, and `then` the
 * rows the screen shows. One with no request has no `when`, and a view cannot reject an event.
 */
export type ViewSpec<Q extends Fields, R extends Fields> = {
  given?: OneOrMany<Example<"event">>
  then: OneOrMany<Example<"view", R>>
} & ([keyof Q] extends [never] ? { when?: never } : { when: z.input<z.ZodObject<Q>> })

/** A complete state view: the view and at least one event. */
export interface Viewed<R extends Fields, Q extends Fields> extends Slice {
  event<A extends AnyEvent>(event: Projected<R, A>): Viewed<R, Q>
  event<A extends AnyEvent>(event: A, map: ViewMapping<R, A>): Viewed<R, Q>
  /** The request fields; without them the request is empty. */
  request<F extends Fields>(fields: F): Viewed<R, F>
  chapter(chapter: Chapter): this
  test(name: string, spec: ViewSpec<Q, R> | (() => ViewSpec<Q, R>)): this
  actor(...actors: [Actor, ...Actor[]]): this
  /** Where the actors see it; without one, the view's table is drawn as their screen. */
  screen(screen: Screen): this
  /** A state view has no command to name its method after. */
  service(service: Service, method: string): this
  note(text: string): this
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
 * A state view's `when` is its request's values, which Zod checks as it checks an example's. Each
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
  if (view?.view && spec.when) test.request = check(view.view, view.request ?? {}, spec.when)
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

// Each step copies, so a shared chain prefix can start several slices. The steps nothing extends are
// the slices, in the order written, so assembly finds every one. Every step is offered at runtime,
// whatever the compiler allows, so a model with errors is still drawn as far as it goes.
function chain(data: SliceData, context: Context) {
  DRAFTS.add(data)
  const next = (patch: Partial<SliceData>, after: Context = context) => {
    DRAFTS.delete(data)
    return chain({ ...data, ...patch }, after)
  }
  return {
    [META]: data,
    command: (command: CommandDecl, map?: MapFn) => {
      const decl = command[META]
      // An actor fills a state change's command; an automation's is filled from what is before it.
      const issued = data.trigger || data.polls ? probe(decl, context, map) : probe(decl, {})
      return next({ command: issued, beforeCommand: data.reads.length }, contextOf(decl))
    },
    view: (view: ViewDecl) => next({ view: view[META] }, {}),
    automation: (trigger: EventDecl | ViewDecl) => {
      const decl = trigger[META]
      return next({ [decl.kind === "view" ? "polls" : "trigger"]: decl }, contextOf(decl))
    },
    translation: (external: EventDecl) =>
      next({ trigger: external[META] }, contextOf(external[META])),
    // The row's columns join the context, as an external event's fields do, where it lacks them.
    query: (view: ViewDecl, filter: string | MapFn) => {
      const decl = view[META]
      // A state view's request, as it was once written, is no view.
      if (!decl) return next({})
      const read =
        typeof filter === "string"
          ? { decl, mapping: { [filter]: { from: filter } }, context }
          : probe(decl, context, filter)
      return next({ reads: [...data.reads, read] }, { ...contextOf(decl), ...context })
    },
    // A state view's event projects on its own. An external event is a reply, so its fields join the
    // context; an event of ours is an outcome, and the next is an alternative to it.
    event: (event: EventDecl, map?: MapFn) => {
      const decl = event[META]
      if (data.view)
        return next({ events: [...data.events, probe(decl, contextOf(decl), map, decl)] })
      return next(
        { events: [...data.events, probe(decl, context, map)] },
        decl.external ? { ...contextOf(decl), ...context } : context,
      )
    },
    request: (fields: Fields) => next({ request: fields }),
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

/** A column of the diagram, written in story order. Pass a name only when the one it would take misleads. */
function slice(name?: string): Start {
  const empty: SliceData = { actors: [], reads: [], events: [], tests: [], chapters: [] }
  if (name !== undefined) empty.name = name
  return chain(empty, {}) as unknown as Start
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
