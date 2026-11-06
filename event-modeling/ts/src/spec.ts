// The assembled model in the shape of the event-modeling-spec JSON Schema
// (schema/eventmodeling.schema.json), and what the viewer reads beside it.
// The README's "The JSON" section lists every place this goes past the spec.
import { z } from "zod"

import {
  type ActorData,
  type Assembled,
  type ClauseData,
  type DeclData,
  type Fields,
  type Flow,
  inputNames,
  recorded,
  type SliceData,
  type Source,
  slug,
  type TestData,
  type Warning,
} from "./types.ts"

// --- The spec's types, as much as is written or read ---------------------------

export type SliceType = "STATE_CHANGE" | "STATE_VIEW" | "AUTOMATION" | "TRANSLATION"
export type ElementType = "COMMAND" | "EVENT" | "READMODEL" | "SCREEN" | "AUTOMATION"
export type FieldType =
  | "String"
  | "Boolean"
  | "Double"
  | "Decimal"
  | "Long"
  | "Custom"
  | "Date"
  | "DateTime"
  | "UUID"
  | "Int"
  | "Number"

export interface SpecField {
  name: string
  type: FieldType
  subfields?: SpecField[]
  /** Where the value comes from; the README's "The JSON" section has the grammar. */
  mapping?: string
  optional?: boolean
  generated?: boolean
  idAttribute?: boolean
  cardinality?: "List" | "Single"
}

export interface Dependency {
  id: string
  type: "INBOUND" | "OUTBOUND"
  title: string
  elementType: ElementType
}

export interface SpecElement {
  id: string
  title: string
  type: ElementType
  fields: SpecField[]
  dependencies: Dependency[]
  description?: string
  aggregate?: string
  /** An event from a system we do not own is EXTERNAL; `service` names the system. */
  context?: "INTERNAL" | "EXTERNAL"
  service?: string | null
  apiEndpoint?: string
}

export interface SpecStep {
  id: string
  title: string
  type: "SPEC_EVENT" | "SPEC_COMMAND" | "SPEC_READMODEL" | "SPEC_ERROR"
  examples?: Record<string, unknown>[]
}

export interface Specification {
  id: string
  title: string
  sliceName?: string
  given: SpecStep[]
  when: SpecStep[]
  then: SpecStep[]
  linkedId: string
}

export interface SpecActor {
  name: string
  authRequired: boolean
  tags?: string[]
}

export interface SpecSlice {
  id: string
  index?: number
  title: string
  context?: string
  sliceType: SliceType
  commands: SpecElement[]
  events: SpecElement[]
  readmodels: SpecElement[]
  screens: SpecElement[]
  processors: SpecElement[]
  tables: unknown[]
  specifications: Specification[]
  storylines?: { id: string; title: string; elements: SpecElement[] }[]
  actors?: SpecActor[]
  aggregates?: string[]
}

export interface SpecModel {
  slices: SpecSlice[]
}

/**
 * What `em view` and `em export` hand the viewer: the model, and what the spec has no place for,
 * because its top level holds only slices.
 */
export interface Feed {
  name: string
  description?: string
  model: SpecModel
  /** Every chapter in the order declared, with its note; a partial model's may have no slices. */
  chapters?: { name: string; note?: string }[]
  /** Every stream in the order declared, so a lane no event has joined yet is drawn. */
  streams?: string[]
  /** Actors in no slice, and every external system, so each has a lane. */
  actors?: SpecActor[]
  /** Declarations in no slice yet. */
  loose?: SpecElement[]
  /** What is left to do. */
  warnings?: Warning[]
}

// --- From the assembled model ----------------------------------------------------

/** As much of `z.toJSONSchema`'s output as the field types read. */
interface JsonSchema {
  type?: string
  format?: string
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
}

function fieldType(schema: JsonSchema): FieldType {
  if (schema.type === "integer") return "Int"
  if (schema.type === "number") return "Double"
  if (schema.type === "boolean") return "Boolean"
  if (schema.type !== "string") return "Custom"
  if (schema.format === "uuid") return "UUID"
  if (schema.format === "date-time") return "DateTime"
  if (schema.format === "date") return "Date"
  return "String"
}

function specField(name: string, schema: JsonSchema, optional: boolean): SpecField {
  const list = schema.type === "array"
  const leaf = (list ? schema.items : schema) ?? {}
  const sub = Object.entries(leaf.properties ?? {}).map(([n, s]) => specField(n, s, false))
  return {
    name,
    type: fieldType(leaf),
    ...(sub.length > 0 && { subfields: sub }),
    ...(optional && { optional }),
    ...(list && { cardinality: "List" as const }),
  }
}

function fieldsOf(fields: Fields, keys: string[] = []): SpecField[] {
  return Object.entries(fields).map(([name, schema]) => {
    let json: JsonSchema = {}
    try {
      json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema
    } catch {}
    const field = specField(name, json, schema.safeParse(undefined).success)
    return keys.includes(name) ? { ...field, idAttribute: true } : field
  })
}

/** `count()`, `= <JSON>`, or the source field's name; a generated field lists its inputs instead. */
function mappingOf(source: Source): string | undefined {
  if ("from" in source) return source.from
  if ("count" in source) return "count()"
  if ("value" in source) return `= ${JSON.stringify(source.value)}`
  return undefined
}

/** A declaration's fields, each with where the slice gets its value. */
function mappedFields(decl: DeclData, mapping: Record<string, Source> = {}): SpecField[] {
  return fieldsOf(decl.fields, decl.keys).map((f) => {
    const source = mapping[f.name]
    if (!source) return f
    if ("generate" in source) {
      const inputs = inputNames(source)
      return { ...f, generated: true, ...(inputs.length > 0 && { mapping: inputs.join(", ") }) }
    }
    return { ...f, mapping: mappingOf(source) ?? "" }
  })
}

/** A read model built from several events maps each column once per event: `Event: source`. */
function projectedFields(decl: DeclData, flows: Flow[]): SpecField[] {
  return fieldsOf(decl.fields, decl.keys).map((f) => {
    const lines = flows.flatMap(({ decl: event, mapping }) => {
      const source = mapping[f.name]
      const text = source && mappingOf(source)
      return text === undefined ? [] : [`${event.name}: ${text}`]
    })
    return lines.length > 0 ? { ...f, mapping: lines.join("\n") } : f
  })
}

const TYPE: Record<DeclData["kind"], ElementType> = {
  event: "EVENT",
  command: "COMMAND",
  readModel: "READMODEL",
}

const STEP: Record<DeclData["kind"], SpecStep["type"]> = {
  event: "SPEC_EVENT",
  command: "SPEC_COMMAND",
  readModel: "SPEC_READMODEL",
}

function actorOf(a: ActorData): SpecActor {
  return { name: a.name ?? "", authRequired: false, ...(a.icon !== "user" && { tags: [a.icon] }) }
}

/** An event's own place: its stream, or the system we do not own that it comes from. */
function placeOf(decl: DeclData, streamOf: (d: DeclData) => string | undefined) {
  if (decl.external) return { context: "EXTERNAL" as const, service: decl.external.name ?? "" }
  const stream = streamOf(decl)
  return stream === undefined ? {} : { aggregate: stream }
}

/** A declaration as a spec element, with only the note and place it carries everywhere. */
function looseElement(
  decl: DeclData,
  streamOf: (d: DeclData) => string | undefined,
  id: string,
): SpecElement {
  return {
    id,
    title: decl.name ?? "",
    type: TYPE[decl.kind],
    fields: fieldsOf(decl.fields, decl.keys),
    dependencies: [],
    ...(decl.note !== undefined && { description: decl.note }),
    ...(decl.kind === "event" && placeOf(decl, streamOf)),
  }
}

export function toFeed({
  model,
  streams,
  chapters,
  externals,
  loose,
  unchaptered,
  warnings,
}: Assembled): Feed {
  const streamOf = (d: DeclData): string | undefined => {
    for (const [name, members] of streams) if (members.includes(d)) return name
    return undefined
  }
  const stories: [string | undefined, SliceData[]][] = [
    ...chapters.map((c): [string, SliceData[]] => [c.name, c.slices]),
    [undefined, unchaptered],
  ]
  const slices = stories.flatMap(([context, written]) =>
    written.map((slice) => ({ slice, context })),
  )
  const looseActors = loose.flatMap((d) => (d.kind === "actor" ? [actorOf(d)] : []))
  const systems = externals.map((name) => ({ name, authRequired: false, tags: ["external"] }))
  const looseElements = loose.flatMap((d) =>
    d.kind === "event" || d.kind === "command" || d.kind === "readModel"
      ? [looseElement(d, streamOf, `loose:${slug(d.name ?? "")}`)]
      : [],
  )
  return {
    name: model.name,
    ...(model.description !== "" && { description: model.description }),
    model: {
      slices: slices.map(({ slice, context }, index) => sliceOf(slice, index, context, streamOf)),
    },
    chapters: chapters.map(({ name, note }) => ({ name, ...(note !== undefined && { note }) })),
    streams: [...streams.keys()],
    actors: [...looseActors, ...systems],
    ...(looseElements.length > 0 && { loose: looseElements }),
    ...(warnings.length > 0 && { warnings }),
  }
}

function sliceOf(
  slice: SliceData,
  index: number,
  context: string | undefined,
  streamOf: (d: DeclData) => string | undefined,
): SpecSlice {
  const name = slice.name ?? ""
  const id = slug(name)
  const idOf = (type: ElementType, title: string) => `${id}:${type.toLowerCase()}:${slug(title)}`
  const ref = (el: SpecElement, type: Dependency["type"]): Dependency => ({
    id: el.id,
    type,
    title: el.title,
    elementType: el.type,
  })
  const element = (decl: DeclData, fields: SpecField[], extra: Partial<SpecElement> = {}) => ({
    ...looseElement(decl, streamOf, idOf(TYPE[decl.kind], decl.name ?? "")),
    fields,
    ...extra,
  })
  const link = (from: SpecElement | undefined, to: SpecElement | undefined) => {
    if (!from || !to) return
    from.dependencies.push(ref(to, "OUTBOUND"))
    to.dependencies.push(ref(from, "INBOUND"))
  }

  const { trigger, todoList, projection, command, service } = slice
  const sliceType: SliceType = projection
    ? "STATE_VIEW"
    : trigger?.external
      ? "TRANSLATION"
      : trigger || todoList
        ? "AUTOMATION"
        : command
          ? "STATE_CHANGE"
          : "STATE_VIEW"

  // The endpoint is on what it serves: the command, or the read models a view shows.
  const method = service?.method ?? command?.decl.name ?? slice.shows[0]?.name ?? ""
  const endpoint = service ? { service: service.service.name ?? "", apiEndpoint: method } : {}

  const commandEl = command && element(command.decl, mappedFields(command.decl, command.mapping))
  if (commandEl && !trigger && !todoList) Object.assign(commandEl, endpoint)
  const events = projection
    ? []
    : slice.events.map((f) => element(f.decl, mappedFields(f.decl, f.mapping)))
  const heardEvents = projection
    ? slice.events.map((f) => element(f.decl, fieldsOf(f.decl.fields)))
    : []
  const triggerEl = trigger && element(trigger, fieldsOf(trigger.fields))
  const reads = slice.readModels.map((r) => element(r, fieldsOf(r.fields, r.keys)))
  const todoEl = todoList && element(todoList, fieldsOf(todoList.fields, todoList.keys))
  const projectionEl = projection && element(projection, projectedFields(projection, slice.events))
  const shows = slice.shows.map((r) => element(r, fieldsOf(r.fields, r.keys), endpoint))
  const processor: SpecElement | undefined =
    trigger || todoList
      ? {
          id: idOf("AUTOMATION", name),
          title: name,
          type: "AUTOMATION",
          fields: [],
          dependencies: [],
        }
      : undefined
  // An actor sees the slice on a screen: the command's form, or the view's request.
  const screen: SpecElement | undefined =
    slice.actors.length > 0
      ? {
          id: idOf("SCREEN", slice.screen?.name ?? method),
          title: slice.screen?.name ?? method,
          type: "SCREEN",
          fields: command ? fieldsOf(command.decl.fields) : fieldsOf(slice.query ?? {}),
          dependencies: [],
          ...(slice.screen?.note !== undefined && { description: slice.screen.note }),
        }
      : undefined

  link(triggerEl, processor)
  link(todoEl, processor)
  link(processor, commandEl)
  link(screen, commandEl)
  for (const r of reads) link(r, commandEl)
  for (const e of events) link(commandEl, e)
  for (const e of heardEvents) link(e, projectionEl)
  for (const r of shows) link(r, screen)

  const stored = [...new Set(recorded(slice).flatMap((d) => streamOf(d) ?? []))]
  return {
    id,
    index,
    title: name,
    ...(context !== undefined && { context }),
    sliceType,
    commands: commandEl ? [commandEl] : [],
    events: [...(triggerEl ? [triggerEl] : []), ...heardEvents, ...events],
    readmodels: [
      ...(todoEl ? [todoEl] : []),
      ...(projectionEl ? [projectionEl] : []),
      ...shows,
      ...reads,
    ],
    screens: screen ? [screen] : [],
    processors: processor ? [processor] : [],
    tables: [],
    specifications: slice.tests.map((t, i) => specification(t, `${id}:spec:${i}`, name, id)),
    ...(slice.note !== undefined && {
      storylines: [{ id: `${id}:note`, title: slice.note, elements: [] }],
    }),
    ...(slice.actors.length > 0 && { actors: slice.actors.map(actorOf) }),
    ...(stored.length > 0 && { aggregates: stored }),
  }
}

function step(c: ClauseData, id: string): SpecStep {
  if (!("decl" in c)) return { id, title: c.message, type: "SPEC_ERROR" }
  return { id, title: c.decl.name ?? "", type: STEP[c.decl.kind], examples: [c.data] }
}

function specification(t: TestData, id: string, sliceName: string, linkedId: string) {
  return {
    id,
    title: t.name,
    sliceName,
    given: t.given.map((c, i) => step(c, `${id}:given:${i}`)),
    when: t.when ? [step(t.when, `${id}:when:0`)] : [],
    then: t.then.map((c, i) => step(c, `${id}:then:${i}`)),
    linkedId,
  }
}
