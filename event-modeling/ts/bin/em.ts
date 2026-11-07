#!/usr/bin/env node
// em <command> <path> [options]
//
//   init   <dir>                  scaffold a model directory
//   json   <path> [--partial]     print the model as event-modeling-spec JSON; --partial keeps
//                                 going past dead ends and prints what the viewer reads
//   proto  <path> -o dir          write one .proto per service whose own slices are finished
//   view   <path> [--port n]      serve the live diagram; --no-open keeps the browser closed
//   export <path> -o out.html     one self-contained page of the model, for sharing
//
// <path> is a model directory or a single module. An assembly error stops every command.
// `view` and `export` also take a spec JSON file, and list where it breaks the schema.
import { execFile, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { assemble, type Feed, load, type Warning } from "../src/assemble.ts"
import { type Checker, COMPILER_OPTIONS, checker } from "../src/check.ts"
import { exportHtml } from "../src/export.ts"
import { generateProto } from "../src/proto.ts"
import { type Snapshot, serve } from "../src/serve.ts"
import type { SpecModel } from "../src/spec.ts"
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

const TSCONFIG = `${JSON.stringify({ compilerOptions: COMPILER_OPTIONS }, null, 2)}\n`

// Without its own "type": "module", node warns and reparses the model on every save.
const PACKAGE_JSON = `${JSON.stringify({ type: "module" }, null, 2)}\n`

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string", short: "o" },
    port: { type: "string" },
    open: { type: "boolean", default: true },
    partial: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  allowNegative: true,
})
const [command, path] = positionals

function init(dir: string): void {
  const files = { "index.ts": INDEX_TS, "tsconfig.json": TSCONFIG, "package.json": PACKAGE_JSON }
  for (const name of Object.keys(files)) {
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
}

async function json(path: string): Promise<void> {
  const feed = await assemble(path, { partial: values.partial })
  // Warnings go to stderr so stdout stays valid JSON.
  for (const w of feed.warnings ?? []) console.error(w.message)
  console.log(JSON.stringify(values.partial ? feed : feed.model, null, 2))
}

/** A service whose own slices are finished is written, whatever is left to do elsewhere. */
async function proto(path: string, out: string): Promise<void> {
  const files = generateProto(await load(path, { partial: true }))
  if (files.length === 0)
    throw new Error(
      'No slice has a service, so no .proto was written. Add .service(Api) to the state changes and views the API serves, after `export const Api = m.service("my.v1")`.',
    )
  for (const file of files) {
    const target = join(out, file.path)
    if ("problems" in file) {
      console.error(`Skipped ${target}. Its service has left to do:\n${file.problems.join("\n")}`)
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
      [...process.execArgv, process.argv[1] ?? "", "json", "--partial", path],
      { maxBuffer: 2 ** 28 },
      (error, stdout, stderr) => done({ ok: error === null, stdout, stderr }),
    )
  })
}

/** Assembles and type-checks at once, and logs everything left to fix in one block. */
async function reload(path: string, types: Checker, cause = "Started"): Promise<Snapshot> {
  const started = Date.now()
  const [run, errors] = await Promise.all([
    assembleFresh(path),
    types.check().catch((e: unknown) => [`The type check stopped: ${String(e)}`]),
  ])
  if (run.ok) {
    const feed = JSON.parse(run.stdout) as Feed
    return report(cause, started, { ...feed, warnings: mergeFindings(errors, feed.warnings ?? []) })
  }
  // A compiler error says where and why; the JavaScript error it caused only says what broke.
  return failed(cause, started, errors.length > 0 ? errors.join("\n") : run.stderr || run.stdout)
}

/** A spec JSON file is drawn as it is; where it breaks the schema is left to do. */
function readSpec(path: string): Feed {
  const model: unknown = JSON.parse(readFileSync(path, "utf8"))
  const warnings = validate(model).map((m) => ({ message: `${basename(path)}${m}`, element: "" }))
  return { name: basename(path, ".json"), model: model as SpecModel, warnings }
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

/** Logs everything left to fix in one block. */
function report(cause: string, started: number, feed: Feed): Snapshot {
  const count = feed.warnings?.length ?? 0
  const summary =
    count === 0
      ? "Nothing left to do."
      : count === 1
        ? "1 thing left to do:"
        : `${count} things left to do:`
  console.log(`${stamp(cause, started)} ${summary}`)
  for (const w of feed.warnings ?? []) console.log(`  ${w.message}`)
  return { json: JSON.stringify(feed) }
}

function failed(cause: string, started: number, error: string): Snapshot {
  console.log(`${stamp(cause, started)} The model didn't load:`)
  console.log(error.trimEnd().replace(/^/gm, "  "))
  return { error: error.trimEnd() }
}

/**
 * The compiler and assembly both report an event field with no value. Keep the
 * compiler's line, which says where to type, and the element assembly marks.
 */
function mergeFindings(errors: readonly string[], found: readonly Warning[]): Warning[] {
  const compiled: Warning[] = errors.map((message) => ({ message, element: "" }))
  const rest = found.filter((w) => {
    const field = /(\w+)\.(\w+) has no value\. Add \2 to /.exec(w.message)
    const same = field
      ? compiled.find(
          (c) => c.message.includes(field[1] ?? "") && c.message.includes(` ${field[2]}`),
        )
      : undefined
    if (same) Object.assign(same, { element: w.element, slice: w.slice })
    return !same
  })
  return [...compiled, ...rest]
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
    port: Number(values.port ?? 5311),
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
