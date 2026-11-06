// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

import { type Feed, toFeed } from "./spec.ts"
import {
  type Assembled,
  type ChapterData,
  type Declaration,
  type DeclData,
  DRAFTS,
  type ExampleData,
  type Exported,
  type Flow,
  heard,
  META,
  type ModelData,
  recorded,
  type SliceData,
  type StreamData,
  type Warning,
} from "./types.ts"

export type { Assembled, Feed, Warning }

export interface Options {
  /** Render an incomplete model with warnings instead of failing with errors. */
  partial?: boolean
}

/** Records a dead end; a strict assembly throws them all at the end. */
type Fail = (warning: Warning) => void

/** `path` is a model directory or a single module. */
export async function assemble(path: string, options: Options = {}): Promise<Feed> {
  return toFeed(await load(path, options))
}

/** `assemble` for modules already loaded. */
export function assembleModules(modules: readonly object[], options: Options = {}): Feed {
  return toFeed(loadModules(modules, options))
}

/** A module runs once per process, so a second load of the same files finds no slices. */
export async function load(path: string, options: Options = {}): Promise<Assembled> {
  const dir = statSync(path).isDirectory() ? path : dirname(path)
  const files = dir === path ? walk(path) : [path]
  DRAFTS.clear()
  // One at a time, so the modules run in one order every load: by path, each after what it
  // imports. That order is the order slices and chapters are written in.
  const modules: object[] = []
  for (const f of files) modules.push((await import(pathToFileURL(resolve(f)).href)) as object)
  return loadModules(
    modules,
    options,
    files.map((f) => relative(dir, f)),
  )
}

/**
 * Takes the slices written since the last assembly, so one model's never reach the next.
 * `files` names each module, for errors about two of them.
 */
export function loadModules(
  modules: readonly object[],
  options: Options = {},
  files: readonly string[] = [],
): Assembled {
  const drafts = [...DRAFTS]
  DRAFTS.clear()
  const { model, streams, chapters, externals, declared, fileOf } = nameExports(modules, files)
  const warnings: Warning[] = []
  const fail: Fail = (warning) => {
    warnings.push(warning)
  }
  const unchaptered: SliceData[] = []
  for (const s of drafts) {
    const name = chapterOf(s)
    const chapter = chapters.find((c) => c.name === name)
    if (chapter) chapter.slices.push(s)
    else unchaptered.push(s)
  }
  check(chapters, unchaptered, declared, fileOf, fail, !options.partial)
  for (const s of unchaptered) {
    const name = s.name ?? "A slice"
    fail({ message: `${name} isn't in a chapter yet.`, element: "", slice: s.name ?? "" })
  }
  for (const c of chapters)
    if (c.slices.length === 0) fail({ message: `${c.name} has no slices yet.`, element: "" })
  const loose = looseOf(drafts, streams, declared)
  for (const d of loose) fail({ message: `${d.name} isn't in a slice yet.`, element: d.name ?? "" })
  // Otherwise it is drawn in the first stream's lane, which says something nobody wrote.
  const members = new Set([...streams.values()].flat())
  for (const d of streams.size > 0 ? declared : [])
    if (d.kind === "event" && !d.external && !members.has(d))
      fail({
        message: `${d.name} isn't in a stream yet. Add .stream() where it's declared, with the stream it belongs to.`,
        element: d.name ?? "",
      })
  // Every dead end at once, so one run shows all there is to fix.
  if (!options.partial && warnings.length > 0)
    throw new Error(warnings.map((w) => w.message).join("\n"))
  return { model, streams, chapters, externals, loose, unchaptered, warnings }
}

/** The model's own modules under `dir`. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory())
        return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : walk(path)
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : []
    })
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function exported(value: unknown): Exported | undefined {
  // A declaration is a function; calling it builds an example.
  const holder = typeof value === "object" || typeof value === "function"
  if (!holder || value === null || !(META in value)) return undefined
  const data: unknown = (value as { [META]: unknown })[META]
  return typeof data === "object" && data !== null && "kind" in data
    ? (data as Exported)
    : undefined
}

/**
 * Streams, chapters and external systems merge by name, so two modules can add to one. Streams and
 * chapters keep the order written. An event is in one lane, so not in both.
 */
function nameExports(
  modules: readonly object[],
  files: readonly string[],
): {
  model: ModelData
  streams: Map<string, DeclData[]>
  chapters: Assembled["chapters"]
  externals: string[]
  declared: Declaration[]
  fileOf: Map<object, string>
} {
  let model: ModelData | undefined
  const lanes: [string, StreamData][] = []
  const headings: ChapterData[] = []
  const externals: string[] = []
  const declared: Declaration[] = []
  const fileOf = new Map<object, string>()
  for (const [i, module] of modules.entries()) {
    for (const [key, value] of Object.entries(module)) {
      const data = exported(value)
      if (!data) continue
      const file = files[i]
      if (file !== undefined && !fileOf.has(data)) fileOf.set(data, file)
      if (data.kind === "model") {
        model = data
      } else if (data.kind === "stream") {
        lanes.push([key, data])
      } else if (data.kind === "external") {
        data.name = key
        if (!externals.includes(key)) externals.push(key)
      } else if (data.name !== undefined && data.name !== key) {
        throw new Error(`${data.name} is exported twice, also as ${key}. Keep one.`)
      } else if (data.kind === "chapter") {
        data.name = key
        if (!headings.includes(data)) headings.push(data)
      } else {
        data.name = key
        if (!declared.includes(data)) declared.push(data)
      }
    }
  }
  if (!model)
    throw new Error('No model found. Add `export default m.model("Name")` to one of your files.')
  // A module's exports come in alphabetical order, so the lanes are sorted back into the order written.
  const streams = new Map<string, DeclData[]>()
  for (const [key, data] of lanes.sort((a, b) => a[1].order - b[1].order))
    streams.set(key, [...new Set([...(streams.get(key) ?? []), ...data.members])])
  for (const [key, members] of streams)
    for (const e of members)
      if (e.external)
        throw new Error(
          `${e.name} is in the ${key} stream and the ${e.external.name} system. Keep one: .stream() for ours, .external() for theirs.`,
        )
  const chapters: Assembled["chapters"] = []
  for (const { name = "", note } of headings.sort((a, b) => a.order - b.order)) {
    const merged = chapters.find((c) => c.name === name)
    if (!merged) chapters.push({ name, ...(note !== undefined && { note }), slices: [] })
    else if (merged.note === undefined && note !== undefined) merged.note = note
  }
  return { model, streams, chapters, externals, declared, fileOf }
}

/** The name of the chapter a slice joined, if it joined one. */
function chapterOf(slice: SliceData): string | undefined {
  const names = [...new Set(slice.chapters.map((c) => c.name))]
  const where = heading(slice) ?? "A slice"
  if (names.includes(undefined))
    throw new Error(
      `${where}: this slice joins a chapter that isn't exported. Export it to give it a name.`,
    )
  if (names.length > 1)
    throw new Error(`${where}: this slice joins ${names.join(" and ")}. Keep one .chapter().`)
  return names[0]
}

/** Declarations in no slice yet, stream members first. */
function looseOf(
  slices: SliceData[],
  streams: Map<string, DeclData[]>,
  declared: Declaration[],
): Declaration[] {
  const inUse = new Set<object>()
  for (const slice of slices) for (const [, d] of used(slice)) inUse.add(d)
  const members = [...streams.values()].flat()
  const ordered = [...members, ...declared.filter((d) => !members.includes(d as DeclData))]
  return ordered.filter((d) => !inUse.has(d))
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const KIND_LABEL = {
  event: "an event",
  command: "a command",
  readModel: "a read model",
  actor: "an actor",
  screen: "a screen",
  service: "a service",
  external: "an external system",
}

interface Located {
  slice: SliceData
  where: string
}

function check(
  chapters: Assembled["chapters"],
  unchaptered: SliceData[],
  declared: Declaration[],
  fileOf: Map<object, string>,
  fail: Fail,
  strict: boolean,
): void {
  const located = [
    ...chapters.flatMap((chapter) => locate(chapter.name, chapter.slices)),
    ...locate(undefined, unchaptered),
  ]
  // The compiler reports it where the slice is written, so a partial model only draws it.
  if (strict)
    for (const { slice, where } of located) {
      const missing = missingCore(slice)
      if (missing) throw new Error(`${where}: ${missing}`)
    }
  checkDeclaredOnce(located, declared, fileOf)
  const columns = columnsOf(located)
  for (const at of located) {
    checkFilled(at, columns, fail)
    checkKeys(at, fail)
    checkCovered(at, fail)
    checkSeen(at, fail)
    checkSpecs(at, columns, fail)
    checkGenerated(at, fail)
  }
  checkFilledSomewhere(located, fail)
  checkConnected(located, columns, fail)
  checkMethods(located)
}

/** What a slice's first call left out. `em json` runs the model without the compiler. */
function missingCore(slice: SliceData): string | undefined {
  const { command, trigger, todoList, projection, shows, events } = slice
  if (!command && !trigger && !todoList && !projection && shows.length === 0)
    return "this slice is empty. Give its first call what starts it."
  if ((trigger || todoList) && !command)
    return "this slice has no command yet. Add it to the slice's first call."
  if ((command || projection) && events.length === 0)
    return "this slice has no event yet. Add it to the slice's first call."
  return undefined
}

/** `chapter` is undefined for the slices in none yet. */
function locate(chapter: string | undefined, slices: SliceData[]): Located[] {
  const at = (slice: string) => (chapter === undefined ? slice : `${chapter} › ${slice}`)
  return slices.map((slice, i) => {
    const where = chapter === undefined ? "A slice in no chapter" : at(`slice ${i + 1}`)
    // The slice is named after its declarations, so until they are checked
    // `where` is its position.
    for (const [kind, d] of used(slice)) {
      if (d.name === undefined)
        throw new Error(
          `${where}: this slice uses ${KIND_LABEL[kind]} that isn't exported. Export it to give it a name.`,
        )
    }
    const named = heading(slice)
    if (named !== undefined) slice.name = named
    return { slice, where: slice.name === undefined ? where : at(slice.name) }
  })
}

/** What heads a slice's column: its name, or else what it is named after. */
function heading(slice: SliceData): string | undefined {
  return (
    slice.name ??
    slice.command?.decl.name ??
    slice.projection?.name ??
    slice.todoList?.name ??
    slice.service?.method ??
    slice.shows[0]?.name
  )
}

/** Two modules can export one name, except for a lane, which they share. */
function checkDeclaredOnce(
  located: Located[],
  declared: Declaration[],
  fileOf: Map<object, string>,
): void {
  const byName = new Map<string, object>()
  const all = [
    ...declared,
    ...located.flatMap(({ slice }) =>
      used(slice).flatMap(([kind, d]) => (kind === "external" ? [] : [d])),
    ),
  ]
  for (const d of all) {
    if (d.name === undefined) continue
    const first = byName.get(d.name)
    if (first !== undefined && first !== d) {
      const [a, b] = [fileOf.get(first), fileOf.get(d)]
      throw new Error(
        a && b && a !== b
          ? `${d.name} is declared in both ${a} and ${b}. Keep one and import it in the other.`
          : `${d.name} is declared twice. Keep one and use it in both places.`,
      )
    }
    byName.set(d.name, d)
  }
}

/** Everything a slice refers to, with the word an error uses for it. */
function used(slice: SliceData): [keyof typeof KIND_LABEL, { name?: string }][] {
  const out: [keyof typeof KIND_LABEL, { name?: string }][] = []
  for (const a of slice.actors) out.push(["actor", a])
  if (slice.screen) out.push(["screen", slice.screen])
  if (slice.service) out.push(["service", slice.service.service])
  if (slice.command) out.push(["command", slice.command.decl])
  for (const e of [...slice.events.map((f) => f.decl), ...(slice.trigger ? [slice.trigger] : [])]) {
    out.push(["event", e])
    if (e.external) out.push(["external", e.external])
  }
  const readModels = [
    ...slice.readModels,
    ...slice.shows,
    slice.todoList,
    slice.projection,
    ...flows(slice).flatMap(generatedFrom),
  ]
  for (const r of readModels) if (r) out.push(["readModel", r])
  for (const t of slice.tests) {
    for (const c of [...t.given, t.when, ...t.then])
      if (c && "decl" in c) out.push([c.decl.kind, c.decl])
  }
  return out
}

/** The command and events a slice maps. */
const flows = (slice: SliceData): Flow[] => [
  ...(slice.command ? [slice.command] : []),
  ...slice.events,
]

/** The read models a flow's generated values are made from. */
const generatedFrom = (flow: Flow): DeclData[] =>
  Object.values(flow.mapping).flatMap((s) =>
    "generate" in s
      ? s.generate.filter((i): i is DeclData => typeof i !== "string" && i.kind === "readModel")
      : [],
  )

/**
 * A mapping copies a field, sets a constant or says what a value is made from. One that computes a
 * value is drawn as generated and left to do: what it computes is the handler's, not the model's. A
 * read model a value is made from is one the handler reads.
 */
function checkGenerated({ slice, where }: Located, fail: Fail): void {
  for (const flow of flows(slice)) {
    for (const [field, s] of Object.entries(flow.mapping)) {
      const target = `${flow.decl.name}.${field}`
      if ("built" in s && s.built !== undefined) {
        const fields = s.generate.join(", ")
        const builds = s.built === "string" ? "builds a string" : "computes a number"
        fail({
          message: `${where}: ${target} ${builds} from ${fields}. Write generate() with ${fields} instead, to say what it is made from.`,
          element: flow.decl.name ?? "",
          slice: slice.name ?? "",
        })
      }
      for (const input of "generate" in s ? s.generate : [])
        if (
          typeof input !== "string" &&
          input.kind === "readModel" &&
          !slice.readModels.includes(input)
        )
          fail({
            message: `${where}: ${target} is generated from ${input.name}, which this slice doesn't read yet. Add .readModel(${input.name}).`,
            element: input.name ?? "",
            slice: slice.name ?? "",
          })
    }
  }
}

/** The fields a flow fills: those that copy by name from `source`, and those its mapping sets. */
function filled(flow: Flow, source: DeclData): string[] {
  return [...Object.keys(source.fields), ...Object.keys(flow.mapping)]
}

/** The fields that may go without a value. */
function optional(decl: DeclData): string[] {
  return Object.keys(decl.fields).filter((f) => decl.fields[f]?.safeParse(undefined).success)
}

/** Each read model's projection slices, the first of them, and the events they build it from together. */
type Columns = Map<DeclData, { first: Located; flows: Flow[] }>

function columnsOf(located: Located[]): Columns {
  const columns: Columns = new Map()
  for (const at of located) {
    const { projection, events } = at.slice
    if (!projection) continue
    const sofar = columns.get(projection) ?? { first: at, flows: [] }
    sofar.flows.push(...events)
    columns.set(projection, sofar)
  }
  return columns
}

/**
 * Every field has a source. A model still being written may lack one, so this warns. An optional
 * field may go unfilled here, if another slice fills it. A read model's columns are filled by all
 * its projection slices, and reported at the first.
 */
function checkFilled(at: Located, columns: Columns, fail: Fail): void {
  const { slice, where } = at
  const check = (target: DeclData, sources: string[], fix: (field: string) => string) => {
    for (const field of Object.keys(target.fields)) {
      if (!sources.includes(field))
        fail({
          message: `${where}: ${target.name}.${field} has no value. ${fix(field)}`,
          element: target.name ?? "",
          slice: slice.name ?? "",
        })
    }
  }
  const { command, projection } = slice
  const from = slice.trigger ?? slice.todoList
  if (command && from)
    check(
      command.decl,
      [...filled(command, from), ...optional(command.decl)],
      (f) => `Add ${f} to ${from.name}, or set it in the mapping.`,
    )
  // An external event's fields come from outside.
  if (command && !projection)
    for (const flow of slice.events.filter((f) => !f.decl.external))
      check(
        flow.decl,
        [...filled(flow, command.decl), ...optional(flow.decl)],
        (f) => `Add ${f} to ${command.decl.name}, or set it in the mapping.`,
      )
  const together = projection && columns.get(projection)
  if (projection && together?.first === at)
    check(
      projection,
      together.flows.flatMap((flow) => filled(flow, flow.decl)),
      (f) => `Add .event() for an event that carries ${f}, or set it in a mapping.`,
    )
}

/**
 * An optional field one slice leaves unfilled needs another to fill it. An actor fills its own
 * command, and an external event's fields come from outside.
 */
function checkFilledSomewhere(located: Located[], fail: Fail): void {
  const fills = new Map<DeclData, Set<string>>()
  const add = (decl: DeclData, fields: string[]) =>
    fills.set(decl, new Set([...(fills.get(decl) ?? []), ...fields]))
  for (const { slice } of located) {
    const { command, projection } = slice
    if (!command || projection) continue
    const from = slice.trigger ?? slice.todoList
    add(command.decl, from ? filled(command, from) : Object.keys(command.decl.fields))
    for (const flow of slice.events)
      add(flow.decl, flow.decl.external ? optional(flow.decl) : filled(flow, command.decl))
  }
  for (const [decl, fields] of fills) {
    const to = decl.kind === "command" ? "what issues" : "a command that records"
    for (const field of optional(decl).filter((f) => !fields.has(f)))
      fail({
        message: `${decl.name}.${field} is never filled by any slice. Add ${field} to ${to} ${decl.name}, or set it in a mapping.`,
        element: decl.name ?? "",
      })
  }
}

/** An event finds its row by the key columns it carries. */
function checkKeys({ slice, where }: Located, fail: Fail): void {
  if (!slice.projection || slice.projection.keys.length === 0) return
  for (const flow of slice.events) {
    const carried = filled(flow, flow.decl)
    if (!slice.projection.keys.some((k) => carried.includes(k))) {
      fail({
        message:
          `${where}: ${flow.decl.name} doesn't say which ${slice.projection.name} row it changes. ` +
          `Give it a key field (${slice.projection.keys.join(", ")}), or set one in its mapping.`,
        element: flow.decl.name ?? "",
        slice: slice.name ?? "",
      })
    }
  }
}

/**
 * Every event a slice handles or produces is in one of its specifications: a command's events are
 * alternatives, and only a specification says when each happens; an automation's trigger, and a
 * projection's events, are in a given. A to-do list automation has no trigger event. A view's
 * specifications say what the screen shows.
 */
function checkCovered({ slice, where }: Located, fail: Fail): void {
  if (slice.shows.length > 0 && slice.tests.length === 0) {
    const rows = slice.shows.map((r) => r.name).join(" or ")
    fail({
      slice: slice.name ?? "",
      element: slice.shows[0]?.name ?? "",
      message: `${where}: no specification shows this view yet. Add a .test whose then has the ${rows} rows it shows.`,
    })
  }
  const inClause = (clause: "given" | "then") =>
    new Set(slice.tests.flatMap((t) => t[clause].flatMap((c) => ("decl" in c ? [c.decl] : []))))
  const given = inClause("given")
  const then = inClause("then")
  const missing: [DeclData, "given" | "then"][] = [
    ...heard(slice).flatMap((d): [DeclData, "given"][] => (given.has(d) ? [] : [[d, "given"]])),
    ...recorded(slice).flatMap((d): [DeclData, "then"][] => (then.has(d) ? [] : [[d, "then"]])),
  ]
  for (const [decl, clause] of missing)
    fail({
      message: `${where}: no specification shows ${decl.name} yet. Add a .test whose ${clause} has ${decl.name}(...).`,
      element: decl.name ?? "",
      slice: slice.name ?? "",
    })
}

/** What the wiring puts in a field, and where it says so; undefined `value` is anything. */
interface Expected {
  value: unknown
  says: string
}

/**
 * A specification agrees with its slice's wiring: each value it shows is the one that flows in. A
 * generated field, or an external event's, may be anything.
 */
function checkSpecs({ slice, where }: Located, columns: Columns, fail: Fail): void {
  const { command, projection } = slice
  for (const t of slice.tests) {
    const compare = (
      example: ExampleData,
      clause: "when" | "then",
      expected: (field: string) => Expected | undefined,
    ) => {
      for (const [field, shown] of Object.entries(example.data)) {
        const e = expected(field)
        if (e?.value === undefined || shown === undefined || isDeepStrictEqual(shown, e.value))
          continue
        fail({
          message: `${where} › "${t.name}": ${clause} has ${field} ${show(shown)}, but ${e.says}.`,
          element: example.decl.name ?? "",
          slice: slice.name ?? "",
        })
      }
    }
    if (projection) {
      const rows = project(projection, columns.get(projection)?.flows ?? [], t.given)
      for (const c of t.then) {
        if (!("decl" in c) || c.decl !== projection) continue
        const matched = rowsLike(rows, projection, c.data)
        if (matched.length === 1) compare(c, "then", (f) => matched[0]?.values[f])
      }
    } else if (slice.shows.length > 0) {
      const said = (message: string, element: string) =>
        fail({ message: `${where} › "${t.name}": ${message}`, element, slice: slice.name ?? "" })
      for (const shown of slice.shows) {
        const rows = project(shown, columns.get(shown)?.flows ?? [], t.given)
        const then = t.then.flatMap((c) => ("decl" in c && c.decl === shown ? [c] : []))
        for (const c of then) {
          const matched = rowsLike(rows, shown, c.data)
          if (matched.length === 1) compare(c, "then", (f) => matched[0]?.values[f])
          else if (matched.length === 0)
            said(
              `then has ${shown.name} ${rowName(shown, c.data)}, but given builds no such row.`,
              shown.name ?? "",
            )
        }
        for (const row of rows) {
          const data = Object.fromEntries(Object.entries(row.values).map(([k, e]) => [k, e.value]))
          if (then.some((c) => rowsLike([row], shown, c.data).length > 0)) continue
          if (excluded(data, t.query ?? {})) continue
          const unless = t.query ? " and when does not exclude it" : ""
          said(
            `given builds ${shown.name} ${rowName(shown, data)}, but then leaves it out${unless}. Add it to then.`,
            shown.name ?? "",
          )
        }
      }
    } else if (command) {
      const trigger = t.given.find((g) => g.decl === slice.trigger)
      if (t.when && trigger)
        compare(t.when, "when", (f) =>
          source(command, f, trigger, `${trigger.decl.name} in given has`),
        )
      const when = t.when
      for (const c of t.then) {
        if (!("decl" in c) || c.decl.external || !when) continue
        const flow = slice.events.find((e) => e.decl === c.decl)
        if (flow) compare(c, "then", (f) => source(flow, f, when, "when sends"))
      }
    }
  }
}

/** The rows with the key values `data` has. */
function rowsLike<R extends { values: Record<string, Expected> }>(
  rows: R[],
  readModel: DeclData,
  data: Record<string, unknown>,
): R[] {
  const keys = readModel.keys.filter((k) => data[k] !== undefined)
  return rows.filter((r) => keys.every((k) => isDeepStrictEqual(r.values[k]?.value, data[k])))
}

/** A row by its keys, or by every value when the read model has none. */
function rowName(readModel: DeclData, data: Record<string, unknown>): string {
  const keys = readModel.keys.length > 0 ? readModel.keys : Object.keys(data)
  return show(
    Object.fromEntries(keys.flatMap((k) => (data[k] === undefined ? [] : [[k, data[k]]]))),
  )
}

/**
 * A query field filters the rows by equality with the column of the same name. One with no such
 * column, or a column whose value the given cannot tell, excludes nothing.
 */
function excluded(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).some(
    ([field, asked]) =>
      asked !== undefined && row[field] !== undefined && !isDeepStrictEqual(row[field], asked),
  )
}

/** What `flow` puts in `field` from `example`, which `has` introduces in a message. */
function source(
  flow: Flow,
  field: string,
  example: ExampleData,
  has: string,
): Expected | undefined {
  const s = flow.mapping[field] ?? (field in example.decl.fields ? { from: field } : undefined)
  if (s === undefined) return undefined
  if ("value" in s)
    return { value: s.value, says: `${flow.decl.name}'s mapping sets ${show(s.value)}` }
  if ("generate" in s) return { value: undefined, says: `${flow.decl.name} generates ${field}` }
  const value = example.data[s.from]
  const renamed = s.from === field ? "" : `${s.from} `
  return { value, says: `${has} ${renamed}${show(value)}` }
}

/** The rows `given` builds, in order, so the last event to set a column wins; each column says where it came from. */
function project(
  readModel: DeclData,
  flows: Flow[],
  given: ExampleData[],
): { values: Record<string, Expected> }[] {
  const rows: ReturnType<typeof project> = []
  for (const g of given) {
    const flow = flows.find((f) => f.decl === g.decl)
    if (!flow) continue
    const has = `${g.decl.name} in given has`
    const values: Record<string, Expected> = {}
    for (const column of Object.keys(readModel.fields)) {
      const e = source(flow, column, g, has)
      if (e) values[column] = e
    }
    const keys = readModel.keys.filter((k) => values[k]?.value !== undefined)
    let matched = rows.filter((r) =>
      keys.every((k) => isDeepStrictEqual(r.values[k]?.value, values[k]?.value)),
    )
    if (matched.length === 0) {
      matched = [{ values: {} }]
      rows.push(...matched)
    }
    for (const row of matched) Object.assign(row.values, values)
  }
  return rows
}

function show(value: unknown): string {
  return JSON.stringify(value)
}

/** A screen is drawn in its actors' lanes. */
function checkSeen({ slice, where }: Located, fail: Fail): void {
  if (slice.screen && slice.actors.length === 0)
    fail({
      message: `${where}: no one sees ${slice.screen.name} yet. Add .actor() for who does.`,
      element: slice.screen.name ?? "",
      slice: slice.name ?? "",
    })
}

/** Anything produced and never used, or used and never produced. */
function checkConnected(located: Located[], columns: Columns, fail: Fail): void {
  const emitted = new Set<DeclData>()
  // The slices that react to an event, and those whose specifications assume it happened.
  const reacting = new Map<DeclData, Set<Located>>()
  const assuming = new Map<DeclData, Set<Located>>()
  const add = (to: Map<DeclData, Set<Located>>, e: DeclData, at: Located) =>
    to.set(e, (to.get(e) ?? new Set()).add(at))
  const read = new Set<DeclData>()
  for (const at of located) {
    const { slice } = at
    for (const e of recorded(slice)) emitted.add(e)
    for (const e of heard(slice)) add(reacting, e, at)
    for (const t of slice.tests) for (const g of t.given) add(assuming, g.decl, at)
    for (const r of [...slice.readModels, ...slice.shows, slice.todoList]) if (r) read.add(r)
  }
  const consumed = new Set([...reacting.keys(), ...assuming.keys()])
  for (const at of located) {
    const { slice, where } = at
    const about = (d: DeclData, message: string): Warning => ({
      message,
      element: d.name ?? "",
      slice: slice.name ?? "",
    })
    // tsc rejects these too, but the CLI does not run tsc, and without this a
    // read model in given would be reported below as an event no slice emits.
    for (const t of slice.tests) {
      for (const g of t.given) {
        if (g.decl.kind !== "event")
          throw new Error(
            `${where}: ${g.decl.name} in given is ${KIND_LABEL[g.decl.kind]}. given lists events that already happened.`,
          )
      }
      if (t.when && t.when.decl.kind !== "command")
        throw new Error(
          `${where}: ${t.when.decl.name} in when is ${KIND_LABEL[t.when.decl.kind]}. when is this slice's command.`,
        )
      if (slice.shows.length > 0) {
        for (const c of t.then) {
          if ("decl" in c && !slice.shows.includes(c.decl))
            throw new Error(
              `${where}: ${c.decl.name} in then is not what this view shows. then lists rows of ${slice.shows.map((r) => r.name).join(" or ")}.`,
            )
        }
      }
      if (slice.command) {
        for (const c of t.then) {
          if ("decl" in c && c.decl.kind !== "event")
            throw new Error(
              `${where}: ${c.decl.name} in then is ${KIND_LABEL[c.decl.kind]}. then lists the events that result; reject says why the command is refused.`,
            )
        }
      }
    }
    for (const e of recorded(slice)) {
      if (!consumed.has(e))
        fail(
          about(
            e,
            `${where}: nothing uses ${e.name} yet. Add .trigger(${e.name}) or a projection's .event(${e.name}) where something reacts to it.`,
          ),
        )
    }
    // Once per read model, however many slices project it.
    if (
      slice.projection &&
      !read.has(slice.projection) &&
      columns.get(slice.projection)?.first === at
    )
      fail(
        about(
          slice.projection,
          `${where}: nothing reads ${slice.projection.name} yet. Add .readModel(${slice.projection.name}), .view(${slice.projection.name}) or .todoList(${slice.projection.name}) where it's needed.`,
        ),
      )
    for (const r of [...slice.readModels, ...slice.shows, slice.todoList]) {
      if (r && !columns.has(r))
        fail(
          about(
            r,
            `${where}: nothing fills ${r.name} yet. Add a slice with .projection(${r.name}).`,
          ),
        )
    }
  }
  // One line per event, at the slices that react to it, or else at those that assume it.
  for (const e of consumed) {
    if (e.external || emitted.has(e)) continue
    const at = [...(reacting.get(e) ?? assuming.get(e) ?? [])]
    fail({
      message: `${at.map((a) => a.where).join(", ")}: nothing emits ${e.name} yet. Add .event(${e.name}) to the slice that causes it.`,
      element: e.name ?? "",
      slice: at[0]?.slice.name ?? "",
    })
  }
}

/** Types cannot count duplicates, so this runs at assembly. A slice with no service has no method. */
function checkMethods(located: Located[]): void {
  const claimed = new Map<string, string>()
  for (const { slice, where } of located) {
    const name = slice.service?.method ?? slice.command?.decl.name
    if (!slice.service || name === undefined) continue
    const method = `${slice.service.service.name}/${name}`
    const first = claimed.get(method)
    if (first !== undefined)
      throw new Error(
        `${where}: ${method} is already used by ${first}. Name this one with .service(Service, "Name").`,
      )
    claimed.set(method, where)
  }
}
