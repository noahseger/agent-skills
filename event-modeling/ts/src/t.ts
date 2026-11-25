// `t`, the field builder. Zod checks the values underneath; the vocabulary is closed, so every
// field has a protobuf type, a JSON Schema, and a type the compiler can be told back.
import { z } from "zod"

/**
 * A field as the compiler knows it: the values it holds, its string format, and whether it is a key
 * column. Only the compiler reads the `__` members.
 */
export interface Field<V = unknown, F extends string = string, K extends boolean = false> {
  readonly __value: V
  readonly __format: F
  readonly __key: K
  /** It may go without a value. */
  optional(): Field<V | undefined, F, K>
  /** The comment above it in the proto, and its description in the JSON. */
  describe(text: string): Field<V, F, K>
  /** A key column of a view: its rows are looked up by the key columns. Only a view has them. */
  key(): Field<V, F, true>
}

/** Any field. */
export type AnyField = Field<unknown, string, boolean>
export type Fields = Record<string, AnyField>

/** A list of objects with the fields `F`, as a list view's rows. */
export interface List<F extends Fields> extends Field<Row<F>[]> {
  readonly __row: F
}

export type Value<F> = F extends { readonly __value: infer V } ? V : never

type Flat<T> = { [K in keyof T]: T[K] } & {}

/** The value of an object of `F`: a field that may go without a value is an optional property. */
export type Row<F extends Fields> = Flat<
  { [K in keyof F as undefined extends Value<F[K]> ? never : K]: Value<F[K]> } & {
    [K in keyof F as undefined extends Value<F[K]> ? K : never]?: Value<F[K]>
  }
>

/** One case of `C`, as `{ case: value }`, and none of the others. */
type OneOf<C extends Fields> = {
  [K in keyof C]: Flat<{ [P in K]: Value<C[K]> } & { [P in Exclude<keyof C, K>]?: never }>
}[keyof C]

/** The Zod schema a field is. */
const zod = (field: AnyField): z.ZodType => field as unknown as z.ZodType
const zods = (fields: Fields): Record<string, z.ZodType> =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, zod(v)]))

const KEYS = new WeakSet<object>()

/** Whether a view's field is one of its key columns. */
export const isKey = (field: object): boolean => KEYS.has(field)

/** `schema` with the methods a field has, each returning a field. A key column stays one. */
function field(schema: z.ZodType, key = false): never {
  if (key) KEYS.add(schema)
  const { optional, describe, clone } = schema
  return Object.assign(schema, {
    optional: () => field(optional.call(schema), key),
    describe: (text: string) => field(describe.call(schema, text), key),
    key: () => field(clone.call(schema), true),
  }) as never
}

function array<E extends AnyField>(element: E): Field<Value<E>[]>
function array<F extends Fields>(row: F): List<F>
function array(of: AnyField | Fields): AnyField {
  return field(
    z.array("_zod" in of ? zod(of as unknown as AnyField) : z.object(zods(of as Fields))),
  )
}

function literal<const V extends string | number | boolean>(value: V): Field<V>
/** The empty list, as a mapping's constant. */
function literal(value: readonly []): Field<never[]>
function literal(value: string | number | boolean | readonly []): AnyField {
  return field(z.literal(value as never))
}

export const t = {
  string: (): Field<string> => field(z.string()),
  uuid: (): Field<string, "uuid"> => field(z.uuid()),
  email: (): Field<string, "email"> => field(z.email()),
  url: (): Field<string, "url"> => field(z.url()),
  /** An ISO date, `2026-01-31`. */
  date: (): Field<string, "date"> => field(z.iso.date()),
  /** An ISO date and time, `2026-01-31T09:00:00Z`; a `google.protobuf.Timestamp` in the proto. */
  datetime: (): Field<string, "datetime"> => field(z.iso.datetime()),
  /** An ISO duration, `PT30S`; a `google.protobuf.Duration` in the proto. */
  duration: (): Field<string, "duration"> => field(z.iso.duration()),
  number: (): Field<number> => field(z.number()),
  int: (): Field<number> => field(z.int()),
  boolean: (): Field<boolean> => field(z.boolean()),
  enum: <const V extends readonly [string, ...string[]]>(values: V): Field<V[number]> =>
    field(z.enum(values)),
  literal,
  /** A list of a field, or of objects with the fields given. */
  array,
  object: <F extends Fields>(fields: F): Field<Row<F>> => field(z.object(zods(fields))),
  /** Values by string key; a `map<string, …>` in the proto. */
  record: <E extends AnyField>(value: E): Field<Record<string, Value<E>>> =>
    field(z.record(z.string(), zod(value))),
  /** Exactly one of the cases, as `{ "case": value }`; a `oneof` in the proto. */
  oneOf: <C extends Fields>(cases: C): Field<OneOf<C>> =>
    field(z.xor(Object.entries(cases).map(([k, v]) => z.strictObject({ [k]: zod(v) })))),
}
