// Loads a model directory, names every declaration after its export, checks
// what the compiler cannot, and returns the render target.
import { readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { type ModelJson, toJson } from "./json.ts"
import {
  type ChapterData,
  type DeclData,
  type Exported,
  type Flow,
  META,
  type ModelData,
  type SliceData,
} from "./types.ts"

export type { ModelJson }

/** The named, checked model. The render target and the generators read this. */
export interface Assembled {
  model: ModelData
  streams: Map<string, DeclData[]>
}

/** `path` is a model directory or a single module. */
export async function assemble(path: string): Promise<ModelJson> {
  const { model, streams } = await load(path)
  return toJson(model, streams)
}

/** The same, over module namespaces already in memory. */
export function assembleModules(modules: readonly object[]): ModelJson {
  const { model, streams } = loadModules(modules)
  return toJson(model, streams)
}

export async function load(path: string): Promise<Assembled> {
  const files = statSync(path).isDirectory() ? walk(path) : [path]
  const modules: object[] = await Promise.all(
    files.map((f) => import(pathToFileURL(resolve(f)).href) as Promise<object>),
  )
  return loadModules(modules)
}

export function loadModules(modules: readonly object[]): Assembled {
  const assembled = nameExports(modules)
  check(assembled.model)
  return assembled
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return entry.name.endsWith(".ts") ? [path] : []
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

/**
 * Two modules may export a stream under one name and mean one lane, so streams
 * are unioned by name here rather than named like everything else.
 */
function nameExports(modules: readonly object[]): {
  model: ModelData
  streams: Map<string, DeclData[]>
} {
  let model: ModelData | undefined
  const streams = new Map<string, DeclData[]>()
  for (const module of modules) {
    for (const [key, value] of Object.entries(module)) {
      const data = exported(value)
      if (!data) continue
      if (data.kind === "model") {
        model = data
      } else if (data.kind === "stream") {
        streams.set(key, [...(streams.get(key) ?? []), ...data.members])
      } else if (data.name !== undefined && data.name !== key) {
        throw new Error(`'${data.name}' is also exported as '${key}'. A declaration has one name.`)
      } else {
        data.name = key
      }
    }
  }
  if (!model) throw new Error("No module exports a model. Add `export default m.model(...)`.")
  return { model, streams }
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

function check(model: ModelData): void {
  const located = model.chapters.flatMap((chapter, i) => locate(chapter, i))
  for (const at of located) {
    checkFilled(at)
    checkKeys(at)
    checkExternal(at)
  }
  checkConnected(located)
  checkMethods(located)
}

function locate(chapter: ChapterData, index: number): Located[] {
  if (chapter.name === undefined) {
    throw new Error(`Chapter #${index + 1} is not exported, so it has no name.`)
  }
  return chapter.slices.map((slice, i) => {
    const where = `slice #${i + 1} in '${chapter.name}'`
    // Every declaration in the slice must be named before the heading can be,
    // so the anonymous location stands in until then.
    for (const [kind, d] of used(slice)) {
      if (d.name === undefined)
        throw new Error(`${where} uses ${KIND_LABEL[kind]} that no module exports.`)
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

/** Every event field comes from the command; every column from some `.on()`. */
function checkFilled({ slice, where }: Located): void {
  if (slice.command) {
    for (const flow of slice.emits) {
      const filled = filledBy(flow, slice.command)
      for (const field of Object.keys(flow.event.fields)) {
        if (!filled.has(field)) {
          throw new Error(
            `${where}: ${flow.event.name}.${field} is filled by nothing. ` +
              `${slice.command.name} does not carry it and no function sets it.`,
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
          `${where}: ${slice.projects.name}.${field} is filled by nothing. No .on() writes it.`,
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
          `(${slice.projects.keys.join(", ")}).`,
      )
    }
  }
}

function checkExternal({ slice, where }: Located): void {
  for (const flow of slice.emits) {
    if (flow.event.external) {
      throw new Error(
        `${where} emits ${flow.event.name}, an event of ${flow.event.external.name}. ` +
          `External events are translated, never emitted.`,
      )
    }
  }
}

/** Dead ends across the model: what is produced but never used, or used but never produced. */
function checkConnected(located: Located[]): void {
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
    // tsc says this first; the CLI has to say it too, and before it blames the emitter.
    for (const t of slice.tests) {
      for (const g of t.given) {
        if (g.decl.kind !== "event")
          throw new Error(
            `${where} gives ${g.decl.name}, ${KIND_LABEL[g.decl.kind]}; given takes events.`,
          )
      }
      if (t.when && t.when.decl.kind !== "command")
        throw new Error(
          `${where} has ${t.when.decl.name} as when, ${KIND_LABEL[t.when.decl.kind]}; when takes a command.`,
        )
      if (slice.command) {
        for (const c of t.then) {
          if ("decl" in c && c.decl.kind !== "event")
            throw new Error(
              `${where} expects ${c.decl.name}, ${KIND_LABEL[c.decl.kind]}; then takes events or a rejection.`,
            )
        }
      }
    }
    for (const f of slice.emits) {
      if (!consumed.has(f.event)) {
        throw new Error(
          `${where} emits ${f.event.name}, which nothing consumes: no .on() and no given.`,
        )
      }
    }
    const given = slice.tests.flatMap((t) => t.given.map((g) => g.decl))
    for (const e of [...slice.on.map((f) => f.event), ...given]) {
      if (!e.external && !emitted.has(e))
        throw new Error(`${where} uses ${e.name}, which no slice emits.`)
    }
    if (slice.projects && !read.has(slice.projects)) {
      throw new Error(`${where} projects ${slice.projects.name}, which nothing reads.`)
    }
    for (const r of [...slice.reads, slice.polls]) {
      if (r && !projected.has(r))
        throw new Error(`${where} reads ${r.name}, which nothing projects.`)
    }
  }
}

/** A union of literal types dedupes rather than counts, so this is a runtime check. */
function checkMethods(located: Located[]): void {
  const claimed = new Map<string, string>()
  for (const { slice, where } of located) {
    if (!slice.service) continue
    const method = `${slice.service.service.name}/${slice.service.method ?? slice.command?.name}`
    const first = claimed.get(method)
    if (first !== undefined) throw new Error(`${first} and ${where} both claim ${method}.`)
    claimed.set(method, where)
  }
}
