// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { type ModelJson, toJson } from "./json.ts"
import {
  type Assembled,
  type Declaration,
  type DeclData,
  DRAFTS,
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

export type { Assembled, ModelJson, Warning }

export interface Options {
  /** Render an incomplete model with warnings instead of failing with errors. */
  partial?: boolean
}

/** Throws, or warns when `partial`. */
type Fail = (warning: Warning) => void

/** `path` is a model directory or a single module. */
export async function assemble(path: string, options: Options = {}): Promise<ModelJson> {
  return toJson(await load(path, options))
}

/** `assemble` for modules already loaded. */
export function assembleModules(modules: readonly object[], options: Options = {}): ModelJson {
  return toJson(loadModules(modules, options))
}

/** A module runs once per process, so a second load of the same files finds no slice in no chapter. */
export async function load(path: string, options: Options = {}): Promise<Assembled> {
  const dir = statSync(path).isDirectory() ? path : dirname(path)
  const files = dir === path ? walk(path) : [path]
  DRAFTS.clear()
  const modules: object[] = await Promise.all(
    files.map((f) => import(pathToFileURL(resolve(f)).href) as Promise<object>),
  )
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
  const { model, streams, declared, fileOf } = nameExports(modules, files)
  const warnings: Warning[] = []
  const fail: Fail = options.partial
    ? (warning) => {
        warnings.push(warning)
      }
    : (warning) => {
        throw new Error(warning.message)
      }
  const chaptered = new Set(model.chapters.flatMap((c) => c.slices))
  const unchaptered = drafts.filter((s) => !chaptered.has(s))
  check(model, unchaptered, declared, fileOf, fail, !options.partial)
  for (const s of unchaptered) {
    const name = s.name ?? "A slice"
    fail({ message: `${name} isn't in a chapter yet.`, element: "", slice: s.name ?? "" })
  }
  const loose = looseOf([...chaptered, ...unchaptered], streams, declared)
  for (const d of loose) fail({ message: `${d.name} isn't in a slice yet.`, element: d.name ?? "" })
  return { model, streams, loose, unchaptered, warnings }
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

/** Streams merge by name, so two modules can add to one lane. Lanes keep the order written. */
function nameExports(
  modules: readonly object[],
  files: readonly string[],
): {
  model: ModelData
  streams: Map<string, DeclData[]>
  declared: Declaration[]
  fileOf: Map<object, string>
} {
  let model: ModelData | undefined
  const lanes: [string, StreamData][] = []
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
        // Its events may be declared inside it, so no export names them.
        for (const e of data.events) if (!declared.includes(e)) declared.push(e)
      } else if (data.name !== undefined && data.name !== key) {
        throw new Error(`${data.name} is exported twice, also as ${key}. Keep one.`)
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
  return { model, streams, declared, fileOf }
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
  service: "a service",
  external: "an external system",
}

interface Located {
  slice: SliceData
  where: string
}

function check(
  model: ModelData,
  unchaptered: SliceData[],
  declared: Declaration[],
  fileOf: Map<object, string>,
  fail: Fail,
  strict: boolean,
): void {
  const located = [
    ...model.chapters.flatMap((chapter) => locate(chapter.name, chapter.slices)),
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
    checkOutcomes(at, fail)
  }
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
    const heading =
      slice.command?.decl.name ??
      slice.projection?.name ??
      slice.todoList?.name ??
      slice.service?.method ??
      slice.shows[0]?.name
    if (slice.name === undefined && heading !== undefined) slice.name = heading
    return { slice, where: slice.name === undefined ? where : at(slice.name) }
  })
}

/** Two modules can export one name. An external system is found through the slices that use it. */
function checkDeclaredOnce(
  located: Located[],
  declared: Declaration[],
  fileOf: Map<object, string>,
): void {
  const byName = new Map<string, object>()
  const all = [...declared, ...located.flatMap(({ slice }) => used(slice).map(([, d]) => d))]
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
  if (slice.service) out.push(["service", slice.service.service])
  if (slice.command) out.push(["command", slice.command.decl])
  for (const e of [...slice.events.map((f) => f.decl), ...(slice.trigger ? [slice.trigger] : [])]) {
    out.push(["event", e])
    if (e.external) out.push(["external", e.external])
  }
  const readModels = [...slice.readModels, ...slice.shows, slice.todoList, slice.projection]
  for (const r of readModels) if (r) out.push(["readModel", r])
  for (const t of slice.tests) {
    for (const c of [...t.given, t.when, ...t.then])
      if (c && "decl" in c) out.push([c.decl.kind, c.decl])
  }
  return out
}

/** The fields a flow fills: those that copy by name from `source`, and those its mapping sets. */
function filled(flow: Flow, source: DeclData): string[] {
  return [...Object.keys(source.fields), ...Object.keys(flow.mapping)]
}

/** Each read model's projection slices, the first of them, and the columns they fill together. */
type Columns = Map<DeclData, { first: Located; filled: string[] }>

function columnsOf(located: Located[]): Columns {
  const columns: Columns = new Map()
  for (const at of located) {
    const { projection, events } = at.slice
    if (!projection) continue
    const sofar = columns.get(projection) ?? { first: at, filled: [] }
    sofar.filled.push(...events.flatMap((flow) => filled(flow, flow.decl)))
    columns.set(projection, sofar)
  }
  return columns
}

/**
 * Every field has a source. A model still being written may lack one, so this warns. A read model's
 * columns are filled by all its projection slices, and reported at the first.
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
      filled(command, from),
      (f) => `Add ${f} to ${from.name}, or set it in the mapping.`,
    )
  // An external event's fields come from outside.
  if (command && !projection)
    for (const flow of slice.events.filter((f) => !f.decl.external))
      check(
        flow.decl,
        filled(flow, command.decl),
        (f) => `Add ${f} to ${command.decl.name}, or set it in the mapping.`,
      )
  const together = projection && columns.get(projection)
  if (projection && together?.first === at)
    check(
      projection,
      together.filled,
      (f) => `Add .event() for an event that carries ${f}, or set it in a mapping.`,
    )
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

/** A command's events are alternatives, and only a specification says when each happens. */
function checkOutcomes({ slice, where }: Located, fail: Fail): void {
  if (!slice.command || slice.projection) return
  const shown = new Set(
    slice.tests.flatMap((t) => t.then.flatMap((c) => ("decl" in c ? [c.decl] : []))),
  )
  for (const { decl } of slice.events) {
    if (!shown.has(decl))
      fail({
        message: `${where}: no specification shows ${decl.name} yet. Add a .test whose then has ${decl.name}(...).`,
        element: decl.name ?? "",
        slice: slice.name ?? "",
      })
  }
}

/** Anything produced and never used, or used and never produced. */
function checkConnected(located: Located[], columns: Columns, fail: Fail): void {
  const emitted = new Set<DeclData>()
  const consumed = new Set<DeclData>()
  const read = new Set<DeclData>()
  for (const { slice } of located) {
    for (const e of recorded(slice)) emitted.add(e)
    for (const e of heard(slice)) consumed.add(e)
    for (const t of slice.tests) for (const g of t.given) consumed.add(g.decl)
    for (const r of [...slice.readModels, ...slice.shows, slice.todoList]) if (r) read.add(r)
  }
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
    const given = slice.tests.flatMap((t) => t.given.map((g) => g.decl))
    for (const e of [...heard(slice), ...given]) {
      if (!e.external && !emitted.has(e))
        fail(
          about(
            e,
            `${where}: nothing emits ${e.name} yet. Add .event(${e.name}) to the slice that causes it.`,
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
