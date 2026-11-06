// The assembled model as the JSON `event_model.py` reads. That format is older
// than this package: streams are `aggregates` and key columns are `*field`.
import {
  type ActorData,
  type Assembled,
  type ClauseData,
  type DeclData,
  type ExampleData,
  type ExternalData,
  heard,
  recorded,
  type SliceData,
  type Source,
  type TestData,
  type Warning,
} from "./types.ts"

export interface TestJson {
  name: string
  given: string[]
  when: string
  then: string[]
}

export interface SliceJson {
  name: string
  /** The first of `actors`, or who else starts the slice. */
  actor: string
  /** Every actor with a screen in this slice, when there is more than one. */
  actors?: string[]
  aggregate: string
  ui?: string
  external_event?: string
  automation?: string
  trigger?: string | string[]
  command?: string
  events?: string[]
  /** The external events the command ends in, each with the system it comes from. */
  calls?: { actor: string; event: string }[]
  reads?: string[]
  read_models?: string[]
  tests: TestJson[]
  query?: string[]
  polls?: string
  note?: string
  /** Per event or command, the fields a function filled and where each came from. */
  mapping?: Record<string, Record<string, Source>>
}

export interface ActorJson {
  id: string
  name: string
  type: "user" | "admin" | "system" | "external"
}

/** A declaration in no slice yet, or an event a slice hears and none emits. */
export interface LooseJson {
  kind: "event" | "external" | "command" | "readModel"
  element: string
  aggregate: string
  /** The system an external event comes from. */
  actor?: string
}

export interface ModelJson {
  name: string
  description: string
  actors: ActorJson[]
  aggregates: { id: string; name: string }[]
  /** A partial assembly ends with a nameless one: the slices in no chapter yet. */
  chapters: { name: string; slices: SliceJson[] }[]
  notes: Record<string, string>
  /** Only a partial assembly has these: the model is still being written. */
  loose?: LooseJson[]
  warnings?: Warning[]
}

const SYSTEM: ActorJson = { id: "system", name: "System", type: "system" }

function slug(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** `Name(field, field)`, with a read model's key columns as `*field`. */
function element(decl: DeclData): string {
  const fields = Object.keys(decl.fields).map((f) => (decl.keys.includes(f) ? `*${f}` : f))
  return fields.length > 0 ? `${decl.name}(${fields.join(", ")})` : `${decl.name}`
}

function value(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`
  if (v?.constructor === Object) {
    const pairs = Object.entries(v as object).map(([k, x]) => `${k}=${value(x)}`)
    return `{${pairs.join(", ")}}`
  }
  return String(v)
}

function example(ex: ExampleData): string {
  const pairs = Object.entries(ex.data).map(([k, v]) => `${k}=${value(v)}`)
  return `${ex.decl.name}(${pairs.join(", ")})`
}

function clause(c: ClauseData): string {
  return "decl" in c ? example(c) : `Error: ${c.message}`
}

function test(t: TestData): TestJson {
  return {
    name: t.name,
    given: t.given.map(clause),
    when: t.when ? example(t.when) : "",
    then: t.then.map(clause),
  }
}

export function toJson({
  model,
  streams,
  externals,
  loose,
  unchaptered,
  warnings,
}: Assembled): ModelJson {
  const notes: Record<string, string> = {}
  const noted = (d: { name?: string; note?: string }) => {
    if (d.name !== undefined && d.note !== undefined) notes[d.name] = d.note
  }

  // A model that declares no stream has one lane, called Events.
  const aggregates =
    streams.size > 0
      ? [...streams.keys()].map((name) => ({ id: slug(name), name }))
      : [{ id: "events", name: "Events" }]
  const streamOf = (d: DeclData): string | undefined => {
    for (const [name, members] of streams) if (members.includes(d)) return slug(name)
    return undefined
  }
  const fallback = aggregates[0]?.id ?? ""
  // The command decides the lane, then what the slice records, then what it hears.
  const laneOf = (slice: SliceData): string =>
    [slice.command?.decl, ...recorded(slice), ...heard(slice)]
      .map((d) => (d === undefined ? undefined : streamOf(d)))
      .find((lane) => lane !== undefined) ?? fallback

  const actors = new Map<string, ActorJson>()
  const add = (actor: ActorJson): string => {
    if (!actors.has(actor.id)) actors.set(actor.id, actor)
    return actor.id
  }
  const person = (a: ActorData): ActorJson => ({
    id: slug(a.name ?? ""),
    name: a.name ?? "",
    type: a.icon,
  })
  const system = (external: ExternalData): string =>
    add({ id: slug(external.name ?? ""), name: external.name ?? "", type: "external" })
  const actorOf = (slice: SliceData): string => {
    if (slice.trigger?.external) return system(slice.trigger.external)
    return slice.actors.map((a) => add(person(a)))[0] ?? add(SYSTEM)
  }

  const sliceJson = (slice: SliceData): SliceJson => {
    const out: Omit<SliceJson, "tests"> = {
      name: slice.name ?? "",
      actor: actorOf(slice),
      aggregate: laneOf(slice),
    }
    if (slice.actors.length > 1) out.actors = slice.actors.map((a) => slug(a.name ?? ""))
    const { trigger, command, projection } = slice
    const external = trigger?.external !== undefined

    // An actor has a screen; it is the service method when there is one.
    if (slice.actors.length > 0) {
      const method = slice.service?.method ?? command?.decl.name ?? slice.shows[0]?.name ?? ""
      out.ui = slice.service ? `${slice.service.service.name}/${method}` : method
    }
    if (slice.service) noted(slice.service.service)
    if (trigger && external) out.external_event = element(trigger)
    if ((trigger && !external) || slice.todoList) out.automation = out.name
    if (trigger && !external) out.trigger = element(trigger)
    if (projection) out.trigger = slice.events.map((f) => element(f.decl))
    if (command) {
      out.command = element(command.decl)
      noted(command.decl)
    }
    if (!projection) {
      const ours = slice.events.filter((f) => !f.decl.external)
      if (ours.length > 0) out.events = ours.map((f) => element(f.decl))
      const calls = slice.events.flatMap(({ decl }) =>
        decl.external ? [{ actor: system(decl.external), event: element(decl) }] : [],
      )
      if (calls.length > 0) out.calls = calls
    }
    if (slice.readModels.length > 0) out.reads = slice.readModels.map((r) => r.name ?? "")
    if (slice.shows.length > 0) out.read_models = slice.shows.map((r) => element(r))
    if (projection) out.read_models = [element(projection)]

    const json: SliceJson = { ...out, tests: slice.tests.map(test) }
    if (slice.query) json.query = Object.keys(slice.query)
    if (slice.todoList) json.polls = slice.todoList.name ?? ""
    if (slice.note !== undefined) json.note = slice.note
    const mapping = Object.fromEntries(
      [...(command ? [command] : []), ...slice.events]
        .filter((f) => Object.keys(f.mapping).length > 0)
        .map((f) => [f.decl.name ?? "", f.mapping]),
    )
    if (Object.keys(mapping).length > 0) json.mapping = mapping

    const decls = [...slice.actors, projection, slice.todoList, ...slice.readModels, ...slice.shows]
    for (const d of decls) if (d) noted(d)
    for (const e of [...slice.events.map((f) => f.decl), ...(trigger ? [trigger] : [])]) {
      noted(e)
      if (e.external) noted(e.external)
    }
    return json
  }
  const stories = [
    ...model.chapters,
    ...(unchaptered.length > 0 ? [{ name: "", slices: unchaptered }] : []),
  ]
  const chapters = stories.map(({ name, slices }) => ({ name, slices: slices.map(sliceJson) }))

  // A trigger nothing emits yet stands alone, so the arrow into its automation has a start.
  const slices = stories.flatMap((c) => c.slices)
  const emitted = new Set(slices.flatMap(recorded))
  const unemitted = new Set(slices.flatMap(heard).filter((e) => !e.external && !emitted.has(e)))

  const drawnLoose: LooseJson[] = []
  for (const d of [...loose, ...unemitted]) {
    noted(d)
    if (d.kind === "event" && d.external) {
      const actor = system(d.external)
      drawnLoose.push({ kind: "external", element: element(d), aggregate: fallback, actor })
    } else if (d.kind === "event" || d.kind === "command" || d.kind === "readModel")
      drawnLoose.push({ kind: d.kind, element: element(d), aggregate: streamOf(d) ?? fallback })
    // An actor in no slice is a lane with nothing in it yet.
    if (d.kind === "actor" && !actors.has(slug(d.name ?? "")))
      actors.set(slug(d.name ?? ""), { id: slug(d.name ?? ""), name: d.name ?? "", type: d.icon })
  }
  // So is a system no event joins.
  for (const name of externals) system({ kind: "external", name })

  return {
    name: model.name,
    description: model.description,
    actors: [...actors.values()],
    aggregates,
    chapters,
    notes,
    ...(drawnLoose.length > 0 ? { loose: drawnLoose } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}
