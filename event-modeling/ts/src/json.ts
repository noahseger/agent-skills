// An assembled model -> the JSON `event_model.py` reads. This is the only place
// that knows the render target's shape.
//
// The target predates the DSL, so two concepts are encoded rather than native:
// streams are `aggregates`, and a read model's key columns are `*field`.
// Everything else (`query`, `polls`, `note`, `mapping`) the target reads as is.
import type {
  Assembled,
  ClauseData,
  DeclData,
  ExampleData,
  SliceData,
  Source,
  TestData,
} from "./types.ts"

export interface TestJson {
  name: string
  given: string[]
  when: string
  then: string[]
}

export interface SliceJson {
  name: string
  actor: string
  aggregate: string
  ui?: string
  external_event?: string
  automation?: string
  trigger?: string | string[]
  command?: string
  events?: string[]
  reads?: string[]
  read_models?: string[]
  tests: TestJson[]
  query?: string[]
  polls?: string
  note?: string
  /** Per event, the fields a function filled and where each came from. */
  mapping?: Record<string, Record<string, Source>>
}

export interface ActorJson {
  id: string
  name: string
  type: "user" | "admin" | "system" | "external"
}

/** A declaration in no slice yet, drawn on its own in its lane. */
export interface LooseJson {
  kind: "event" | "command" | "readModel"
  element: string
  aggregate: string
}

export interface ModelJson {
  name: string
  description: string
  actors: ActorJson[]
  aggregates: { id: string; name: string }[]
  chapters: { name: string; slices: SliceJson[] }[]
  notes: Record<string, string>
  /** Only a partial assembly has these: the model is still being written. */
  loose?: LooseJson[]
  warnings?: string[]
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
  return Array.isArray(v) ? `[${v.map(value).join(", ")}]` : String(v)
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

export function toJson({ model, streams, loose, warnings }: Assembled): ModelJson {
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
  // The command decides the lane, then what the slice emits, then what it hears.
  const laneOf = (slice: SliceData): string =>
    [slice.command, ...slice.emits.map((f) => f.event), ...slice.on.map((f) => f.event)]
      .map((d) => (d === undefined ? undefined : streamOf(d)))
      .find((lane) => lane !== undefined) ?? fallback

  const actors = new Map<string, ActorJson>()
  const actorOf = (slice: SliceData): string => {
    const external = slice.on[0]?.event.external
    const actor: ActorJson = slice.actor
      ? { id: slug(slice.actor.name ?? ""), name: slice.actor.name ?? "", type: slice.actor.icon }
      : external
        ? { id: slug(external.name ?? ""), name: external.name ?? "", type: "external" }
        : SYSTEM
    if (!actors.has(actor.id)) actors.set(actor.id, actor)
    return actor.id
  }

  const chapters = model.chapters.map((chapter) => ({
    name: chapter.name ?? "",
    slices: chapter.slices.map((slice): SliceJson => {
      const out: Omit<SliceJson, "tests"> = {
        name: slice.name ?? "",
        actor: actorOf(slice),
        aggregate: laneOf(slice),
      }
      const trigger = slice.on[0]?.event
      const external = trigger?.external !== undefined

      if (slice.service) {
        const method = slice.service.method ?? slice.command?.name ?? ""
        out.ui = `${slice.service.service.name}/${method}`
        noted(slice.service.service)
      }
      if (trigger && external) out.external_event = element(trigger)
      if ((trigger && !external && !slice.projects) || slice.polls) out.automation = out.name
      if (trigger && !external) {
        out.trigger = slice.projects ? slice.on.map((f) => element(f.event)) : element(trigger)
      }
      if (slice.command) {
        out.command = element(slice.command)
        noted(slice.command)
      }
      if (slice.emits.length > 0) out.events = slice.emits.map((f) => element(f.event))
      if (slice.reads.length > 0) {
        if (slice.command || trigger) out.reads = slice.reads.map((r) => r.name ?? "")
        else out.read_models = slice.reads.map((r) => element(r))
      }
      if (slice.projects) out.read_models = [element(slice.projects)]

      const json: SliceJson = { ...out, tests: slice.tests.map(test) }
      if (slice.query) json.query = Object.keys(slice.query)
      if (slice.polls) json.polls = slice.polls.name ?? ""
      if (slice.note !== undefined) json.note = slice.note
      const mapping = Object.fromEntries(
        [...slice.emits, ...slice.on]
          .filter((f) => Object.keys(f.mapping).length > 0)
          .map((f) => [f.event.name ?? "", f.mapping]),
      )
      if (Object.keys(mapping).length > 0) json.mapping = mapping

      for (const d of [slice.actor, slice.projects, slice.polls, ...slice.reads]) if (d) noted(d)
      for (const f of [...slice.emits, ...slice.on]) noted(f.event)
      if (trigger?.external) noted(trigger.external)
      return json
    }),
  }))

  const drawnLoose: LooseJson[] = []
  for (const d of loose) {
    noted(d)
    if (d.kind === "event" || d.kind === "command" || d.kind === "readModel")
      drawnLoose.push({ kind: d.kind, element: element(d), aggregate: streamOf(d) ?? fallback })
  }

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
