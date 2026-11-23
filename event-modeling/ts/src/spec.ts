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
  type Message,
  origin,
  recorded,
  type SliceData,
  type Source,
  slug,
  type TestData,
  taken,
} from "./types.ts"

// --- The spec's types, as much as is written or read ---------------------------

export type SliceType = "STATE_CHANGE" | "STATE_VIEW" | "AUTOMATION" | "TRANSLATION"
export type ElementType = "COMMAND" | "EVENT" | "READMODEL" | "SCREEN" | "AUTOMATION"
/** A JSON Schema, as much of `z.toJSONSchema`'s output as is read. */
export interface JsonSchema {
  type?: string
  format?: string
  enum?: unknown[]
  const?: unknown
  description?: string
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  /** A `t.oneOf()`'s cases, each an object of one property. */
  oneOf?: JsonSchema[]
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
  /** One object's JSON Schema, or a list view's: an array of them. */
  fields: JsonSchema
  /** The fields that pick one row of a view. */
  key?: string[]
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
  type: "SPEC_EVENT" | "SPEC_COMMAND" | "SPEC_READMODEL" | "SPEC_ERROR" | "SPEC_DESCRIPTION"
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
  /** Per step, where each field its mapping sets gets its value; the README's "The JSON" section has the grammar. */
  mappings?: Record<string, Record<string, string>>
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
  /** Every chapter in number order, with its note; a partial model's may have no slices. */
  chapters?: { name: string; note?: string }[]
  /** Every stream in the order drawn, so a lane no event has joined yet is drawn. */
  streams?: string[]
  /** Actors in no slice, and every External System, so each has a lane. */
  actors?: SpecActor[]
  /** Data that is wrong or has no source. */
  errors?: Message[]
  /** What is unfinished, with nothing wrong. */
  warnings?: Message[]
}

// --- From the assembled model ----------------------------------------------------

/** The JSON Schema of the fields, or of a list of them, less what only repeats a format or a type. */
function fieldsOf(fields: Fields, list?: true): JsonSchema {
  const row = z.object(fields)
  const { $schema, ...schema } = z.toJSONSchema(list ? z.array(row) : row, {
    io: "input",
    unrepresentable: "any",
    override: ({ jsonSchema: s }) => {
      if (s.format !== undefined) delete s.pattern
      if (s.minimum === Number.MIN_SAFE_INTEGER) delete s.minimum
      if (s.maximum === Number.MAX_SAFE_INTEGER) delete s.maximum
    },
  })
  return schema as JsonSchema
}

/** The source field's name, `= <JSON>`, or `generate(<inputs>)`. */
function sourceOf(source: Source): string {
  if ("from" in source) return source.from
  if ("value" in source) return `= ${JSON.stringify(source.value)}`
  return `generate(${inputNames(source).join(", ")})`
}

/**
 * Where each field of `target` a step sets gets its value. A field from a row a query picks says
 * which, `View(filter columns).column`, by name too. Of `reads`, the queries before the step, a
 * view queried again is its last.
 */
function mappingOf(flow: Flow, target: Fields, reads: Flow[]) {
  const { mapping, context } = flow
  const out: Record<string, string> = {}
  for (const field of Object.keys(target)) {
    const source = mapping[field] ?? (field in context ? { from: field } : undefined)
    if (!source) continue
    const read =
      "from" in source ? reads.findLast((q) => q.decl === origin(flow, source)) : undefined
    if (read)
      out[field] = `${read.decl.name}(${Object.keys(read.mapping).join(", ")}).${sourceOf(source)}`
    else if (field in mapping) out[field] = sourceOf(source)
  }
  return out
}

const TYPE: Record<DeclData["kind"], ElementType> = {
  event: "EVENT",
  command: "COMMAND",
  view: "READMODEL",
}

const STEP: Record<DeclData["kind"], SpecStep["type"]> = {
  event: "SPEC_EVENT",
  command: "SPEC_COMMAND",
  view: "SPEC_READMODEL",
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
    fields: fieldsOf(decl.fields, decl.list),
    ...(decl.keys.length > 0 && { key: decl.keys }),
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
  story,
  messages,
}: Assembled): Feed {
  const streamOf = (d: DeclData): string | undefined => {
    for (const [name, members] of streams) if (members.includes(d)) return name
    return undefined
  }
  const chapterOf = new Map(chapters.flatMap((c) => c.slices.map((s) => [s, c.name] as const)))
  // A lane comes where the story first uses it; one no slice uses comes after, as declared.
  const used = story.flatMap((c) => ("kind" in c ? [] : c.events.map((f) => streamOf(f.decl))))
  const first = (lane: string) => (used.includes(lane) ? used.indexOf(lane) : used.length)
  const looseActors = loose.flatMap((d) => (d.kind === "actor" ? [actorOf(d)] : []))
  const systems = externals.map((name) => ({ name, authRequired: false, tags: ["external"] }))
  return {
    name: model.name,
    ...(model.description !== "" && { description: model.description }),
    model: {
      slices: story.map((c, index) =>
        "kind" in c ? alone(c, index, streamOf) : sliceOf(c, index, chapterOf.get(c), streamOf),
      ),
    },
    chapters: chapters.map(({ name, note }) => ({ name, ...(note !== undefined && { note }) })),
    streams: [...streams.keys()].sort((a, b) => first(a) - first(b)),
    actors: [...looseActors, ...systems],
    ...kinds(messages),
  }
}

/** A declaration in no slice, as a slice of its own that holds only it. */
function alone(
  decl: DeclData,
  index: number,
  streamOf: (d: DeclData) => string | undefined,
): SpecSlice {
  const name = decl.name ?? ""
  const id = slug(name)
  const el = looseElement(decl, streamOf, `${id}:${TYPE[decl.kind].toLowerCase()}:${id}`)
  return {
    id,
    index,
    title: name,
    sliceType: decl.kind === "view" ? "STATE_VIEW" : "STATE_CHANGE",
    commands: decl.kind === "command" ? [el] : [],
    events: decl.kind === "event" ? [el] : [],
    readmodels: decl.kind === "view" ? [el] : [],
    screens: [],
    processors: [],
    tables: [],
    specifications: [],
  }
}

/** The messages as the feed carries them: `errors` and `warnings`, each only when there are some. */
export function kinds(messages: readonly Message[]): Pick<Feed, "errors" | "warnings"> {
  const errors = messages.filter((m) => m.kind === "error")
  const warnings = messages.filter((m) => m.kind === "warning")
  return { ...(errors.length > 0 && { errors }), ...(warnings.length > 0 && { warnings }) }
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
  const element = (decl: DeclData, extra: Partial<SpecElement> = {}) => ({
    ...looseElement(decl, streamOf, idOf(TYPE[decl.kind], decl.name ?? "")),
    ...extra,
  })
  const link = (from: SpecElement | undefined, to: SpecElement | undefined) => {
    if (!from || !to) return
    from.dependencies.push(ref(to, "OUTBOUND"))
    to.dependencies.push(ref(from, "INBOUND"))
  }

  const { trigger, polls, view, command, service } = slice
  const sliceType: SliceType = trigger?.external
    ? "TRANSLATION"
    : trigger || polls
      ? "AUTOMATION"
      : command
        ? "STATE_CHANGE"
        : "STATE_VIEW"

  // The endpoint is on what it serves: the command, or the view a state view shows.
  const method = service?.method ?? command?.decl.name ?? view?.name ?? ""
  const endpoint = service ? { service: service.service.name ?? "", apiEndpoint: method } : {}

  const commandEl = command && element(command.decl)
  if (commandEl && !trigger && !polls) Object.assign(commandEl, endpoint)
  const events = view ? [] : slice.events.map((f) => element(f.decl))
  const heardEvents = view ? slice.events.map((f) => element(f.decl)) : []
  const triggerEl = trigger && element(trigger)
  const reads = [...new Set(slice.reads.map((q) => q.decl))].map((r) => element(r))
  const pollsEl = polls && element(polls)
  const viewEl = view && element(view, endpoint)
  // A state view's events each fill the view; a state change's steps each fill their own element.
  const steps = [...(command ? [command] : []), ...slice.events].flatMap(
    (f): [string, Record<string, string>][] => {
      const before = f === command ? slice.reads.slice(0, slice.beforeCommand) : slice.reads
      const mapping = mappingOf(f, (view ?? f.decl).fields, before)
      return Object.keys(mapping).length > 0 ? [[f.decl.name ?? "", mapping]] : []
    },
  )
  const processor: SpecElement | undefined =
    trigger || polls
      ? {
          id: idOf("AUTOMATION", name),
          title: name,
          type: "AUTOMATION",
          fields: fieldsOf({}),
          dependencies: [],
        }
      : undefined
  // An actor sees the slice on a screen: the command's form, or the view's context.
  const asked = slice.screen?.name ?? method
  const screen: SpecElement | undefined =
    slice.actors.length > 0
      ? {
          id: idOf("SCREEN", asked),
          title: asked,
          type: "SCREEN",
          fields: command ? fieldsOf(command.decl.fields) : fieldsOf(slice.context ?? {}),
          dependencies: [],
          ...(slice.screen?.note !== undefined && { description: slice.screen.note }),
        }
      : undefined

  link(triggerEl, processor)
  link(pollsEl, processor)
  link(processor, commandEl)
  link(screen, commandEl)
  for (const r of reads) link(r, commandEl)
  for (const e of events) link(commandEl, e)
  // An event of ours that keeps a field of an outside event the call got back is drawn from it.
  slice.events.forEach((keeps, k) => {
    if (keeps.decl.external) return
    for (const [r, got] of slice.events.entries())
      if (got.decl.external && taken(keeps, got.decl).length > 0) link(events[r], events[k])
  })
  for (const e of heardEvents) link(e, viewEl)
  link(viewEl, screen)

  const stored = [...new Set(recorded(slice).flatMap((d) => streamOf(d) ?? []))]
  // Who sees the slice, or the machine of ours that runs it.
  const actors = slice.system ? [slice.system] : slice.actors
  return {
    id,
    index,
    title: name,
    ...(context !== undefined && { context }),
    sliceType,
    commands: commandEl ? [commandEl] : [],
    events: [...(triggerEl ? [triggerEl] : []), ...heardEvents, ...events],
    readmodels: [...(pollsEl ? [pollsEl] : []), ...(viewEl ? [viewEl] : []), ...reads],
    screens: screen ? [screen] : [],
    processors: processor ? [processor] : [],
    tables: [],
    specifications: slice.tests.map((t, i) => specification(t, `${id}:spec:${i}`, name, id, asked)),
    ...(steps.length > 0 && { mappings: Object.fromEntries(steps) }),
    ...(slice.note !== undefined && {
      storylines: [{ id: `${id}:note`, title: slice.note, elements: [] }],
    }),
    ...(actors.length > 0 && { actors: actors.map(actorOf) }),
    ...(stored.length > 0 && { aggregates: stored }),
  }
}

function step(c: ClauseData, id: string): SpecStep {
  if ("message" in c) return { id, title: c.message, type: "SPEC_ERROR" }
  if ("description" in c) return { id, title: c.description, type: "SPEC_DESCRIPTION" }
  return { id, title: c.decl.name ?? "", type: STEP[c.decl.kind], examples: [c.data] }
}

/** A state view's context is asked from its screen, as a command is sent from one: so `asked` titles it. */
function specification(
  t: TestData,
  id: string,
  sliceName: string,
  linkedId: string,
  asked: string,
): Specification {
  const when = `${id}:when:0`
  return {
    id,
    title: t.name,
    sliceName,
    given: t.given.map((c, i) => step(c, `${id}:given:${i}`)),
    when: t.when
      ? [step(t.when, when)]
      : t.context
        ? [{ id: when, title: asked, type: "SPEC_COMMAND", examples: [t.context] }]
        : [],
    then: t.then.map((c, i) => step(c, `${id}:then:${i}`)),
    linkedId,
  }
}
