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
  META,
  type ModelData,
  type SliceData,
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
  check(model, unchaptered, declared, fileOf, fail)
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
  if (typeof value !== "object" || value === null || !(META in value)) return undefined
  const data: unknown = (value as { [META]: unknown })[META]
  return typeof data === "object" && data !== null && "kind" in data
    ? (data as Exported)
    : undefined
}

/** Streams merge by name, so two modules can add to one lane. */
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
  const streams = new Map<string, DeclData[]>()
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
        streams.set(key, [...(streams.get(key) ?? []), ...data.members])
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
): void {
  const located = [
    ...model.chapters.flatMap((chapter) => locate(chapter.name, chapter.slices)),
    ...locate(undefined, unchaptered),
  ]
  checkDeclaredOnce(located, declared, fileOf)
  for (const at of located) {
    checkFilled(at, fail)
    checkKeys(at, fail)
    checkExternal(at)
  }
  checkConnected(located, fail)
  checkMethods(located)
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
      slice.command?.name ??
      slice.projects?.name ??
      slice.polls?.name ??
      slice.service?.method ??
      slice.reads[0]?.name
    if (slice.name === undefined && heading !== undefined) slice.name = heading
    return { slice, where: slice.name === undefined ? where : at(slice.name) }
  })
}

/** A declaration written in place is not an export, so two can share a name. */
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
  if (slice.actor) out.push(["actor", slice.actor])
  if (slice.service) out.push(["service", slice.service.service])
  if (slice.command) out.push(["command", slice.command])
  for (const f of [...slice.emits, ...slice.on]) {
    out.push(["event", f.event])
    if (f.event.external) out.push(["external", f.event.external])
  }
  for (const r of [...slice.reads, slice.polls, slice.projects]) if (r) out.push(["readModel", r])
  for (const t of slice.tests) {
    for (const c of [...t.given, t.when, ...t.then])
      if (c && "decl" in c) out.push([c.decl.kind, c.decl])
  }
  return out
}

function filledBy(flow: Flow, carrier: DeclData): Set<string> {
  return new Set([...Object.keys(carrier.fields), ...Object.keys(flow.mapping)])
}

/** Every field has a source. A model still being written may lack one, so this warns. */
function checkFilled({ slice, where }: Located, fail: Fail): void {
  const about = (d: DeclData, message: string): Warning => ({
    message,
    element: d.name ?? "",
    slice: slice.name ?? "",
  })
  if (slice.command) {
    for (const flow of slice.emits) {
      const filled = filledBy(flow, slice.command)
      for (const field of Object.keys(flow.event.fields)) {
        if (!filled.has(field)) {
          fail(
            about(
              flow.event,
              `${where}: ${flow.event.name}.${field} has no value. ` +
                `Add ${field} to ${slice.command.name}, or set it in the .emits() mapping.`,
            ),
          )
        }
      }
    }
  }
  if (slice.projects) {
    const filled = new Set(slice.on.flatMap((flow) => [...filledBy(flow, flow.event)]))
    for (const field of Object.keys(slice.projects.fields)) {
      if (!filled.has(field)) {
        fail(
          about(
            slice.projects,
            `${where}: ${slice.projects.name}.${field} has no value. ` +
              `Add .on() for an event that carries ${field}, or set it in a mapping.`,
          ),
        )
      }
    }
  }
}

/** An event finds its row by the key columns it carries. */
function checkKeys({ slice, where }: Located, fail: Fail): void {
  if (!slice.projects || slice.projects.keys.length === 0) return
  for (const flow of slice.on) {
    const filled = filledBy(flow, flow.event)
    if (!slice.projects.keys.some((k) => filled.has(k))) {
      fail({
        message:
          `${where}: ${flow.event.name} doesn't say which ${slice.projects.name} row it changes. ` +
          `Give it a key field (${slice.projects.keys.join(", ")}), or map one in .on().`,
        element: flow.event.name ?? "",
        slice: slice.name ?? "",
      })
    }
  }
}

function checkExternal({ slice, where }: Located): void {
  for (const flow of slice.emits) {
    if (flow.event.external) {
      throw new Error(
        `${where}: ${flow.event.name} belongs to ${flow.event.external.name}, so only it can emit it. ` +
          `To react to it, start a slice with m.slice().on(${flow.event.name}).`,
      )
    }
  }
}

/** Anything produced and never used, or used and never produced. */
function checkConnected(located: Located[], fail: Fail): void {
  const emitted = new Set<DeclData>()
  const consumed = new Set<DeclData>()
  const projected = new Set<DeclData>()
  const read = new Set<DeclData>()
  for (const { slice } of located) {
    for (const f of slice.emits) emitted.add(f.event)
    for (const f of slice.on) consumed.add(f.event)
    for (const t of slice.tests) for (const g of t.given) consumed.add(g.decl)
    if (slice.projects) projected.add(slice.projects)
    for (const r of [...slice.reads, slice.polls]) if (r) read.add(r)
  }
  for (const { slice, where } of located) {
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
              `${where}: ${c.decl.name} in then is ${KIND_LABEL[c.decl.kind]}. then lists the events that result, or m.rejected().`,
            )
        }
      }
    }
    for (const f of slice.emits) {
      if (!consumed.has(f.event))
        fail(
          about(
            f.event,
            `${where}: nothing uses ${f.event.name} yet. Add .on(${f.event.name}) where something reacts to it.`,
          ),
        )
    }
    const given = slice.tests.flatMap((t) => t.given.map((g) => g.decl))
    for (const e of [...slice.on.map((f) => f.event), ...given]) {
      if (!e.external && !emitted.has(e))
        fail(
          about(
            e,
            `${where}: nothing emits ${e.name} yet. Add .emits(${e.name}) to the slice that causes it.`,
          ),
        )
    }
    if (slice.projects && !read.has(slice.projects))
      fail(
        about(
          slice.projects,
          `${where}: nothing reads ${slice.projects.name} yet. Add .reads(${slice.projects.name}) or .polls(${slice.projects.name}) where it's needed.`,
        ),
      )
    for (const r of [...slice.reads, slice.polls]) {
      if (r && !projected.has(r))
        fail(
          about(r, `${where}: nothing fills ${r.name} yet. Add a slice with .projects(${r.name}).`),
        )
    }
  }
}

/** Types cannot count duplicates, so this runs at assembly. */
function checkMethods(located: Located[]): void {
  const claimed = new Map<string, string>()
  for (const { slice, where } of located) {
    if (!slice.service || (slice.service.method ?? slice.command) === undefined) continue
    const method = `${slice.service.service.name}/${slice.service.method ?? slice.command?.name}`
    const first = claimed.get(method)
    if (first !== undefined)
      throw new Error(
        `${where}: ${method} is already used by ${first}. Name this one with .service(Service, "Name").`,
      )
    claimed.set(method, where)
  }
}
