// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { type ModelJson, toJson } from "./json.ts"
import {
  type Assembled,
  type ChapterData,
  type Declaration,
  type DeclData,
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

export async function load(path: string, options: Options = {}): Promise<Assembled> {
  const files = statSync(path).isDirectory() ? walk(path) : [path]
  const modules: object[] = await Promise.all(
    files.map((f) => import(pathToFileURL(resolve(f)).href) as Promise<object>),
  )
  return loadModules(modules, options)
}

export function loadModules(modules: readonly object[], options: Options = {}): Assembled {
  const { model, streams, declared } = nameExports(modules)
  const warnings: Warning[] = []
  const fail: Fail = options.partial
    ? (warning) => {
        warnings.push(warning)
      }
    : (warning) => {
        throw new Error(warning.message)
      }
  check(model, fail)
  const loose = looseOf(model, streams, declared)
  for (const d of loose) fail({ message: `${d.name} is in no slice yet.`, element: d.name ?? "" })
  return { model, streams, loose, warnings }
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
function nameExports(modules: readonly object[]): {
  model: ModelData
  streams: Map<string, DeclData[]>
  declared: Declaration[]
} {
  let model: ModelData | undefined
  const streams = new Map<string, DeclData[]>()
  const declared: Declaration[] = []
  for (const module of modules) {
    for (const [key, value] of Object.entries(module)) {
      const data = exported(value)
      if (!data) continue
      if (data.kind === "model") {
        model = data
      } else if (data.kind === "stream") {
        streams.set(key, [...(streams.get(key) ?? []), ...data.members])
      } else if (data.name !== undefined && data.name !== key) {
        throw new Error(`'${data.name}' is also exported as '${key}'. Keep one of the two exports.`)
      } else if (data.kind !== "chapter") {
        data.name = key
        declared.push(data)
      } else {
        data.name = key
      }
    }
  }
  if (!model) throw new Error("No module exports a model. Add `export default m.model(...)`.")
  return { model, streams, declared }
}

/** Declarations in no slice yet, stream members first. */
function looseOf(
  model: ModelData,
  streams: Map<string, DeclData[]>,
  declared: Declaration[],
): Declaration[] {
  const inUse = new Set<object>()
  for (const chapter of model.chapters) {
    for (const slice of chapter.slices) for (const [, d] of used(slice)) inUse.add(d)
  }
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

function check(model: ModelData, fail: Fail): void {
  const located = model.chapters.flatMap((chapter, i) => locate(chapter, i))
  for (const at of located) {
    checkFilled(at)
    checkKeys(at)
    checkExternal(at)
  }
  checkConnected(located, fail)
  checkMethods(located)
}

function locate(chapter: ChapterData, index: number): Located[] {
  if (chapter.name === undefined) {
    throw new Error(
      `Chapter #${index + 1} has no name. Export it: \`export const Name = m.chapter([...])\`.`,
    )
  }
  return chapter.slices.map((slice, i) => {
    const where = `slice #${i + 1} in '${chapter.name}'`
    // The slice is named after its declarations, so until they are checked
    // `where` is its position.
    for (const [kind, d] of used(slice)) {
      if (d.name === undefined)
        throw new Error(`${where} uses ${KIND_LABEL[kind]} that no module exports. Export it.`)
    }
    const heading =
      slice.command?.name ??
      slice.projects?.name ??
      slice.polls?.name ??
      slice.service?.method ??
      slice.reads[0]?.name
    if (slice.name === undefined && heading !== undefined) slice.name = heading
    return { slice, where: `slice '${slice.name}' in '${chapter.name}'` }
  })
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

/** Every field has a source. */
function checkFilled({ slice, where }: Located): void {
  if (slice.command) {
    for (const flow of slice.emits) {
      const filled = filledBy(flow, slice.command)
      for (const field of Object.keys(flow.event.fields)) {
        if (!filled.has(field)) {
          throw new Error(
            `${where}: nothing fills ${flow.event.name}.${field}. ` +
              `Add ${field} to ${slice.command.name}, or set it in the .emits() mapping.`,
          )
        }
      }
    }
  }
  if (slice.projects) {
    const filled = new Set(slice.on.flatMap((flow) => [...filledBy(flow, flow.event)]))
    for (const field of Object.keys(slice.projects.fields)) {
      if (!filled.has(field)) {
        throw new Error(
          `${where}: nothing fills ${slice.projects.name}.${field}. ` +
            `Add an .on() whose event carries ${field}, or set it in a mapping.`,
        )
      }
    }
  }
}

/** An event finds its row by the key columns it carries. */
function checkKeys({ slice, where }: Located): void {
  if (!slice.projects || slice.projects.keys.length === 0) return
  for (const flow of slice.on) {
    const filled = filledBy(flow, flow.event)
    if (!slice.projects.keys.some((k) => filled.has(k))) {
      throw new Error(
        `${where}: ${flow.event.name} carries none of ${slice.projects.name}'s key columns ` +
          `(${slice.projects.keys.join(", ")}). Add one to ${flow.event.name} or map it in .on().`,
      )
    }
  }
}

function checkExternal({ slice, where }: Located): void {
  for (const flow of slice.emits) {
    if (flow.event.external) {
      throw new Error(
        `${where} emits ${flow.event.name}, which only ${flow.event.external.name} emits. ` +
          `Receive it with m.slice().on(${flow.event.name}) instead.`,
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
            `${where}: given has ${g.decl.name}, ${KIND_LABEL[g.decl.kind]}. given takes events.`,
          )
      }
      if (t.when && t.when.decl.kind !== "command")
        throw new Error(
          `${where}: when has ${t.when.decl.name}, ${KIND_LABEL[t.when.decl.kind]}. when takes the slice's command.`,
        )
      if (slice.command) {
        for (const c of t.then) {
          if ("decl" in c && c.decl.kind !== "event")
            throw new Error(
              `${where}: then has ${c.decl.name}, ${KIND_LABEL[c.decl.kind]}. then takes events or m.rejected().`,
            )
        }
      }
    }
    for (const f of slice.emits) {
      if (!consumed.has(f.event))
        fail(
          about(
            f.event,
            `${where} emits ${f.event.name}, which nothing uses yet. Add .on(${f.event.name}) to a slice or use it in a given.`,
          ),
        )
    }
    const given = slice.tests.flatMap((t) => t.given.map((g) => g.decl))
    for (const e of [...slice.on.map((f) => f.event), ...given]) {
      if (!e.external && !emitted.has(e))
        fail(
          about(
            e,
            `${where} uses ${e.name}, which no slice emits yet. Add .emits(${e.name}) to a slice.`,
          ),
        )
    }
    if (slice.projects && !read.has(slice.projects))
      fail(
        about(
          slice.projects,
          `${where} projects ${slice.projects.name}, which nothing reads yet. Add .reads(${slice.projects.name}) or .polls(${slice.projects.name}) to a slice.`,
        ),
      )
    for (const r of [...slice.reads, slice.polls]) {
      if (r && !projected.has(r))
        fail(
          about(
            r,
            `${where} reads ${r.name}, which nothing projects yet. Add a slice with .projects(${r.name}).`,
          ),
        )
    }
  }
}

/** Types cannot count duplicates, so this runs at assembly. */
function checkMethods(located: Located[]): void {
  const claimed = new Map<string, string>()
  for (const { slice, where } of located) {
    if (!slice.service) continue
    const method = `${slice.service.service.name}/${slice.service.method ?? slice.command?.name}`
    const first = claimed.get(method)
    if (first !== undefined)
      throw new Error(
        `${first} and ${where} both use ${method}. Give one its own method: .service(service, "Name").`,
      )
    claimed.set(method, where)
  }
}
