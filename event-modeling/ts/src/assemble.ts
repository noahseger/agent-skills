// Turns a model directory into a named, checked model.
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
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
  type Flow,
  heard,
  META,
  type ModelData,
  origin,
  recorded,
  type SliceData,
  type StreamData,
  type TestData,
  taken,
  type Warning,
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
  const written = [...DRAFTS]
  DRAFTS.clear()
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
  const { model, streams, chapters, externals, declared, fileOf } = nameExports(
    modules,
    files,
    conflict,
  )
  const drafts = runBy(firstSystem(declared), oneSlicePerView(written, fail))
  const unchaptered: SliceData[] = []
  for (const s of drafts) {
    const name = chapterOf(s, conflict)
    const chapter = chapters.find((c) => c.name === name)
    if (chapter) chapter.slices.push(s)
    else unchaptered.push(s)
  }
  check(chapters, unchaptered, declared, fileOf, fail, conflict)
  for (const s of unchaptered) {
    const name = s.name ?? "A slice"
    fail({ message: `${name} isn't in a chapter yet.`, element: "", slice: s.name ?? "" }, s)
  }
  for (const c of chapters)
    if (c.slices.length === 0) fail({ message: `${c.name} has no slices yet.`, element: "" })
  const loose = looseOf(drafts, streams, declared)
  for (const d of loose) fail({ message: `${d.name} isn't in a slice yet.`, element: d.name ?? "" })
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
      named: all.flatMap((c) => c.named),
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
  const request = (s: SliceData) => (s.request ? Object.keys(s.request).join(", ") : undefined)
  const quoted = (text: string | undefined) => (text === undefined ? undefined : show(text))
  const differs: [string | undefined, string | undefined, string, string, string][] = [
    [chapter(later), chapter(first), "names chapter", "drawn in", "drawn in no chapter"],
    [quoted(later.name), quoted(first.name ?? rm), "names the slice", "drawn as", ""],
    [actors(later), actors(first), "names actor", "seen by", "seen by no one"],
    [later.screen?.name, first.screen?.name, "names screen", "shown on", "shown on no screen"],
    [method(later), method(first), "names method", "served by", "served by no method"],
    [request(later), request(first), "asks with", "asked with", "asked with nothing"],
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
  conflict: Fail,
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
        conflict({
          message: `${data.name} is exported twice, also as ${key}. Keep one.`,
          element: data.name,
        })
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
      if (e.external) {
        conflict({
          message: `${e.name} is in the ${key} stream and the ${e.external.name} system. Keep one: .stream() for ours, .external() for theirs.`,
          element: e.name ?? "",
        })
        streams.set(
          key,
          members.filter((d) => d !== e),
        )
      }
  const chapters: Assembled["chapters"] = []
  for (const { name = "", note } of headings.sort((a, b) => a.order - b.order)) {
    const merged = chapters.find((c) => c.name === name)
    if (!merged) chapters.push({ name, ...(note !== undefined && { note }), slices: [] })
    else if (merged.note === undefined && note !== undefined) merged.note = note
  }
  return { model, streams, chapters, externals, declared, fileOf }
}

/** The name of the chapter a slice joined, if it joined one; of several, the first. */
function chapterOf(slice: SliceData, conflict: Fail): string | undefined {
  const all = [...new Set(slice.chapters.map((c) => c.name))]
  const names = all.filter((n) => n !== undefined)
  const where = heading(slice) ?? "A slice"
  const about = (message: string) =>
    conflict({ message: `${where}: ${message}`, element: "", slice: where }, slice)
  if (names.length < all.length)
    about("this slice joins a chapter that isn't exported. Export it to give it a name.")
  if (names.length > 1) about(`this slice joins ${names.join(" and ")}. Keep one .chapter().`)
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
  fileOf: Map<object, string>,
  fail: Fail,
  conflict: Fail,
): void {
  const located = [
    ...chapters.flatMap((chapter) => locate(chapter.name, chapter.slices)),
    ...locate(undefined, unchaptered),
  ]
  checkDeclaredOnce(located, declared, fileOf, conflict)
  const built = builtOf(located)
  for (const at of located) {
    const own: Fail = (warning) => fail(warning, at.slice)
    checkCore(at, own)
    checkNamed(at, own)
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
  checkConnected(located, built, fail)
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
      `no command yet. Add .command() after .${from.external ? "translation" : "automation"}({ ${from.name} }).`,
    )
  else if (events.length === 0)
    said(
      `no event yet. Add .event() after ${command ? `.command({ ${command.decl.name} })` : `.view({ ${view?.name} })`}.`,
    )
  // The compiler refuses it too; without a name, proto would write an rpc with none.
  if (view && slice.service && slice.service.method === undefined)
    said(
      `a state view names its method: .service(${slice.service.service.name}, "List${view.name}").`,
    )
}

/** Each call names its declaration by the key of `{ Name }`, which must be the name it is exported as. */
function checkNamed({ slice, where }: Located, fail: Fail): void {
  for (const [key, decl] of slice.named)
    if (decl.name !== undefined && key !== decl.name)
      fail({
        message:
          key === undefined
            ? `${where}: pass ${decl.name} as { ${decl.name} }, so the compiler knows its name.`
            : `${where}: { ${key}: ${decl.name} } renames ${decl.name}. Write { ${decl.name} }: a mapping reads it as c.${decl.name}.`,
        element: decl.name,
        slice: slice.name ?? "",
      })
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
    slice.view?.name ??
    slice.polls?.name ??
    slice.trigger?.name
  )
}

/** Two modules can export one name, except for a lane, which they share. */
function checkDeclaredOnce(
  located: Located[],
  declared: Declaration[],
  fileOf: Map<object, string>,
  conflict: Fail,
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
    if (first === undefined) byName.set(d.name, d)
    else if (first !== d) {
      const [a, b] = [fileOf.get(first), fileOf.get(d)]
      conflict({
        message:
          a && b && a !== b
            ? `${d.name} is declared in both ${a} and ${b}. Keep one and import it in the other.`
            : `${d.name} is declared twice. Keep one and use it in both places.`,
        element: d.name,
      })
    }
  }
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
          message: `${where}: ${target} is computed in the mapping. Set it to a source field, a z.literal() or m.generate() with what it is made from.`,
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

/** An event finds its row by the key columns it carries, so it carries every one. */
function checkKeys({ slice, where }: Located, fail: Fail): void {
  if (!slice.view || slice.view.keys.length === 0) return
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
      message: `${where}: no specification shows this view yet. Add a .test whose then has the ${slice.view.name} rows it shows.`,
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
function checkSpecs({ slice, where }: Located, built: Built, fail: Fail): void {
  const { command, view } = slice
  for (const t of slice.tests) {
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
        if (excluded({ ...built, ...c.data }, t.request ?? {}))
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
      for (const row of rows) {
        const data = valuesOf(row)
        if (then.some((c) => rowsLike([row], view, c.data).length > 0)) continue
        if (excluded(data, t.request ?? {})) continue
        const unless = t.request ? " and when does not exclude it" : ""
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
      if (!t.then.some((c) => !("decl" in c)))
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

/** The rows with the key values `data` has. */
function rowsLike<R extends { values: Record<string, Expected> }>(
  rows: R[],
  view: DeclData,
  data: Record<string, unknown>,
): R[] {
  const keys = view.keys.filter((k) => data[k] !== undefined)
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

/** A row by its keys, or by every value when the view has none. */
function rowName(view: DeclData, data: Record<string, unknown>): string {
  const keys = view.keys.length > 0 ? view.keys : Object.keys(data)
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
            `${by.map((a) => a.where).join(", ")}: nothing uses ${e.name} yet. Add .automation({ ${e.name} }), or .event({ ${e.name} }) to a state view, where something reacts to it.`,
          ),
        )
    }
    const { view } = slice
    if (view && !read.has(view))
      fail(
        about(
          view,
          `${where}: nothing reads ${view.name} yet. Add .actor() for who sees it, or .query({ ${view.name} }, …) or .automation({ ${view.name} }) where it's needed.`,
        ),
      )
    for (const r of [...slice.reads.map((q) => q.decl), slice.polls]) {
      if (r && !built.has(r))
        fail(
          about(
            r,
            `${where}: nothing fills ${r.name} yet. Add a state view, m.slice().view({ ${r.name} }).event({ Event }).`,
          ),
        )
    }
  }
  // One line per event, at the slices that react to it, or else at those that assume it.
  // An external event comes from outside, and only a translation uses it; a given does not.
  for (const e of consumed) {
    if (recording.has(e) || (e.external && reacting.has(e))) continue
    const at = [...(reacting.get(e) ?? assuming.get(e) ?? [])]
    const here = at.map((a) => a.where).join(", ")
    fail({
      message: e.external
        ? `${here}: nothing translates ${e.name} yet. Add .translation({ ${e.name} }) to make it an event of ours.`
        : `${here}: nothing emits ${e.name} yet. Add .event({ ${e.name} }) to the slice that causes it.`,
      element: e.name ?? "",
      slice: at[0]?.slice.name ?? "",
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
          message: `${where}: ${method} is already used by ${first}. Name this one with .service(Service, "Name").`,
          element: slice.service.service.name ?? "",
          slice: slice.name ?? "",
        },
        slice,
      )
  }
}
