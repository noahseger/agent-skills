#!/usr/bin/env node
// em <command> <path> [options]
//
//   init   <dir>                  scaffold a model directory
//   types  <path> [--check]       write generated/d.d.ts in the model, so d is typed; --check
//                                 exits 1 if it is out of date
//   json   <path> [--partial]     print the model as event-modeling-spec JSON; --partial keeps
//                                 going past errors and prints what the viewer reads
//   proto  <path> -o dir          write one .proto per service whose own slices have no errors
//   view   <path> [--port n]      serve the live diagram; --no-open keeps the browser closed
//   export <path> -o out.html     one self-contained page of the model, for sharing
//
// <path> is a model directory or a single module. An assembly error stops every command; a
// warning stops none.
// `view` and `export` also take a spec JSON file, and list where it breaks the schema.
import { execFile, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import {
  assemble,
  type Feed,
  importModel,
  load,
  loadModules,
  type Message,
  modelFiles,
} from "../src/assemble.ts"
import { type Checker, COMPILER_OPTIONS, checker } from "../src/check.ts"
import { exportHtml } from "../src/export.ts"
import { generateProto } from "../src/proto.ts"
import {
  current,
  GENERATED,
  registry,
  specifierOf,
  typesOf,
  writeRegistry,
} from "../src/registry.ts"
import { type Snapshot, serve } from "../src/serve.ts"
import { kinds, type SpecModel, toFeed } from "../src/spec.ts"
import { counted } from "../src/types.ts"
import { validate } from "../src/validate.ts"

// Node 22 needs a flag to run TypeScript, so rerun with it. Node 23.6 does not.
const STRIP = "--experimental-strip-types"
if (!process.features.typescript && !process.execArgv.includes(STRIP)) {
  const again = spawnSync(
    process.execPath,
    [STRIP, "--disable-warning=ExperimentalWarning", ...process.execArgv, ...process.argv.slice(1)],
    { stdio: "inherit" },
  )
  process.exit(again.status ?? 1)
}

const USAGE = `usage:
  em init   <dir>
  em types  <path> [--check]
  em json   <path> [--partial]
  em proto  <path> -o <dir>
  em view   <path> [--port <n>] [--no-open]
  em export <path> -o <out.html>`

/** The package directory, whether this runs from `bin/` or from `dist/bin/`. */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir)
  return dir
}
const ROOT = packageRoot()
const VIEWER_DIST = join(ROOT, "viewer", "dist")

const INDEX_TS = `import { m } from "@noahseger/event-modeling"

export default m.model("My System")
`

// One model per tsconfig: its modules and the d.d.ts that types its d.
const TSCONFIG = `${JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["**/*.ts"] }, null, 2)}\n`

// Without its own "type": "module", node warns and reparses the model on every save.
const PACKAGE_JSON = `${JSON.stringify({ type: "module" }, null, 2)}\n`

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string", short: "o" },
    port: { type: "string" },
    open: { type: "boolean", default: true },
    partial: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    // em view's: write d.d.ts once the modules have run.
    types: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  allowNegative: true,
})
const [command, path] = positionals

function init(dir: string): void {
  const files = {
    "index.ts": INDEX_TS,
    "tsconfig.json": TSCONFIG,
    "package.json": PACKAGE_JSON,
  }
  for (const name of [...Object.keys(files), GENERATED]) {
    if (existsSync(join(dir, name)))
      throw new Error(
        `${join(dir, name)} already exists, so init stopped. Run it in an empty directory.`,
      )
  }
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text)
    console.log(`Wrote ${join(dir, name)}`)
  }
  writeRegistry(dir, registry(dir, "@noahseger/event-modeling"))
  console.log(`Wrote ${typesOf(dir)}`)
}

/** The model's declarations, written into its `generated` as the types of `d`; `--check` only compares. */
async function types(path: string): Promise<void> {
  const { files, dir } = await importModel(path)
  const made = registry(dir, specifierOf(files))
  const file = typesOf(dir)
  if (!values.check)
    console.log(writeRegistry(dir, made) ? `Wrote ${file}` : `${file} is up to date.`)
  else if (!current(dir, made)) {
    console.error(`${file}: out of date. Run em types ${path}.`)
    process.exitCode = 1
  }
}

async function json(path: string): Promise<void> {
  let imported: Awaited<ReturnType<typeof importModel>> | undefined
  try {
    imported = await importModel(path)
  } finally {
    // Even when a module throws, so what it declared before it threw is typed.
    if (values.types) {
      const { dir, files } = modelFiles(path)
      writeRegistry(dir, registry(dir, specifierOf(files)))
    }
  }
  const { modules, dir } = imported
  const feed = toFeed(loadModules(modules, { partial: values.partial }, dir))
  // Messages go to stderr so stdout stays valid JSON.
  for (const m of [...(feed.errors ?? []), ...(feed.warnings ?? [])]) console.error(m.message)
  console.log(JSON.stringify(values.partial ? feed : feed.model, null, 2))
}

/** A service whose own slices have no errors is written, whatever is wrong elsewhere. */
async function proto(path: string, out: string): Promise<void> {
  const files = generateProto(await load(path, { partial: true }))
  // Nothing is wrong: the model has no API yet.
  if (files.length === 0)
    console.error(
      'No service: no .proto written. Add .service(d.Api) to the state changes and views it serves, after m.service("Api", "my.v1").',
    )
  for (const file of files) {
    const target = join(out, file.path)
    if ("errors" in file) {
      const n = file.errors.length
      console.error(
        `Skipped ${target}: ${file.service} has ${n} ${n === 1 ? "error" : "errors"}:\n${file.errors.join("\n")}`,
      )
      process.exitCode = 1
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.source)
    console.log(`Wrote ${target}`)
  }
}

/** A fresh process rereads saved modules; --partial draws unfinished models. */
function assembleFresh(path: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [...process.execArgv, process.argv[1] ?? "", "json", "--partial", "--types", path],
      { maxBuffer: 2 ** 28 },
      (error, stdout, stderr) => done({ ok: error === null, stdout, stderr }),
    )
  })
}

/** Assembles and type-checks at once, and logs every error and warning in one block. */
async function reload(path: string, types: Checker, cause = "Started"): Promise<Snapshot> {
  const started = Date.now()
  const check = () =>
    types.check().catch((e: unknown): Message[] => [
      {
        kind: "error",
        message: `Type check stopped: ${String(e)}`,
        ui: "Type check stopped",
        element: "",
      },
    ])
  const generated = typesOf(statSync(path).isDirectory() ? path : dirname(path))
  const read = () => (existsSync(generated) ? readFileSync(generated, "utf8") : undefined)
  const before = read()
  const [run, first] = await Promise.all([assembleFresh(path), check()])
  // The run writes d.d.ts when a declaration changed, after the check beside it read it.
  const errors = read() === before ? first : await check()
  if (run.ok) {
    const { errors: wrong = [], warnings = [], ...feed } = JSON.parse(run.stdout) as Feed
    return report(cause, started, { ...feed, ...kinds(merged(errors, [...wrong, ...warnings])) })
  }
  // A compiler error says where and why; the JavaScript error it caused only says what broke. The
  // modules stopped where one threw, so d.d.ts lacks what they declare after it: a name
  // missing from it is that error's, not one of its own.
  const roots = errors.filter((e) => !UNREGISTERED.test(e.message))
  const shown = roots.length > 0 ? roots : errors
  return failed(
    cause,
    started,
    shown.length > 0 ? shown.map((e) => e.message).join("\n") : run.stderr || run.stdout,
  )
}

const UNREGISTERED = /Property '\w+' does not exist on type 'Registry'/

/** A spec JSON file is drawn as it is; each place it breaks the schema is an error. */
function readSpec(path: string): Feed {
  const model: unknown = JSON.parse(readFileSync(path, "utf8"))
  const errors = validate(model).map(
    ({ at, problem }): Message => ({
      kind: "error",
      message: `${basename(path)} ${at}: ${problem}`,
      ui: `${basename(path)}: ${at} ${problem}`,
      element: "",
    }),
  )
  return { name: basename(path, ".json"), model: model as SpecModel, ...kinds(errors) }
}

async function reloadSpec(path: string, cause = "Started"): Promise<Snapshot> {
  const started = Date.now()
  try {
    return report(cause, started, readSpec(path))
  } catch (error) {
    return failed(cause, started, error instanceof Error ? error.message : String(error))
  }
}

const stamp = (cause: string, started: number) =>
  `${new Date().toTimeString().slice(0, 8)} ${cause} (${Date.now() - started}ms).`

/** Logs every error, then every warning, in one block. */
function report(cause: string, started: number, feed: Feed): Snapshot {
  const all = [...(feed.errors ?? []), ...(feed.warnings ?? [])]
  const summary =
    all.length === 0
      ? "Nothing left to do."
      : `${counted(feed.errors?.length ?? 0, feed.warnings?.length ?? 0)}:`
  console.log(`${stamp(cause, started)} ${summary}`)
  for (const m of all) console.log(`  ${m.message}`)
  return { json: JSON.stringify(feed) }
}

function failed(cause: string, started: number, error: string): Snapshot {
  console.log(`${stamp(cause, started)} The model didn't load:`)
  console.log(error.trimEnd().replace(/^/gm, "  "))
  return { error: error.trimEnd() }
}

/**
 * The compiler and assembly both report a field with no source. Keep the compiler's
 * line, which says where to type, and the slice assembly marks.
 */
function merged(compiled: readonly Message[], found: readonly Message[]): Message[] {
  const merged = compiled.map((c) => ({ ...c }))
  const rest = found.filter((w) => {
    const same = merged.find(
      (c) => c.element === w.element && w.fields?.every((f) => c.fields?.includes(f)),
    )
    if (same && w.slice !== undefined) same.slice = w.slice
    return !same
  })
  return [...merged, ...rest]
}

const isSpec = (path: string) => extname(path) === ".json"

function builtViewer(): void {
  if (!existsSync(join(VIEWER_DIST, "index.html")))
    throw new Error(`The viewer isn't built yet. Run \`npm run build\` in ${ROOT}.`)
}

async function exportPage(path: string, out: string): Promise<void> {
  builtViewer()
  const feed = isSpec(path) ? readSpec(path) : await assemble(path, { partial: true })
  const json = JSON.stringify(feed)
  writeFileSync(out, exportHtml(VIEWER_DIST, json))
  console.log(`Wrote ${out}`)
}

async function view(path: string): Promise<void> {
  builtViewer()
  const types = isSpec(path) ? undefined : checker(path)
  const server = await serve({
    dist: VIEWER_DIST,
    root: statSync(path).isDirectory() ? path : dirname(path),
    load: (cause) => (types ? reload(path, types, cause) : reloadSpec(path, cause)),
    port: values.port === undefined ? undefined : Number(values.port),
  })
  console.log(`Showing ${path} at ${server.url}. Press Ctrl-C to stop.`)
  if (values.open) openBrowser(server.url)
}

function openBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  if (cmd)
    spawn(cmd, args, { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref()
}

async function main(): Promise<void> {
  if (values.help) console.log(USAGE)
  else if (!command || !path) usage()
  else if (command === "init") init(path)
  else if (command === "types") await types(path)
  else if (command === "json") await json(path)
  else if (command === "proto" && values.out) await proto(path, values.out)
  else if (command === "view") await view(path)
  else if (command === "export" && values.out) await exportPage(path, values.out)
  else usage()
}

function usage(): void {
  console.error(USAGE)
  process.exit(2)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
