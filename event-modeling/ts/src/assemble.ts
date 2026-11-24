// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { type Feed, toFeed } from "./spec.ts"
import {
  type ActorData,
  type Assembled,
  type ChapterData,
  type Declaration,
  type DeclData,
  DRAFTS,
  type Exported,
  type ExternalData,
  type Flow,
  heard,
  META,
  type Message,
  Misstep,
  type ModelData,
  resolve as named,
  origin,
  REGISTRY,
  type Registered,
  recorded,
  type SliceData,
  type StreamData,
  slug,
  type TestData,
  taken,
  unique,
  WRITTEN,
  words,
} from "./types.ts"

export type { Assembled, Feed, Message }

export interface Options {
  /** Draw a model with errors instead of failing with them. */
  partial?: boolean
}

/** Records a message, and the slice it is found checking alone; a strict assembly throws the errors at the end. */
type Fail = (message: Message, of?: SliceData) => void

/** Data that is wrong or has no source. */
const error = (m: Omit<Message, "kind">): Message => ({ kind: "error", ...m })
/** A model unfinished, with nothing wrong. */
const warning = (m: Omit<Message, "kind">): Message => ({ kind: "warning", ...m })

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
  const messages: Message[] = []
  const errors = new Map<SliceData, Message[]>()
  const fail: Fail = (message, of) => {
    messages.push(message)
    if (of && message.kind === "error") errors.set(of, [...(errors.get(of) ?? []), message])
  }
  // Two things claiming one name, chapter or method: a partial assembly keeps the first and draws on.
  const conflict: Fail = options.partial
    ? fail
    : (message) => {
        throw new Error(message.message)
      }
  const { model, streams, chapters, externals, declared, clashed } = nameDeclarations(
    modules,
    [...REGISTRY],
    dir,
    fail,
    conflict,
  )
  make()
  const written = [...DRAFTS]
  for (const s of written) s.tests = s.tests.map(run)
  identify(written)
  const drafts = runBy(firstSystem(declared), oneSlicePerView(written, fail))
  const unchaptered: SliceData[] = []
  for (const s of drafts) {
    const name = chapterOf(s, conflict)
    const chapter = chapters.find((c) => c.name === name)
    if (chapter) chapter.slices.push(s)
    else unchaptered.push(s)
  }
  check(chapters, unchaptered, dir, fail, conflict)
  for (const { name } of chapters.filter((c) => c.slices.length === 0))
    fail(
      warning({
        message: `${name}: no slices. Add .chapter(d.${name}) to one.`,
        ui: `${words(name)}: empty`,
        element: "",
      }),
    )
  const loose = looseOf(drafts, declared)
  const story = storyOf(chapters, unchaptered, loose, declared)
  for (const [name, members] of streams)
    if (members.length === 0)
      fail(
        warning({
          message: `${name}: no events. Add .stream(d.${name}) to one.`,
          ui: `${words(name)}: empty`,
          element: name,
        }),
      )
  // Otherwise it is drawn in the first stream's lane, which says something nobody wrote.
  const members = new Set([...streams.values()].flat())
  for (const d of streams.size > 0 ? declared : [])
    if (d.kind === "event" && !d.external && !members.has(d) && !clashed.has(d))
      fail(
        warning({
          message: `${d.name}: no stream. Add .stream() where it's declared, with the stream it belongs to.`,
          ui: `${words(d.name ?? "")}: no stream`,
          element: d.name ?? "",
        }),
      )
  // Every error at once, so one run shows all there is to fix.
  const wrong = messages.filter((m) => m.kind === "error")
  if (!options.partial && wrong.length > 0) throw new Error(wrong.map((m) => m.message).join("\n"))
  return { model, streams, chapters, externals, loose, unchaptered, story, messages, errors }
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
    const failed: Misstep[] = []
    for (const [method, args] of calls) {
      try {
        const call = step[method]
        if (!call) throw new Misstep("", "", `no such step .${method}().`, `unknown step ${method}`)
        step = call(...args)
      } catch (error) {
        failed.push(
          error instanceof Misstep
            ? error
            : new Misstep(
                "",
                "",
                String(error instanceof Error ? error.message : error),
                "a step failed",
              ),
        )
      }
    }
    if (failed.length > 0) (step as unknown as { [META]: SliceData })[META].failed = failed
  }
}

/** A specification written as a function runs now; what it throws is an error. */
function run(test: TestData): TestData {
  try {
    return test.later?.() ?? test
  } catch (error) {
    const threw = error instanceof Error ? error.message : String(error)
    return { name: test.name, given: [], then: [], threw }
  }
}

/**
 * Gives each slice its id: its heading as a slug, numbered from the second slice with that heading.
 * A later `m.slice().view()` of a view is part of the first's slice, so it takes none.
 */
function identify(drafts: SliceData[]): void {
  const taken = new Set<string>()
  const views = new Set<DeclData>()
  for (const s of drafts) {
    if (s.view && views.has(s.view)) continue
    if (s.view) views.add(s.view)
    s.id = unique(slug(heading(s) ?? "slice"), taken)
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
    for (const later of all.slice(1)) for (const m of drawnElsewhere(s, later)) fail(m, merged)
    return [merged]
  })
}

/** What a later `.view()` of the first's view says differently about drawing it. */
function drawnElsewhere(first: SliceData, later: SliceData): Message[] {
  const rm = first.view?.name ?? ""
  const chapter = (s: SliceData) => s.chapters.map((c) => c.name).join(" and ") || undefined
  const actors = (s: SliceData) => s.actors.map((a) => a.name).join(" and ") || undefined
  const method = (s: SliceData) => s.service && `${s.service.service.name}/${s.service.method}`
  const context = (s: SliceData) => (s.context ? Object.keys(s.context).join(", ") : undefined)
  const quoted = (text: string | undefined) => (text === undefined ? undefined : show(text))
  const notes = (s: SliceData) => s.notes?.map((n) => show(n.text)).join(" and ")
  const differs: [string | undefined, string | undefined, string, string][] = [
    [chapter(later), chapter(first), "chapter", "chapter"],
    [quoted(later.name), quoted(first.name ?? rm), "name", "the name"],
    [actors(later), actors(first), "actor", "actor"],
    [later.screen?.name, first.screen?.name, "screen", "screen"],
    [method(later), method(first), "method", "method"],
    [context(later), context(first), "context", "context"],
    [notes(later), notes(first), "note", "the note"],
  ]
  return differs.flatMap(([said, kept, what, says]) =>
    said === undefined || said === kept
      ? []
      : [
          error({
            message: `${rm}: a later .view() says ${says} ${said}; the first says ${kept === undefined ? `no ${what}` : `${says} ${kept}`}. Remove it, or move the first.`,
            ui: `${words(rm)}: its slices disagree on its ${what}`,
            element: rm,
            slice: first.id ?? "",
          }),
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
 * the order of their numbers, a chapter with none being 0, and chapters of one number in the order
 * declared. An event is in one lane, so not in both.
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
  /** The events whose stream's name another declaration took: declared twice says so. */
  clashed: Set<DeclData>
} {
  const model = modules.map(modelOf).find((found) => found !== undefined)
  if (!model) throw new Error('No model: add `export default m.model("Name")` to one file.')
  const lanes: StreamData[] = []
  const headings: ChapterData[] = []
  const externals: string[] = []
  const declared: Declaration[] = []
  for (const [name, { data, where, also }] of registered) {
    for (const { where: again } of also)
      conflict(
        error({
          message: `${name}: declared twice, at ${at(where, dir)} and ${at(again, dir)}. Keep one.`,
          ui: `${words(name)}: declared twice`,
          element: name,
        }),
      )
    if (data.kind === "stream") lanes.push(data)
    else if (data.kind === "chapter") headings.push(data)
    else if (data.kind === "external") externals.push(name)
    else if (data.kind !== "model") declared.push(data)
  }
  const streams = new Map<string, DeclData[]>(
    lanes.sort((a, b) => a.order - b.order).map((l) => [l.name ?? "", []]),
  )
  // An event's lane is named where it is declared, and found once every module has run.
  const lane = <D>(e: DeclData, ref: object, as: string): D | undefined => {
    try {
      return named(ref, as) as D
    } catch (thrown) {
      if (!(thrown instanceof Misstep)) throw thrown
      // What names nothing is the lane's; what is not a declaration, the event's.
      const lead = thrown.lead === "" ? (e.name ?? "") : thrown.lead
      fail(
        error({
          message: `${lead}: ${thrown.rest}`,
          ui: `${words(thrown.element || (e.name ?? ""))}: ${thrown.problem}`,
          element: thrown.element,
        }),
      )
      return undefined
    }
  }
  const clashed = new Set<DeclData>()
  for (const e of declared) {
    if (e.kind !== "event") continue
    const system = e.system && lane<ExternalData>(e, e.system, "m.external")
    if (system) e.external = system
    const stream = e.stream && lane<StreamData>(e, e.stream, "m.stream")
    if (!stream) continue
    if (stream.kind !== "stream") clashed.add(e)
    else if (system)
      conflict(
        error({
          message: `${e.name}: in stream ${stream.name} and system ${system.name}. Keep one: .stream() for ours, .external() for theirs.`,
          ui: `${words(e.name ?? "")}: in a stream and an External System`,
          element: e.name ?? "",
        }),
      )
    else streams.get(stream.name ?? "")?.push(e)
  }
  const chapters: Assembled["chapters"] = []
  // Removing a chapter's number keeps it ahead of the numbered ones instead of sending it last.
  const place = ({ number }: ChapterData) => number ?? 0
  for (const { name = "", notes } of headings.sort(
    (a, b) => place(a) - place(b) || a.order - b.order,
  ))
    chapters.push({ name, ...(notes !== undefined && { notes }), slices: [] })
  return { model, streams, chapters, externals, declared, clashed }
}

/** The name of the chapter a slice joined, if it joined one; of several, the first. */
function chapterOf(slice: SliceData, conflict: Fail): string | undefined {
  const all = [...new Set(slice.chapters.map((c) => c.name))]
  const names = all.filter((n) => n !== undefined)
  const where = heading(slice) ?? "A slice"
  if (names.length > 1)
    conflict(
      error({
        message: `${where}: joins ${names.join(" and ")}. Keep one .chapter().`,
        ui: `${words(where)}: in two chapters`,
        element: "",
        slice: slice.id ?? "",
      }),
      slice,
    )
  return names[0]
}

/**
 * Declarations no slice draws, in the order declared. An event is drawn by the slice that records
 * it, or translates it from outside; anything else by a slice that names it.
 */
function looseOf(slices: SliceData[], declared: Declaration[]): Declaration[] {
  const drawn = new Set<object>()
  for (const slice of slices) {
    for (const [kind, d] of used(slice)) if (kind !== "event") drawn.add(d)
    for (const e of recorded(slice)) drawn.add(e)
    if (slice.trigger?.external) drawn.add(slice.trigger)
  }
  return declared.filter((d) => !drawn.has(d))
}

/**
 * Every column, in story order. Chapters, in order, hold their slices in the order written. What is
 * in no chapter sits where it is declared, after the chapter of the slice declared before it: a
 * declaration in no slice, or a slice, by the first of its own elements, its view, its command or an
 * event it records, not what starts it or what it reads, which other slices place.
 */
function storyOf(
  chapters: Assembled["chapters"],
  unchaptered: SliceData[],
  loose: Declaration[],
  declared: Declaration[],
): Assembled["story"] {
  const at = (d: Declaration | undefined) => (d ? declared.indexOf(d) : -1)
  const first = (slice: SliceData) =>
    Math.min(...[slice.view, slice.command?.decl, ...recorded(slice)].map(at).filter((i) => i >= 0))
  const columns = [
    ...chapters.flatMap((c, rank) =>
      c.slices.map((column, written) => ({ column, rank, written, at: first(column) })),
    ),
    ...unchaptered.map((column) => ({ column, rank: undefined, written: 0, at: first(column) })),
    ...loose.flatMap((column) =>
      column.kind === "event" || column.kind === "command" || column.kind === "view"
        ? [{ column, rank: undefined, written: 0, at: at(column) }]
        : [],
    ),
  ].sort((a, b) => a.at - b.at)
  let follows = -1
  const placed = columns.map(({ column, rank, written }, i) => {
    if (rank !== undefined) follows = rank
    return rank === undefined
      ? { column, chapter: follows, after: 1, order: i }
      : { column, chapter: rank, after: 0, order: written }
  })
  placed.sort((a, b) => a.chapter - b.chapter || a.after - b.after || a.order - b.order)
  return placed.map((p) => p.column)
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
  external: "an External System",
}

interface Located {
  slice: SliceData
  where: string
  /** Where the slice is written, as `notes.ts:12`, from the model's directory. */
  line?: string
}

/** What a terminal line about `name`, found in a slice, leads with: `Name (where)`, or else, for the slice's own heading, `where`. */
const lead = (name: string | undefined, { slice, where }: Located) =>
  name === slice.name ? where : `${name} (${where})`

/** What a viewer line about the slice itself leads with: its heading as words. */
const titled = ({ slice, where }: Located) => words(slice.name ?? where)

function check(
  chapters: Assembled["chapters"],
  unchaptered: SliceData[],
  dir: string,
  fail: Fail,
  conflict: Fail,
): void {
  const located = [
    ...chapters.flatMap((chapter) => locate(chapter.name, chapter.slices, dir)),
    ...locate(undefined, unchaptered, dir),
  ]
  const built = builtOf(located)
  for (const at of located) {
    const own: Fail = (message) => fail(message, at.slice)
    checkFailed(at, own)
    checkCore(at, own)
    checkThrown(at, own)
    checkFilled(at, own)
    checkRecorded(at, own)
    checkKeys(at, own)
    checkStored(at, own)
    checkCovered(at, own)
    checkSeen(at, own)
    checkSpecs(at, own)
    checkGenerated(at, own)
  }
  checkFilledSomewhere(located, fail)
  checkConnected(located, built, fail)
  checkMethods(located, conflict)
}

/** What a slice still being written lacks: the compiler allows it, so the slice is drawn as far as it goes. */
function checkCore(at: Located, fail: Fail): void {
  const { slice, where } = at
  const { command, trigger, polls, view, events } = slice
  const from = trigger ?? polls
  const unfinished = (problem: string, fix: string) =>
    fail(
      warning({
        message: `${where}: ${problem}. ${fix}`,
        ui: `${titled(at)}: ${problem}`,
        element: "",
        slice: slice.id ?? "",
      }),
    )
  if (!command && !from && !view)
    unfinished("empty", "Start it with .command(), .view(), .automation() or .translation().")
  else if (from && !command)
    unfinished(
      "no command",
      `Add .command() after .${from.external ? "translation" : "automation"}(d.${from.name}).`,
    )
  else if (events.length === 0)
    unfinished(
      "no event",
      `Add .event() after ${command ? `.command(d.${command.decl.name})` : `.view(d.${view?.name})`}.`,
    )
  // The compiler refuses it too; without a name, proto would write an rpc with none.
  if (view && slice.service && slice.service.method === undefined)
    fail(
      error({
        message: `${lead(view.name, at)}: method has no name. Write .service(d.${slice.service.service.name}, "List${view.name}").`,
        ui: `${words(view.name ?? "")}: method has no name`,
        element: view.name ?? "",
        slice: slice.id ?? "",
      }),
    )
}

/** A call that threw is drawn as no call, and what it threw is an error. */
function checkFailed(at: Located, fail: Fail): void {
  const { slice, where } = at
  for (const { element, lead, rest, problem } of slice.failed ?? [])
    fail(
      error({
        message: lead === "" ? `${where}: ${rest}` : `${lead} (${where}): ${rest}`,
        ui: `${element === "" ? titled(at) : words(element)}: ${problem}`,
        element,
        slice: slice.id ?? "",
      }),
    )
}

/**
 * A mapping that threw is drawn as no mapping, and what it threw is an error. `m.generate()` given
 * what is not a field says so itself.
 */
function checkThrown(at: Located, fail: Fail): void {
  for (const { decl, threw } of [...flows(at.slice), ...at.slice.reads]) {
    if (threw === undefined) continue
    const generated = threw.startsWith("m.generate()")
    fail(
      error({
        message: `${lead(decl.name, at)}: ${generated ? "" : "mapping threw: "}${threw}`,
        ui: `${words(decl.name ?? "")}: ${generated ? "generated from something that isn't a field" : "mapping failed"}`,
        element: decl.name ?? "",
        slice: at.slice.id ?? "",
      }),
    )
  }
}

/** `chapter` is undefined for the slices in none. */
function locate(chapter: string | undefined, slices: SliceData[], dir: string): Located[] {
  return slices.map((slice, i) => {
    const named = heading(slice)
    if (named !== undefined) slice.name = named
    const name = slice.name ?? `slice ${i + 1}`
    return {
      slice,
      where: chapter === undefined ? name : `${chapter} › ${name}`,
      ...(slice.site && { line: at(slice.site, dir) }),
    }
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

/** Everything a slice's steps name, with the word an error uses for it. */
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
  return out
}

/** The command and events a slice maps. */
const flows = (slice: SliceData): Flow[] => [
  ...(slice.command ? [slice.command] : []),
  ...slice.events,
]

/**
 * A mapping copies a field, sets a constant or says what a value is made from. One that computes a
 * value is drawn as generated and is an error: what it computes is the handler's, not the model's. An
 * automation's command makes nothing: it is filled from what is before it.
 */
function checkGenerated({ slice, where }: Located, fail: Fail): void {
  const from = slice.trigger ?? slice.polls
  for (const { decl, mapping } of flows(slice)) {
    const name = decl.name ?? ""
    for (const [field, s] of Object.entries(mapping)) {
      const target = `${name}.${field} (${where})`
      if ("built" in s)
        fail(
          error({
            message: `${target}: computed in the mapping. Set it to a source field, a t.literal(), or m.generate() with what it is made from.`,
            ui: `${words(name)}: ${field} is computed`,
            element: name,
            slice: slice.id ?? "",
          }),
        )
      else if (from && decl === slice.command?.decl && "generate" in s)
        fail(
          error({
            message: `${target}: an automation can't generate it. Add ${field} to ${from.name} or a view it queries, or generate it in an event ${name} records.`,
            ui: `${words(name)}: ${field} has no source`,
            element: name,
            slice: slice.id ?? "",
          }),
        )
    }
  }
}

/**
 * The fields a flow fills: those that copy by name from before its step, and those its mapping sets.
 * What a mapping that threw sets is unknown, so it is taken to set them all, and only the throw is an error.
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

/** Every field has a source. An optional field may go unfilled here, if another slice fills it. */
function checkFilled({ slice, where }: Located, fail: Fail): void {
  const check = (target: DeclData, sources: string[], fix: (field: string) => string) => {
    const name = target.name ?? ""
    for (const field of Object.keys(target.fields)) {
      if (!sources.includes(field))
        fail(
          error({
            message: `${name}.${field} (${where}): no source. ${fix(field)}`,
            ui: `${words(name)}: ${field} has no source`,
            element: name,
            slice: slice.id ?? "",
            fields: [field],
          }),
        )
    }
  }
  const { command, view } = slice
  if (command && (slice.trigger || slice.polls))
    check(
      command.decl,
      [...filled(command), ...optional(command.decl)],
      (f) => `Add ${f} to a step before .command(), or set it in the mapping.`,
    )
  // An external event's fields come from outside, and an event of ours can keep them.
  if (command)
    for (const flow of slice.events.filter((f) => !f.decl.external))
      check(
        flow.decl,
        [...filled(flow), ...optional(flow.decl)],
        (f) => `Add ${f} to a step before .event(), or set it in the mapping.`,
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
function checkRecorded({ slice, where, line }: Located, fail: Fail): void {
  const { command, events } = slice
  if (!command || events.length === 0) return
  const all = Object.keys(command.decl.fields)
  const recorded = events.flatMap((e) => taken(e, command.decl))
  // A query after the command filters by its fields, which uses them.
  for (const read of slice.reads.slice(slice.beforeCommand))
    for (const s of Object.values(read.mapping))
      if ("from" in s && origin(read, s) === command.decl) recorded.push(s.from)
  const name = command.decl.name ?? ""
  const names = (external: boolean) =>
    events.flatMap((e) => (Boolean(e.decl.external) === external ? [e.decl.name] : [])).join(" or ")
  const [ours, calls] = [names(false), names(true)]
  // A call's external event is the whole exchange. Without one, a field to keep out of our events
  // goes to a system that keeps it.
  const fix = calls
    ? `An external event is what its call sends and gets back: add it to ${calls}. Or ${ours ? `record it in ${ours}, or ` : ""}remove it.`
    : `Record it in ${ours}, send it in an external event of a system that keeps it, such as a keystore, or remove it.`
  for (const field of all.filter((f) => !recorded.includes(f)))
    fail(
      error({
        message: `${line ? `${line}  ${name}.${field}` : `${name}.${field} (${where})`}: reaches no event. ${fix}`,
        ui: `${words(name)}: ${field} is never recorded`,
        element: name,
        slice: slice.id ?? "",
        fields: [field],
      }),
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
    const { command } = slice
    if (!command) continue
    const automated = slice.trigger || slice.polls
    add(command.decl, automated ? filled(command) : Object.keys(command.decl.fields))
    for (const flow of slice.events)
      add(flow.decl, flow.decl.external ? optional(flow.decl) : filled(flow))
  }
  for (const [decl, fields] of fills) {
    const name = decl.name ?? ""
    const to = decl.kind === "command" ? "what issues" : "a command that records"
    for (const field of optional(decl).filter((f) => !fields.has(f)))
      fail(
        error({
          message: `${name}.${field}: no slice fills it. Add ${field} to ${to} ${name}, or set it in a mapping.`,
          ui: `${words(name)}: ${field} has no source`,
          element: name,
        }),
      )
  }
}

/** An event finds its row by the key columns it carries, so it carries every one. A list's adds a row. */
function checkKeys(at: Located, fail: Fail): void {
  const { view } = at.slice
  if (!view || view.list || view.keys.length === 0) return
  for (const flow of at.slice.events) {
    const carried = filled(flow)
    const missing = view.keys.filter((k) => !carried.includes(k))
    const name = flow.decl.name ?? ""
    if (missing.length > 0)
      fail(
        error({
          message:
            `${lead(name, at)}: doesn't say which ${view.name} row. ` +
            `Give it ${missing.join(" and ")}, or set ${missing.length > 1 ? "them" : "it"} in its mapping.`,
          ui: `${words(name)}: missing the ${words(view.name ?? "")} key`,
          element: name,
          slice: at.slice.id ?? "",
        }),
      )
  }
}

/** External events are not stored, so a view built from one would be empty after a replay. */
function checkStored(at: Located, fail: Fail): void {
  const { view } = at.slice
  if (!view) return
  for (const { decl } of at.slice.events)
    if (decl.external)
      fail(
        error({
          message: `${lead(decl.name, at)}: ${decl.external.name}'s, not stored, so it can't build ${view.name}. Translate it into an event of ours, then project that.`,
          ui: `${words(decl.name ?? "")}: not stored`,
          element: decl.name ?? "",
          slice: at.slice.id ?? "",
        }),
      )
}

/**
 * Every event a slice handles or produces is in one of its specifications: a command's events are
 * alternatives, and only a specification says when each happens; an automation's trigger, and a
 * state view's events, are in a given. An automation that polls a view has no trigger event. A
 * state view's specifications say what the screen shows.
 */
function checkCovered(at: Located, fail: Fail): void {
  const { slice } = at
  const unshown = (decl: DeclData, clause: "given" | "then") =>
    fail(
      warning({
        message: `${lead(decl.name, at)}: missing specification. Add a .spec whose ${clause} has ${decl.name}(…).`,
        ui: `${words(decl.name ?? "")}: missing specification`,
        element: decl.name ?? "",
        slice: slice.id ?? "",
      }),
    )
  if (slice.view && slice.tests.length === 0) {
    unshown(slice.view, "then")
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
  for (const [decl, clause] of missing) unshown(decl, clause)
}

/**
 * A specification illustrates behavior, so assembly does not work out its then from its given:
 * the specification runs, and each value it shows fits its field.
 */
function checkSpecs({ slice, where }: Located, fail: Fail): void {
  for (const t of slice.tests) {
    if (t.threw !== undefined)
      fail(
        error({
          message: `"${t.name}" (${where}): threw: ${t.threw}`,
          ui: `"${t.name}": didn't run`,
          element: "",
          slice: slice.id ?? "",
        }),
      )
    for (const { decl, path, message } of t.invalid ?? []) {
      const name = decl.name ?? ""
      fail(
        error({
          message: `${path === "" ? name : `${name}.${path}`} in "${t.name}" (${where}): ${message}`,
          ui: `${words(name)}: ${path} isn't valid in "${t.name}"`,
          element: name,
          slice: slice.id ?? "",
        }),
      )
    }
  }
}

function show(value: unknown): string {
  return JSON.stringify(value)
}

/** A screen is drawn in its actors' lanes. */
function checkSeen(at: Located, fail: Fail): void {
  const { screen, actors, id } = at.slice
  if (screen && actors.length === 0)
    fail(
      warning({
        message: `${lead(screen.name, at)}: no one sees it. Add .actor() for who does.`,
        ui: `${words(screen.name ?? "")}: no one sees it`,
        element: screen.name ?? "",
        slice: id ?? "",
      }),
    )
}

/** Anything produced and never used, or used and never produced. */
function checkConnected(located: Located[], built: Built, fail: Fail): void {
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
  /** `name (where, …)`. */
  const found = (name: string, at: Located[]) => `${name} (${at.map((a) => a.where).join(", ")})`
  for (const at of located) {
    const { slice, where } = at
    // tsc rejects these too, but the CLI does not run tsc, and without this a
    // view in given would be reported below as an event no slice emits.
    const misplaced = (decl: DeclData, clause: string, why: string) =>
      new Error(`${decl.name} (${where}): in ${clause}, but ${why}`)
    for (const t of slice.tests) {
      for (const g of t.given) {
        if (g.decl.kind !== "event")
          throw misplaced(
            g.decl,
            "given",
            `is ${KIND_LABEL[g.decl.kind]}. given lists events that already happened.`,
          )
      }
      if (t.when && t.when.decl.kind !== "command")
        throw misplaced(
          t.when.decl,
          "when",
          `is ${KIND_LABEL[t.when.decl.kind]}. when is this slice's command.`,
        )
      if (slice.view) {
        for (const c of t.then) {
          if ("decl" in c && c.decl !== slice.view)
            throw misplaced(
              c.decl,
              "then",
              `is not what this view shows. then lists rows of ${slice.view.name}.`,
            )
        }
      }
      if (slice.command) {
        for (const c of t.then) {
          if ("decl" in c && c.decl.kind !== "event")
            throw misplaced(
              c.decl,
              "then",
              `is ${KIND_LABEL[c.decl.kind]}. then lists the events that result; reject says why the command is refused.`,
            )
        }
      }
    }
    const unused = (d: DeclData, message: string) =>
      fail(
        warning({
          message,
          ui: `${words(d.name ?? "")}: unused`,
          element: d.name ?? "",
          slice: slice.id ?? "",
        }),
      )
    // An external event we produce is published, and needs no reader of ours. One line per event,
    // at the first slice that records it.
    for (const e of recorded(slice)) {
      const by = [...(recording.get(e) ?? [])]
      if (!e.external && !consumed.has(e) && by[0]?.slice === slice)
        unused(
          e,
          `${found(e.name ?? "", by)}: unused. Add .automation(d.${e.name}), or .event(d.${e.name}) to a state view.`,
        )
    }
    const { view } = slice
    if (view && !read.has(view))
      unused(
        view,
        `${lead(view.name, at)}: unused. Add .actor(), .query(d.${view.name}, …) or .automation(d.${view.name}).`,
      )
    for (const r of [...slice.reads.map((q) => q.decl), slice.polls]) {
      if (r && !built.has(r))
        fail(
          error({
            message: `${lead(r.name, at)}: nothing builds it. Add a state view: m.slice().view(d.${r.name}).event(d.Event).`,
            ui: `${words(r.name ?? "")}: nothing builds it`,
            element: r.name ?? "",
            slice: slice.id ?? "",
          }),
        )
    }
  }
  // One line per event something reads, at the slices that react to it, or else at those that
  // assume it. Data something reads and nothing records has no source, an error; an event nothing
  // reads is storming. An external event comes from outside, and only a translation uses it; a
  // given does not, so one nothing translates is unfinished.
  for (const e of consumed) {
    if (recording.has(e) || (e.external && reacting.has(e))) continue
    const at = [...(reacting.get(e) ?? assuming.get(e) ?? [])]
    const name = e.name ?? ""
    const slice = at[0]?.slice.id ?? ""
    fail(
      e.external
        ? warning({
            message: `${found(name, at)}: nothing translates it. Add .translation(d.${name}).`,
            ui: `${words(name)}: nothing translates it`,
            element: name,
            slice,
          })
        : error({
            message: `${found(name, at)}: nothing records it. Add .event(d.${name}) to the slice that causes it.`,
            ui: `${words(name)}: nothing records it`,
            element: name,
            slice,
          }),
    )
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
    const service = slice.service.service.name ?? ""
    if (first === undefined) claimed.set(method, where)
    else
      conflict(
        error({
          message: `${method} (${where}): already used by ${first}. Name this one with .service(d.${service}, "Name").`,
          ui: `${words(service)}: ${words(name)} used twice`,
          element: service,
          slice: slice.id ?? "",
        }),
        slice,
      )
  }
}
