// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

import { type Feed, toFeed } from "./spec.ts"
import {
  type ActorData,
  type Assembled,
  type ChapterData,
  type Declaration,
  type DeclData,
  DRAFTS,
  type ExampleData,
  type Exported,
  type ExternalData,
  type Flow,
  heard,
  META,
  type ModelData,
  resolve as named,
  origin,
  REGISTRY,
  type Registered,
  recorded,
  type SliceData,
  type StreamData,
  type TestData,
  taken,
  type Warning,
  WRITTEN,
} from "./types.ts"

export type { Assembled, Feed, Warning }

export interface Options {
  /** Render an incomplete model with warnings instead of failing with errors. */
  partial?: boolean
}

/** Records a dead end, and the slice it is found checking alone; a strict assembly throws them all at the end. */
type Fail = (warning: Warning, of?: SliceData) => void

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
  const { modules, dir } = await importModel(path)
  return loadModules(modules, options, dir)
}

/**
 * Runs the model's modules, which declare what `REGISTRY` holds and write the slices, and returns
 * their exports. `dir` is the model's directory.
 */
export async function importModel(
  path: string,
): Promise<{ modules: object[]; files: string[]; dir: string }> {
  const { dir, files } = modelFiles(path)
  DRAFTS.clear()
  WRITTEN.clear()
  REGISTRY.clear()
  // One at a time, so the modules run in one order every load: by path, each after what it
  // imports. That order is the order slices are written in.
  const modules: object[] = []
  for (const f of files) modules.push((await import(pathToFileURL(resolve(f)).href)) as object)
  return { modules, files, dir }
}

/**
 * Takes what was declared and written since the last assembly, so one model's never reach the
 * next. `dir` is where a message says a declaration is from, relative to.
 */
export function loadModules(
  modules: readonly object[],
  options: Options = {},
  dir = process.cwd(),
): Assembled {
  try {
    return assembled(modules, options, dir)
  } finally {
    DRAFTS.clear()
    WRITTEN.clear()
    REGISTRY.clear()
  }
}

function assembled(modules: readonly object[], options: Options, dir: string): Assembled {
  const warnings: Warning[] = []
  const unfinished = new Map<SliceData, string[]>()
  const fail: Fail = (warning, of) => {
    warnings.push(warning)
    if (of) unfinished.set(of, [...(unfinished.get(of) ?? []), warning.message])
  }
  // Two things claiming one name, chapter or method: a partial assembly keeps the first and draws on.
  const conflict: Fail = options.partial
    ? fail
    : (warning) => {
        throw new Error(warning.message)
      }
  const { model, streams, chapters, externals, declared } = nameDeclarations(
    modules,
    [...REGISTRY],
    dir,
    fail,
    conflict,
  )
  make()
  const written = [...DRAFTS]
  for (const s of written) s.tests = s.tests.map(run)
  const drafts = runBy(firstSystem(declared), oneSlicePerView(written, fail))
  const unchaptered: SliceData[] = []
  for (const s of drafts) {
    const name = chapterOf(s, conflict)
    const chapter = chapters.find((c) => c.name === name)
    if (chapter) chapter.slices.push(s)
    else unchaptered.push(s)
  }
  check(chapters, unchaptered, declared, fail, conflict)
  for (const c of chapters)
    if (c.slices.length === 0) fail({ message: `${c.name} has no slices yet.`, element: "" })
  const loose = looseOf(drafts, streams, declared)
  for (const [name, members] of streams)
    if (members.length === 0) fail({ message: `${name} has no events yet.`, element: name })
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
  return { model, streams, chapters, externals, loose, unchaptered, warnings, unfinished }
}

/**
 * Makes every slice written, in the order written, now that every module has run. A call that
 * throws, such as one naming what nothing declares, is left out, and the slice keeps what it threw.
 */
function make(): void {
  const slices = [...WRITTEN]
  WRITTEN.clear()
  for (const { start, calls } of slices) {
    let step = start() as Record<string, (...args: unknown[]) => typeof step>
    const failed: string[] = []
    for (const [method, args] of calls) {
      try {
        const call = step[method]
        if (!call) throw new Error(`a slice has no .${method}().`)
        step = call(...args)
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (failed.length > 0) (step as unknown as { [META]: SliceData })[META].failed = failed
  }
}

/** A specification written as a function runs now; what it throws is left to do. */
function run(test: TestData): TestData {
  try {
    return test.later?.() ?? test
  } catch (error) {
    const threw = error instanceof Error ? error.message : String(error)
    return { name: test.name, given: [], then: [], threw }
  }
}

/**
 * Every `m.slice().view()` of a view is one slice: the first, where it is drawn, which chapter it
 * joins and who sees it, built from the events of all of them and specified by all their
 * specifications.
 * What a later call says about where or how it is drawn would be lost, so it is reported.
 */
function oneSlicePerView(drafts: SliceData[], fail: Fail): SliceData[] {
  const calls = new Map<DeclData, SliceData[]>()
  for (const s of drafts) if (s.view) calls.set(s.view, [...(calls.get(s.view) ?? []), s])
  return drafts.flatMap((s) => {
    const all = s.view && calls.get(s.view)
    if (!all) return [s]
    if (all[0] !== s) return []
    const merged = {
      ...s,
      events: all.flatMap((c) => c.events),
      tests: all.flatMap((c) => c.tests),
      failed: all.flatMap((c) => c.failed ?? []),
    }
    for (const later of all.slice(1)) for (const w of drawnElsewhere(s, later)) fail(w, merged)
    return [merged]
  })
}

/** What a later `.view()` of the first's view says differently about drawing it. */
function drawnElsewhere(first: SliceData, later: SliceData): Warning[] {
  const rm = first.view?.name ?? ""
  const chapter = (s: SliceData) => s.chapters.map((c) => c.name).join(" and ") || undefined
  const actors = (s: SliceData) => s.actors.map((a) => a.name).join(" and ") || undefined
  const method = (s: SliceData) => s.service && `${s.service.service.name}/${s.service.method}`
  const context = (s: SliceData) => (s.context ? Object.keys(s.context).join(", ") : undefined)
  const quoted = (text: string | undefined) => (text === undefined ? undefined : show(text))
  const differs: [string | undefined, string | undefined, string, string, string][] = [
    [chapter(later), chapter(first), "names chapter", "drawn in", "drawn in no chapter"],
    [quoted(later.name), quoted(first.name ?? rm), "names the slice", "drawn as", ""],
    [actors(later), actors(first), "names actor", "seen by", "seen by no one"],
    [later.screen?.name, first.screen?.name, "names screen", "shown on", "shown on no screen"],
    [method(later), method(first), "names method", "served by", "served by no method"],
    [context(later), context(first), "asks with", "asked with", "asked with nothing"],
    [
      quoted(later.note),
      quoted(first.note),
      "has the note",
      "drawn with the note",
      "drawn with no note",
    ],
  ]
  return differs.flatMap(([said, kept, names, is, none]) =>
    said === undefined || said === kept
      ? []
      : [
          {
            message: `${rm}: this .view() ${names} ${said}, but ${rm} is ${kept === undefined ? none : `${is} ${kept}`}, where it is first written. Remove it, or move the first.`,
            element: rm,
            slice: first.name ?? rm,
          },
        ],
  )
}

/** The machine of ours declared first, if any. */
function firstSystem(declared: Declaration[]): ActorData | undefined {
  const systems = declared.flatMap((d) => (d.kind === "actor" && d.icon === "system" ? [d] : []))
  return systems.sort((a, b) => a.order - b.order)[0]
}

/**
 * An automation that names no machine of ours, or a state view no one sees, is run by `system`, or
 * else by System.
 */
function runBy(system: ActorData | undefined, drafts: SliceData[]): SliceData[] {
  return drafts.map((s) =>
    system && !s.system && (s.trigger || s.polls || (s.view && s.actors.length === 0))
      ? { ...s, system }
      : s,
  )
}

/** The model's directory, and its modules: those under it, or the one module `path` is. */
export function modelFiles(path: string): { dir: string; files: string[] } {
  const dir = statSync(path).isDirectory() ? path : dirname(path)
  return { dir, files: dir === path ? walk(path) : [path] }
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

/** The model a module exports by default. */
function modelOf(module: object): ModelData | undefined {
  const value = (module as { default?: unknown }).default
  const data =
    typeof value === "object" && value !== null && META in value
      ? (value as { [META]: Exported })[META]
      : undefined
  return data?.kind === "model" ? data : undefined
}

/** `file:///…/notes.ts:12:3` as `notes.ts:12`, from `dir`. */
function at(where: string, dir: string): string {
  const [, file = "", line = ""] = /^(.*):(\d+):\d+$/.exec(where) ?? []
  return `${relative(dir, file.startsWith("file:") ? fileURLToPath(file) : file)}:${line}`
}

/**
 * Everything the model declares, by name, with its lanes found. A stream, a system and a chapter are
 * one by name, however often declared; anything else declared twice is reported. Chapters come in
 * the order of their numbers, then those with none in the order declared. An event is in one lane,
 * so not in both.
 */
function nameDeclarations(
  modules: readonly object[],
  registered: [string, Registered][],
  dir: string,
  fail: Fail,
  conflict: Fail,
): {
  model: ModelData
  streams: Map<string, DeclData[]>
  chapters: Assembled["chapters"]
  externals: string[]
  declared: Declaration[]
} {
  const model = modules.map(modelOf).find((found) => found !== undefined)
  if (!model)
    throw new Error('No model found. Add `export default m.model("Name")` to one of your files.')
  const lanes: StreamData[] = []
  const headings: ChapterData[] = []
  const externals: string[] = []
  const declared: Declaration[] = []
  for (const [name, { data, where, also }] of registered) {
    for (const again of also)
      conflict({
        message: `${name} is declared twice, at ${at(where, dir)} and ${at(again, dir)}. Keep one.`,
        element: name,
      })
    if (data.kind === "stream") lanes.push(data)
    else if (data.kind === "chapter") headings.push(data)
    else if (data.kind === "external") externals.push(name)
    else if (data.kind !== "model") declared.push(data)
  }
  const streams = new Map<string, DeclData[]>(
    lanes.sort((a, b) => a.order - b.order).map((l) => [l.name ?? "", []]),
  )
  // An event's lane is named where it is declared, and found once every module has run.
  const lane = <D>(ref: object, as: string): D | undefined => {
    try {
      return named(ref, as) as D
    } catch (error) {
      fail({ message: error instanceof Error ? error.message : String(error), element: "" })
      return undefined
    }
  }
  for (const e of declared) {
    if (e.kind !== "event") continue
    const system = e.system && lane<ExternalData>(e.system, "m.external")
    if (system) e.external = system
    const stream = e.stream && lane<StreamData>(e.stream, "m.stream")
    if (!stream) continue
    if (system)
      conflict({
        message: `${e.name} is in the ${stream.name} stream and the ${system.name} system. Keep one: .stream() for ours, .external() for theirs.`,
        element: e.name ?? "",
      })
    else streams.get(stream.name ?? "")?.push(e)
  }
  const chapters: Assembled["chapters"] = []
  const numbered = new Map<number, string>()
  const place = ({ number }: ChapterData) => number ?? Number.POSITIVE_INFINITY
  for (const { name = "", note, number } of headings.sort(
    (a, b) => place(a) - place(b) || a.order - b.order,
  )) {
    if (number !== undefined) {
      const other = numbered.get(number)
      if (other !== undefined)
        conflict({
          message: `${other} and ${name} are both chapter ${number}. Give each its own number.`,
          element: "",
        })
      numbered.set(number, name)
    }
    chapters.push({ name, ...(note !== undefined && { note }), slices: [] })
  }
  return { model, streams, chapters, externals, declared }
}

/** The name of the chapter a slice joined, if it joined one; of several, the first. */
function chapterOf(slice: SliceData, conflict: Fail): string | undefined {
  const all = [...new Set(slice.chapters.map((c) => c.name))]
  const names = all.filter((n) => n !== undefined)
  const where = heading(slice) ?? "A slice"
  if (names.length > 1)
    conflict(
      {
        message: `${where}: this slice joins ${names.join(" and ")}. Keep one .chapter().`,
        element: "",
        slice: where,
      },
      slice,
    )
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
  view: "a view",
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
  fail: Fail,
  conflict: Fail,
): void {
  const located = [
    ...chapters.flatMap((chapter) => locate(chapter.name, chapter.slices)),
    ...locate(undefined, unchaptered),
  ]
  const built = builtOf(located)
  for (const at of located) {
    const own: Fail = (warning) => fail(warning, at.slice)
    checkFailed(at, own)
    checkCore(at, own)
    checkThrown(at, own)
    checkFilled(at, own)
    checkRecorded(at, own)
    checkKeys(at, own)
    checkStored(at, own)
    checkCovered(at, own)
    checkSeen(at, own)
    checkSpecs(at, built, own)
    checkGenerated(at, own)
  }
  checkFilledSomewhere(located, fail)
  checkConnected(located, built, declared, fail)
  checkMethods(located, conflict)
}

/** What a slice still being written lacks: the compiler allows it, so the slice is drawn as far as it goes. */
function checkCore({ slice, where }: Located, fail: Fail): void {
  const { command, trigger, polls, view, events } = slice
  const from = trigger ?? polls
  const said = (message: string) =>
    fail({ message: `${where}: ${message}`, element: "", slice: slice.name ?? "" })
  if (!command && !from && !view)
    said("empty. Start it with .command(), .view(), .automation() or .translation().")
  else if (from && !command)
    said(
      `no command yet. Add .command() after .${from.external ? "translation" : "automation"}(d.${from.name}).`,
    )
  else if (events.length === 0)
    said(
      `no event yet. Add .event() after ${command ? `.command(d.${command.decl.name})` : `.view(d.${view?.name})`}.`,
    )
  // The compiler refuses it too; without a name, proto would write an rpc with none.
  if (view && slice.service && slice.service.method === undefined)
    said(
      `a state view names its method: .service(d.${slice.service.service.name}, "List${view.name}").`,
    )
}

/** A call that threw is drawn as no call, and what it threw is left to do. */
function checkFailed({ slice, where }: Located, fail: Fail): void {
  for (const message of slice.failed ?? [])
    fail({ message: `${where}: ${message}`, element: "", slice: slice.name ?? "" })
}

/** A mapping that threw is drawn as no mapping, and what it threw is left to do. */
function checkThrown({ slice, where }: Located, fail: Fail): void {
  for (const flow of [...flows(slice), ...slice.reads])
    if (flow.threw !== undefined)
      fail({
        message: `${where}: ${flow.decl.name}'s mapping threw: ${flow.threw}`,
        element: flow.decl.name ?? "",
        slice: slice.name ?? "",
      })
}

/** `chapter` is undefined for the slices in none. */
function locate(chapter: string | undefined, slices: SliceData[]): Located[] {
  return slices.map((slice, i) => {
    const named = heading(slice)
    if (named !== undefined) slice.name = named
    const name = slice.name ?? `slice ${i + 1}`
    return { slice, where: chapter === undefined ? name : `${chapter} › ${name}` }
  })
}

/** What heads a slice's column: its name, or else what it is named after. */
function heading(slice: SliceData): string | undefined {
  return (
    slice.name ??
    slice.command?.decl.name ??
    slice.view?.name ??
    slice.polls?.name ??
    slice.trigger?.name
  )
}

/** Everything a slice refers to, with the word an error uses for it. */
function used(slice: SliceData): [keyof typeof KIND_LABEL, { name?: string }][] {
  const out: [keyof typeof KIND_LABEL, { name?: string }][] = []
  for (const a of [...slice.actors, ...(slice.system ? [slice.system] : [])]) out.push(["actor", a])
  if (slice.screen) out.push(["screen", slice.screen])
  if (slice.service) out.push(["service", slice.service.service])
  if (slice.command) out.push(["command", slice.command.decl])
  for (const e of [...slice.events.map((f) => f.decl), ...(slice.trigger ? [slice.trigger] : [])]) {
    out.push(["event", e])
    if (e.external) out.push(["external", e.external])
  }
  for (const r of [...slice.reads.map((q) => q.decl), slice.polls, slice.view])
    if (r) out.push(["view", r])
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

/**
 * A mapping copies a field, sets a constant or says what a value is made from. One that computes a
 * value is drawn as generated and left to do: what it computes is the handler's, not the model's. An
 * automation's command makes nothing: it is filled from what is before it.
 */
function checkGenerated({ slice, where }: Located, fail: Fail): void {
  const from = slice.trigger ?? slice.polls
  for (const flow of flows(slice)) {
    for (const [field, s] of Object.entries(flow.mapping)) {
      const target = `${flow.decl.name}.${field}`
      if ("built" in s) {
        fail({
          message: `${where}: ${target} is computed in the mapping. Set it to a source field, a t.literal() or m.generate() with what it is made from.`,
          element: flow.decl.name ?? "",
          slice: slice.name ?? "",
        })
        continue
      }
      if (from && flow === slice.command && "generate" in s)
        fail({
          message: `${where}: ${target} is generated, but an automation's command is filled from what is before it. Add ${field} to ${from.name} or a view it queries, or generate it in an event ${flow.decl.name} records.`,
          element: flow.decl.name ?? "",
          slice: slice.name ?? "",
        })
    }
  }
}

/**
 * The fields a flow fills: those that copy by name from before its step, and those its mapping sets.
 * What a mapping that threw sets is unknown, so it is taken to set them all, and only the throw is left to do.
 */
function filled(flow: Flow): string[] {
  if (flow.threw !== undefined) return Object.keys(flow.decl.fields)
  return [...Object.keys(flow.context), ...Object.keys(flow.mapping)]
}

/** The fields that may go without a value. */
function optional(decl: DeclData): string[] {
  return Object.keys(decl.fields).filter((f) => decl.fields[f]?.safeParse(undefined).success)
}

/** Each view a state view slice builds, and the events that build it. */
type Built = Map<DeclData, Flow[]>

function builtOf(located: Located[]): Built {
  return new Map(located.flatMap(({ slice }) => (slice.view ? [[slice.view, slice.events]] : [])))
}

/**
 * Every field has a source. A model still being written may lack one, so this warns. An optional
 * field may go unfilled here, if another slice fills it.
 */
function checkFilled({ slice, where }: Located, fail: Fail): void {
  const check = (target: DeclData, sources: string[], fix: (field: string) => string) => {
    for (const field of Object.keys(target.fields)) {
      if (!sources.includes(field))
        fail({
          message: `${where}: ${target.name}.${field} has no value. ${fix(field)}`,
          element: target.name ?? "",
          slice: slice.name ?? "",
          fields: [field],
        })
    }
  }
  const { command, view } = slice
  if (command && (slice.trigger || slice.polls))
    check(
      command.decl,
      [...filled(command), ...optional(command.decl)],
      (f) => `Add ${f} to a step before .command() or set it in the mapping.`,
    )
  // An external event's fields come from outside, and an event of ours can keep them.
  if (command)
    for (const flow of slice.events.filter((f) => !f.decl.external))
      check(
        flow.decl,
        [...filled(flow), ...optional(flow.decl)],
        (f) => `Add ${f} to a step before .event() or set it in the mapping.`,
      )
  if (view)
    check(
      view,
      slice.events.flatMap(filled),
      (f) => `Add .event() with an event that carries ${f}, or set it in a mapping.`,
    )
}

/**
 * A command field no event records is information the system takes in and loses. It reaches an
 * event by name, by a mapping or as what a generated value is made from; generating from the whole
 * command uses every field, and so does a query after it that filters by one.
 */
function checkRecorded({ slice, where }: Located, fail: Fail): void {
  const { command, events } = slice
  if (!command || events.length === 0) return
  const all = Object.keys(command.decl.fields)
  const recorded = events.flatMap((e) => taken(e, command.decl))
  // A query after the command filters by its fields, which uses them.
  for (const read of slice.reads.slice(slice.beforeCommand))
    for (const s of Object.values(read.mapping))
      if ("from" in s && origin(read, s) === command.decl) recorded.push(s.from)
  const name = command.decl.name
  for (const field of all.filter((f) => !recorded.includes(f)))
    fail({
      message: `${where}: ${name}.${field} reaches no event. Record it in ${events.map((e) => e.decl.name).join(" or ")}, or remove it from ${name}.`,
      element: name ?? "",
      slice: slice.name ?? "",
      fields: [field],
    })
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
    const { command } = slice
    if (!command) continue
    const automated = slice.trigger || slice.polls
    add(command.decl, automated ? filled(command) : Object.keys(command.decl.fields))
    for (const flow of slice.events)
      add(flow.decl, flow.decl.external ? optional(flow.decl) : filled(flow))
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

/** An event finds its row by the key columns it carries, so it carries every one. A list's adds a row. */
function checkKeys({ slice, where }: Located, fail: Fail): void {
  if (!slice.view || slice.view.list || slice.view.keys.length === 0) return
  for (const flow of slice.events) {
    const carried = filled(flow)
    const missing = slice.view.keys.filter((k) => !carried.includes(k))
    if (missing.length > 0) {
      fail({
        message:
          `${where}: ${flow.decl.name} doesn't say which ${slice.view.name} row it changes. ` +
          `Give it ${missing.join(" and ")}, or set ${missing.length > 1 ? "them" : "it"} in its mapping.`,
        element: flow.decl.name ?? "",
        slice: slice.name ?? "",
      })
    }
  }
}

/** External events are not stored, so a view built from one would be empty after a replay. */
function checkStored({ slice, where }: Located, fail: Fail): void {
  const { view } = slice
  if (!view) return
  for (const { decl } of slice.events)
    if (decl.external)
      fail({
        message: `${where}: ${view.name} is built from ${decl.name}, which is ${decl.external.name}'s and isn't stored. Translate it into an event of ours first, then project that.`,
        element: decl.name ?? "",
        slice: slice.name ?? "",
      })
}

/**
 * Every event a slice handles or produces is in one of its specifications: a command's events are
 * alternatives, and only a specification says when each happens; an automation's trigger, and a
 * state view's events, are in a given. An automation that polls a view has no trigger event. A
 * state view's specifications say what the screen shows.
 */
function checkCovered({ slice, where }: Located, fail: Fail): void {
  if (slice.view && slice.tests.length === 0) {
    fail({
      slice: slice.name ?? "",
      element: slice.view.name ?? "",
      message: `${where}: no specification shows this view yet. Add a .spec whose then has the ${slice.view.name} rows it shows.`,
    })
    return
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
      message: `${where}: no specification shows ${decl.name} yet. Add a .spec whose ${clause} has ${decl.name}(...).`,
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
function checkSpecs({ slice, where }: Located, built: Built, fail: Fail): void {
  const { command, view } = slice
  for (const t of slice.tests) {
    if (t.threw !== undefined) {
      fail({
        message: `${where} › "${t.name}" threw: ${t.threw}`,
        element: "",
        slice: slice.name ?? "",
      })
      continue
    }
    const said = (message: string, element: string) =>
      fail({ message: `${where} › "${t.name}": ${message}`, element, slice: slice.name ?? "" })
    for (const { decl, message } of t.invalid ?? []) said(message, decl.name ?? "")
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
    if (view) {
      const rows = project(view, slice.events, t.given)
      const then = t.then.flatMap((c) => ("decl" in c && c.decl === view ? [c] : []))
      for (const c of then) {
        const matched = rowsLike(rows, view, c.data)
        const built = matched.length === 1 && matched[0] ? valuesOf(matched[0]) : {}
        if (excluded({ ...built, ...c.data }, t.context ?? {}))
          said(
            `then has ${view.name} ${rowName(view, c.data)}, but when excludes it. Remove it from then.`,
            view.name ?? "",
          )
        if (matched.length === 1) compare(c, "then", (f) => matched[0]?.values[f])
        else if (matched.length === 0)
          said(
            `then has ${view.name} ${rowName(view, c.data)}, but given builds no such row.`,
            view.name ?? "",
          )
      }
      // A described outcome claims what the rows leave out.
      for (const row of t.then.some((c) => "description" in c) ? [] : rows) {
        const data = valuesOf(row)
        if (then.some((c) => rowsLike([row], view, c.data).length > 0)) continue
        if (excluded(data, t.context ?? {})) continue
        const unless = t.context ? " and when does not exclude it" : ""
        said(
          `given builds ${view.name} ${rowName(view, data)}, but then leaves it out${unless}. Add it to then.`,
          view.name ?? "",
        )
      }
    } else if (command) {
      checkHandled(slice, t, built, compare, (message, element) =>
        fail({ message: `${where} › "${t.name}": ${message}`, element, slice: slice.name ?? "" }),
      )
    }
  }
}

type Compare = (
  example: ExampleData,
  clause: "when" | "then",
  expected: (field: string) => Expected | undefined,
) => void

/**
 * A handler's specification, step by step: what given holds for the trigger, the polled row and
 * each row a query picks, and what when sends, is what flows into the command and its events. A
 * query picks the rows given builds that its filter selects; with none, an automation issues
 * nothing and a command is refused.
 */
function checkHandled(
  slice: SliceData,
  t: TestData,
  built: Built,
  compare: Compare,
  said: (message: string, element: string) => void,
): void {
  const { command, trigger, polls } = slice
  const when = t.when
  if (!command || !when) return
  // What each declaration before a step holds here, and how a message says so. An outside event the
  // call gets back may hold anything.
  const known = new Map<DeclData, { data: Record<string, unknown>; has: string }>()
  known.set(command.decl, { data: when.data, has: "when sends" })
  const given = t.given.find((g) => g.decl === trigger)
  if (given) known.set(given.decl, { data: given.data, has: `${given.decl.name} in given has` })
  const expected = (flow: Flow, field: string): Expected | undefined => {
    const s = flow.mapping[field] ?? (field in flow.context ? { from: field } : undefined)
    if (s === undefined) return undefined
    if ("value" in s)
      return { value: s.value, says: `${flow.decl.name}'s mapping sets ${show(s.value)}` }
    if ("generate" in s) return undefined
    const from = origin(flow, s)
    const at = from && known.get(from)
    if (!at) return undefined
    const value = at.data[s.from]
    const renamed = s.from === field ? "" : `${s.from} `
    return { value, says: `${at.has} ${renamed}${show(value)}` }
  }
  // Whether when agrees with what flows into the command from `decl`.
  const agrees = (decl: DeclData) =>
    Object.entries(when.data).every(([f, shown]) => {
      const s = command.mapping[f] ?? { from: f }
      const e = "from" in s && origin(command, s) === decl ? expected(command, f) : undefined
      return e?.value === undefined || shown === undefined || isDeepStrictEqual(shown, e.value)
    })
  // A command that copies no key column names no polled row, so there is none to look for.
  const keyed = polls ? polledKey(command, when, polls) : {}
  if (polls && Object.keys(keyed).length > 0) {
    const rows = rowsLike(project(polls, built.get(polls) ?? [], t.given), polls, keyed)
    const picks = `when is for the ${polls.name} row ${rowName(polls, keyed)}`
    if (!rows[0])
      said(`${picks}, but given builds no such row. Add the event that does.`, polls.name ?? "")
    else if (rows.length > 1)
      said(
        `${picks}, but given builds ${rows.length} such rows. Copy every key column into ${command.decl.name}.`,
        polls.name ?? "",
      )
    else
      known.set(polls, { data: valuesOf(rows[0]), has: `the ${polls.name} row given builds has` })
  }
  const before = slice.beforeCommand ?? 0
  for (const [i, q] of slice.reads.entries()) {
    const view = q.decl
    const views = built.get(view)
    // Nothing builds it: assembly says so once, for the model.
    if (!views) continue
    const filter: Record<string, unknown> = {}
    for (const column of Object.keys(q.mapping)) {
      const e = expected(q, column)
      if (e?.value !== undefined) filter[column] = e.value
    }
    const rows = project(view, views, t.given).filter((r) =>
      Object.entries(filter).every(([k, v]) => isDeepStrictEqual(r.values[k]?.value, v)),
    )
    const has = `the ${view.name} row given builds has`
    if (rows.length === 0) {
      const none = `given builds no ${view.name} row with ${show(filter)}`
      if (i < before) {
        said(
          `${none}, so the ${trigger?.external ? "translation" : "automation"} issues no ${command.decl.name}. Add the event that builds it.`,
          view.name ?? "",
        )
        // No command is issued, so the handler reads nothing.
        break
      }
      if (!t.then.some((c) => "message" in c))
        said(
          `${none}, so ${command.decl.name} is refused. Add the event that builds it, or reject.`,
          view.name ?? "",
        )
      continue
    }
    // Of several rows, the command is for one: the one when agrees with.
    const row =
      rows.length === 1
        ? rows[0]
        : rows.find((r) => {
            known.set(view, { data: valuesOf(r), has })
            return agrees(view)
          })
    if (row) known.set(view, { data: valuesOf(row), has })
    else {
      known.delete(view)
      said(
        `when is for none of the ${rows.length} ${view.name} rows with ${show(filter)} that given builds.`,
        view.name ?? "",
      )
      if (i < before) break
    }
  }
  compare(when, "when", (f) => expected(command, f))
  for (const c of t.then) {
    if (!("decl" in c) || c.decl.external) continue
    const flow = slice.events.find((e) => e.decl === c.decl)
    if (flow) compare(c, "then", (f) => expected(flow, f))
  }
}

/** A built row's values, without where each came from. */
function valuesOf(row: { values: Record<string, Expected> }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row.values).map(([k, e]) => [k, e.value]))
}

/** The rows with the key values `data` has; a list's rows share theirs, so with every value it has. */
function rowsLike<R extends { values: Record<string, Expected> }>(
  rows: R[],
  view: DeclData,
  data: Record<string, unknown>,
): R[] {
  const keys = (view.list ? Object.keys(data) : view.keys).filter((k) => data[k] !== undefined)
  return rows.filter((r) => keys.every((k) => isDeepStrictEqual(r.values[k]?.value, data[k])))
}

/** The key columns of the polled row a command was issued for, with what the command copied from them. */
function polledKey(command: Flow, when: ExampleData, view: DeclData): Record<string, unknown> {
  const keyed: Record<string, unknown> = {}
  for (const field of Object.keys(command.decl.fields)) {
    const s = command.mapping[field] ?? { from: field }
    if ("from" in s && origin(command, s) === view && view.keys.includes(s.from))
      keyed[s.from] = when.data[field]
  }
  return keyed
}

/** A row by its keys, or by every value when the view has none or is a list. */
function rowName(view: DeclData, data: Record<string, unknown>): string {
  const keys = view.keys.length > 0 && !view.list ? view.keys : Object.keys(data)
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

/**
 * The rows `given` builds, in order, so the last event to set a column wins; each column says where
 * it came from. Each event into a list adds a row.
 */
function project(
  view: DeclData,
  flows: Flow[],
  given: ExampleData[],
): { values: Record<string, Expected> }[] {
  const rows: ReturnType<typeof project> = []
  for (const g of given) {
    const flow = flows.find((f) => f.decl === g.decl)
    if (!flow) continue
    const has = `${g.decl.name} in given has`
    const values: Record<string, Expected> = {}
    for (const column of Object.keys(view.fields)) {
      const e = source(flow, column, g, has)
      if (e) values[column] = e
    }
    const keys = view.keys.filter((k) => values[k]?.value !== undefined)
    let matched = view.list
      ? []
      : rows.filter((r) =>
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
function checkConnected(
  located: Located[],
  built: Built,
  declared: Declaration[],
  fail: Fail,
): void {
  // The slices that record an event, those that react to it, and those whose specifications
  // assume it happened.
  const recording = new Map<DeclData, Set<Located>>()
  const reacting = new Map<DeclData, Set<Located>>()
  const assuming = new Map<DeclData, Set<Located>>()
  const add = (to: Map<DeclData, Set<Located>>, e: DeclData, at: Located) =>
    to.set(e, (to.get(e) ?? new Set()).add(at))
  const read = new Set<DeclData>()
  for (const at of located) {
    const { slice } = at
    for (const e of recorded(slice)) add(recording, e, at)
    for (const e of heard(slice)) add(reacting, e, at)
    for (const t of slice.tests) for (const g of t.given) add(assuming, g.decl, at)
    // A state view someone sees, or that serves a method, is read there.
    if (slice.view && (slice.actors.length > 0 || slice.service)) read.add(slice.view)
    for (const r of [...slice.reads.map((q) => q.decl), slice.polls]) if (r) read.add(r)
  }
  const consumed = new Set([...reacting.keys(), ...assuming.keys()])
  for (const { slice, where } of located) {
    const about = (d: DeclData, message: string): Warning => ({
      message,
      element: d.name ?? "",
      slice: slice.name ?? "",
    })
    // tsc rejects these too, but the CLI does not run tsc, and without this a
    // view in given would be reported below as an event no slice emits.
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
      if (slice.view) {
        for (const c of t.then) {
          if ("decl" in c && c.decl !== slice.view)
            throw new Error(
              `${where}: ${c.decl.name} in then is not what this view shows. then lists rows of ${slice.view.name}.`,
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
    // An external event we produce is published, and needs no reader of ours. One line per event,
    // at the first slice that records it.
    for (const e of recorded(slice)) {
      const by = [...(recording.get(e) ?? [])]
      if (!e.external && !consumed.has(e) && by[0]?.slice === slice)
        fail(
          about(
            e,
            `${by.map((a) => a.where).join(", ")}: nothing uses ${e.name} yet. Add .automation(d.${e.name}), or .event(d.${e.name}) to a state view, where something reacts to it.`,
          ),
        )
    }
    const { view } = slice
    if (view && !read.has(view))
      fail(
        about(
          view,
          `${where}: nothing reads ${view.name} yet. Add .actor() for who sees it, or .query(d.${view.name}, …) or .automation(d.${view.name}) where it's needed.`,
        ),
      )
    for (const r of [...slice.reads.map((q) => q.decl), slice.polls]) {
      if (r && !built.has(r))
        fail(
          about(
            r,
            `${where}: nothing fills ${r.name} yet. Add a state view, m.slice().view(d.${r.name}).event(d.Event).`,
          ),
        )
    }
  }
  // One line per event, at the slices that react to it, or else at those that assume it, or else
  // on its own: an event of ours no slice records. An external event comes from outside, and only
  // a translation uses it; a given does not.
  const ours = declared.flatMap((d) => (d.kind === "event" && !d.external ? [d] : []))
  for (const e of new Set([...consumed, ...ours])) {
    if (recording.has(e) || (e.external && reacting.has(e))) continue
    const at = [...(reacting.get(e) ?? assuming.get(e) ?? [])]
    const here = at.map((a) => a.where).join(", ")
    fail({
      message: e.external
        ? `${here}: nothing translates ${e.name} yet. Add .translation(d.${e.name}) to make it an event of ours.`
        : at.length > 0
          ? `${here}: nothing emits ${e.name} yet. Add .event(d.${e.name}) to the slice that causes it.`
          : `${e.name}: nothing records it. Add .event(d.${e.name}) to the slice that causes it.`,
      element: e.name ?? "",
      ...(at[0] && { slice: at[0].slice.name ?? "" }),
    })
  }
}

/** Types cannot count duplicates, so this runs at assembly. A slice with no service has no method. */
function checkMethods(located: Located[], conflict: Fail): void {
  const claimed = new Map<string, string>()
  for (const { slice, where } of located) {
    const name = slice.service?.method ?? slice.command?.decl.name
    if (!slice.service || name === undefined) continue
    const method = `${slice.service.service.name}/${name}`
    const first = claimed.get(method)
    if (first === undefined) claimed.set(method, where)
    else
      conflict(
        {
          message: `${where}: ${method} is already used by ${first}. Name this one with .service(d.${slice.service.service.name}, "Name").`,
          element: slice.service.service.name ?? "",
          slice: slice.name ?? "",
        },
        slice,
      )
  }
}
