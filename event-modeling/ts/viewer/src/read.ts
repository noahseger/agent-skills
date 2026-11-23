// Reads the spec JSON into what the layout draws. A model written by hand, or extracted from
// another tool, carries only what the spec has: then lanes, chapters and actors come from the
// slices in order. Pure, so it is tested without a browser.
import type {
  Feed,
  JsonSchema,
  SpecActor,
  SpecElement,
  SpecSlice,
  SpecStep,
} from "../../src/spec.ts"
import { type Message, type Source, slug } from "../../src/types.ts"
import type { Board, BoardActor, BoardField, BoardSlice, BoardTest, Loose } from "./board.ts"

const SYSTEM: BoardActor = { id: "system", name: "System", type: "system" }

/** A list view's fields are an array's: its rows are the items. */
const listed = (el: SpecElement) => el.fields.type === "array"
const row = (el: SpecElement): JsonSchema => (listed(el) ? (el.fields.items ?? {}) : el.fields)
const names = (el: SpecElement) => Object.keys(row(el).properties ?? {})
/** `Name`, or `Name[]` for a list view. */
const titled = (el: SpecElement) => (listed(el) ? `${el.title}[]` : el.title)

/** `Name(field, *key)`. */
function element(el: SpecElement): string {
  const fields = names(el).map((f) => (el.key?.includes(f) ? `*${f}` : f))
  return fields.length > 0 ? `${titled(el)}(${fields.join(", ")})` : titled(el)
}

/** Each property, an object's own beneath it, and a oneOf's cases. */
function fieldsOf(schema: JsonSchema): BoardField[] {
  return Object.entries(schema.properties ?? {}).map(([name, s]) => {
    let leaf = s
    let lists = ""
    while (leaf.type === "array") {
      leaf = leaf.items ?? {}
      lists += "[]"
    }
    const type = leaf.enum
      ? leaf.enum.join(" | ")
      : leaf.const !== undefined
        ? JSON.stringify(leaf.const)
        : leaf.oneOf
          ? "one of"
          : (leaf.format ?? leaf.type ?? "any")
    const fields = leaf.oneOf ? leaf.oneOf.flatMap(fieldsOf) : fieldsOf(leaf)
    return {
      name,
      type: type + lists,
      ...(!schema.required?.includes(name) && { optional: true }),
      ...(s.description !== undefined && { description: s.description }),
      ...(fields.length > 0 && { fields }),
    }
  })
}

function value(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`
  if (v?.constructor === Object) {
    const pairs = Object.entries(v as object).map(([k, x]) => `${k}=${value(x)}`)
    return `{${pairs.join(", ")}}`
  }
  return String(v)
}

/** `Name(field=value)`, `Error: reason`, or `Described: outcome`. */
function clause(step: SpecStep): string {
  if (step.type === "SPEC_ERROR") return `Error: ${step.title}`
  if (step.type === "SPEC_DESCRIPTION") return `Described: ${step.title}`
  const pairs = Object.entries(step.examples?.[0] ?? {}).map(([k, v]) => `${k}=${value(v)}`)
  return `${step.title}(${pairs.join(", ")})`
}

function test(spec: SpecSlice["specifications"][number]): BoardTest {
  return {
    name: spec.title,
    given: (spec.given ?? []).map(clause),
    when: spec.when?.[0] ? clause(spec.when[0]) : "",
    then: (spec.then ?? []).map(clause),
  }
}

/** The grammar `spec.ts` writes: a source field's name, `= <JSON>`, or `generate(<inputs>)`. */
function source(text: string): Source {
  const generated = /^generate\((.*)\)$/.exec(text)
  if (generated) return { generate: generated[1] ? generated[1].split(", ") : [] }
  if (text.startsWith("=")) {
    try {
      return { value: JSON.parse(text.slice(1)) }
    } catch {
      return { value: text.slice(1).trim() }
    }
  }
  return { from: text }
}

const points = (el: SpecElement, type: string) =>
  (el.dependencies ?? []).some((d) => d.type === "OUTBOUND" && d.elementType === type)
const external = (el: SpecElement) => el.context === "EXTERNAL"
/** A system is named by the `service` of its events; an unnamed one is just External. */
const systemOf = (el: SpecElement) => el.service ?? "External"

function actorType(a: SpecActor): BoardActor["type"] {
  const tags = a.tags ?? []
  if (tags.includes("external")) return "external"
  if (tags.includes("admin")) return "admin"
  if (tags.includes("system")) return "system"
  return "user"
}

/** What each slice's elements are to it, by its type and the arrows between them. */
function parts(s: SpecSlice) {
  const events = s.events ?? []
  const readmodels = s.readmodels ?? []
  const command = s.commands?.[0]
  const automated = s.sliceType === "AUTOMATION" || s.sliceType === "TRANSLATION"
  const trigger = automated
    ? (events.find((e) => points(e, "AUTOMATION")) ??
      (s.sliceType === "TRANSLATION" ? events.find(external) : undefined))
    : undefined
  const polled = automated ? readmodels.find((r) => points(r, "AUTOMATION")) : undefined
  const view = s.sliceType === "STATE_VIEW"
  const heard = view ? events : trigger ? [trigger] : []
  const recorded = view ? [] : events.filter((e) => e !== trigger)
  const projection = view && events.length > 0 ? readmodels[0] : undefined
  const shows = view ? readmodels : []
  const reads = view ? [] : readmodels.filter((r) => r !== polled)
  return { command, trigger, polled, heard, recorded, projection, shows, reads }
}

const isObject = (x: unknown): x is object => typeof x === "object" && x !== null

/** The objects in what should be a list of them; anything else in a file that breaks the schema is skipped. */
function list<T>(written: unknown): T[] {
  return Array.isArray(written) ? written.filter((x): x is T => isObject(x)) : []
}

const elements = (written: unknown): SpecElement[] =>
  list<SpecElement>(written).map((el) => ({
    ...el,
    fields: isObject(el.fields) ? el.fields : {},
    dependencies: list(el.dependencies),
  }))

/** A slice with only the lists, and the objects in them, the reading below expects. */
function usable(s: SpecSlice): SpecSlice {
  return {
    ...s,
    commands: elements(s.commands),
    events: elements(s.events),
    readmodels: elements(s.readmodels),
    screens: elements(s.screens),
    actors: list(s.actors),
    storylines: list(s.storylines),
    specifications: list<SpecSlice["specifications"][number]>(s.specifications).map((spec) => ({
      ...spec,
      given: list(spec.given),
      when: list(spec.when),
      then: list(spec.then),
    })),
  }
}

export function read(written: Feed): Board {
  // A file that breaks the schema is drawn as far as its lists go.
  const feed: Feed = {
    ...written,
    ...(written.chapters !== undefined && { chapters: list(written.chapters) }),
    ...(written.streams !== undefined && {
      streams: Array.isArray(written.streams) ? written.streams.map(String) : [],
    }),
    ...(written.actors !== undefined && { actors: list(written.actors) }),
    ...(written.loose !== undefined && { loose: elements(written.loose) }),
  }
  const slices = list<SpecSlice>(written.model?.slices)
    .map(usable)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  // Lanes in the order declared, then as the slices first name them. Without any, one: Events.
  const lanes = [...(feed.streams ?? [])]
  const lane = (name: string | undefined) => {
    if (name !== undefined && !lanes.includes(name)) lanes.push(name)
  }
  for (const s of slices) for (const e of s.events ?? []) if (!external(e)) lane(e.aggregate)
  for (const e of feed.loose ?? []) if (!external(e)) lane(e.aggregate)
  const aggregates =
    lanes.length > 0
      ? lanes.map((name) => ({ id: slug(name), name }))
      : [{ id: "events", name: "Events" }]
  const fallback = aggregates[0]?.id ?? ""

  const actors = new Map<string, BoardActor>()
  const add = (actor: BoardActor): string => {
    if (!actors.has(actor.id)) actors.set(actor.id, actor)
    return actor.id
  }
  const system = (name: string) => add({ id: slug(name), name, type: "external" })
  const person = (a: SpecActor) => add({ id: slug(a.name), name: a.name, type: actorType(a) })

  const notes: Record<string, string> = {}
  for (const c of feed.chapters ?? []) if (c.note !== undefined) notes[c.name] = c.note
  const fields: Record<string, BoardField[]> = {}
  const noted = (el: SpecElement) => {
    if (el.description !== undefined) notes[el.title] = el.description
    if (names(el).length > 0) fields[el.title] = fieldsOf(row(el))
  }

  const boardSlice = (s: SpecSlice): BoardSlice => {
    const { command, trigger, polled, heard, recorded, projection, shows, reads } = parts(s)
    for (const el of [
      ...(s.commands ?? []),
      ...(s.events ?? []),
      ...(s.readmodels ?? []),
      ...(s.screens ?? []),
    ])
      noted(el)
    // A screen is seen by someone; a model from elsewhere may not say who, so a User. No one sees
    // an automation, or a view with no screen: its actor is the machine of ours that runs it.
    const screen = s.screens?.[0]
    const people = (s.actors ?? []).filter((a) => actorType(a) !== "external")
    const runs = Boolean(trigger || polled || (projection && !screen))
    const runner = runs ? people[0] : undefined
    const seers = runs
      ? []
      : people.length > 0 || !screen
        ? people
        : [{ name: "User", authRequired: false }]

    const outside = trigger && external(trigger) ? trigger : undefined
    const actor = outside
      ? system(systemOf(outside))
      : ((runner ? [runner] : seers).map(person)[0] ?? add(SYSTEM))
    const laneOf = [...recorded, ...heard].find((e) => !external(e) && e.aggregate !== undefined)
    const out: BoardSlice = {
      name: s.title,
      actor,
      aggregate: laneOf?.aggregate !== undefined ? slug(laneOf.aggregate) : fallback,
      tests: (s.specifications ?? []).map(test),
    }
    if (seers.length > 1) out.actors = seers.map((a) => slug(a.name))
    if (seers.length > 0) {
      const head = command ?? shows[0]
      const method = head?.apiEndpoint ?? head?.title ?? ""
      out.ui = head?.service ? `${head.service}/${method}` : method
      if (screen && screen.title !== method) out.screen = screen.title
    }
    if (outside) out.external_event = element(outside)
    if (outside && runner) out.runner = person(runner)
    if ((trigger && !outside) || polled) out.automation = s.title
    if (trigger && !outside) out.trigger = element(trigger)
    if (projection) out.trigger = heard.map(element)
    if (command) out.command = element(command)
    const ours = recorded.filter((e) => !external(e))
    if (ours.length > 0) out.events = ours.map(element)
    const calls = recorded.filter(external).map((e) => {
      const kept = e.dependencies.flatMap((d) =>
        d.type === "OUTBOUND" && d.elementType === "EVENT" ? [d.title] : [],
      )
      return { actor: system(systemOf(e)), event: element(e), ...(kept.length > 0 && { kept }) }
    })
    if (calls.length > 0) out.calls = calls
    if (reads.length > 0) out.reads = reads.map((r) => r.title)
    if (shows.length > 0) out.read_models = shows.map(element)
    if (shows.length > 0 && screen && names(screen).length > 0) out.context = names(screen)
    if (polled) out.polls = polled.title
    const note = s.storylines?.[0]?.title
    if (note !== undefined) out.note = note

    const mapping = Object.entries(isObject(s.mappings) ? s.mappings : {}).map(
      ([step, fields]): [string, Record<string, Source>] => [
        step,
        Object.fromEntries(
          Object.entries(isObject(fields) ? fields : {}).map(([f, text]) => [
            f,
            source(String(text)),
          ]),
        ),
      ],
    )
    if (mapping.length > 0) out.mapping = Object.fromEntries(mapping)
    return out
  }

  // Chapters in the order declared, then as the slices name them; the rest last, nameless.
  const order = (feed.chapters ?? []).map((c) => c.name)
  for (const s of slices)
    if (s.context !== undefined && !order.includes(s.context)) order.push(s.context)
  const drawn = slices.map((s) => ({ context: s.context, slice: boardSlice(s) }))
  const chapters = order.map((name) => ({
    name,
    slices: drawn.filter((d) => d.context === name).map((d) => d.slice),
  }))
  const unchaptered = drawn.filter((d) => d.context === undefined).map((d) => d.slice)
  if (unchaptered.length > 0) chapters.push({ name: "", slices: unchaptered })

  // An event heard and never recorded stands alone, so the arrow into what hears it has a start.
  const recordedNames = new Set(slices.flatMap((s) => parts(s).recorded.map((e) => e.title)))
  const unrecorded = new Map<string, SpecElement>()
  for (const s of slices)
    for (const e of parts(s).heard)
      if (!external(e) && !recordedNames.has(e.title) && !unrecorded.has(e.title))
        unrecorded.set(e.title, e)
  const loose: Loose[] = [...(feed.loose ?? []), ...unrecorded.values()].map((el) => {
    noted(el)
    const aggregate = el.aggregate === undefined ? fallback : slug(el.aggregate)
    if (external(el))
      return {
        kind: "external",
        element: element(el),
        aggregate: fallback,
        actor: system(systemOf(el)),
      }
    const kind = el.type === "COMMAND" ? "command" : el.type === "READMODEL" ? "readModel" : "event"
    return { kind, element: element(el), aggregate }
  })
  for (const a of feed.actors ?? []) person(a)
  // A feed from before errors were split from warnings has only warnings, with no kind.
  const messages: Message[] = [
    ...list<Message>(feed.errors).map((m) => ({ ...m, kind: "error" as const })),
    ...list<Message>(feed.warnings).map((m) => ({ ...m, kind: "warning" as const })),
  ]

  return {
    name: feed.name,
    ...(feed.description !== undefined && { description: feed.description }),
    actors: [...actors.values()],
    aggregates,
    chapters,
    notes,
    fields,
    ...(loose.length > 0 && { loose }),
    ...(messages.length > 0 && { messages }),
  }
}
