#!/usr/bin/env node
// em <command> <path> [options]
//
//   init   <dir>                  scaffold a model directory
//   json   <path> [--partial]     print the assembled JSON; --partial keeps going past dead ends
//   render <path> -o out.svg      draw the diagram; --watch redraws on save
//   proto  <path> -o dir          write one .proto per service
//   view   <path> [--port n]      serve the live diagram; --no-open keeps the browser closed
//   export <path> -o out.html     one self-contained page of the model, for sharing
//
// <path> is a model directory or a single module. An assembly error stops every command.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { assemble, load } from "../src/assemble.ts"
import { exportHtml } from "../src/export.ts"
import { generateProto } from "../src/proto.ts"
import { type Snapshot, serve } from "../src/serve.ts"

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
  em render <path> -o <out.svg> [--watch]
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
// The renderer lives beside this package in the repository; the build copies it in.
const EVENT_MODEL_PY =
  [join(ROOT, "event_model.py"), join(ROOT, "..", "event_model.py")].find((p) => existsSync(p)) ??
  join(ROOT, "event_model.py")
const PYTHON = process.platform === "win32" ? "python" : "python3"

const INDEX_TS = `import { m } from "@noahseger/event-modeling"

export default m.model("My System")
`

// Lets node run the model unbuilt. verbatimModuleSyntax stops node loading type-only imports.
const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      module: "nodenext",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
    },
  },
  null,
  2,
)}\n`

// Without its own "type": "module", node warns and reparses the model on every save.
const PACKAGE_JSON = `${JSON.stringify({ type: "module" }, null, 2)}\n`

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string", short: "o" },
    watch: { type: "boolean" },
    port: { type: "string" },
    open: { type: "boolean", default: true },
    partial: { type: "boolean", default: false },
  },
  allowPositionals: true,
  allowNegative: true,
})
const [command, path] = positionals

function init(dir: string): void {
  const files = { "index.ts": INDEX_TS, "tsconfig.json": TSCONFIG, "package.json": PACKAGE_JSON }
  for (const name of Object.keys(files)) {
    if (existsSync(join(dir, name)))
      throw new Error(`${join(dir, name)} already exists. Run init in a new directory.`)
  }
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text)
    console.log(`wrote ${join(dir, name)}`)
  }
}

async function json(path: string): Promise<void> {
  const model = await assemble(path, { partial: values.partial })
  // Warnings go to stderr so stdout stays valid JSON.
  for (const w of model.warnings ?? []) console.error(w.message)
  console.log(JSON.stringify(model, null, 2))
}

async function proto(path: string, out: string): Promise<void> {
  const { model } = await load(path)
  for (const file of generateProto(model)) {
    const target = join(out, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.source)
    console.log(`wrote ${target}`)
  }
}

async function renderOnce(path: string, out: string): Promise<void> {
  // event_model.py reads a file, so the JSON goes to a temp directory.
  const scratch = mkdtempSync(join(tmpdir(), "em-"))
  try {
    const file = join(scratch, "model.json")
    writeFileSync(file, JSON.stringify(await assemble(path)))
    const run = spawnSync(PYTHON, [EVENT_MODEL_PY, "render", file, "-o", out], {
      stdio: "inherit",
    })
    if (run.status !== 0) process.exitCode = run.status ?? 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function render(path: string, out: string): Promise<void> {
  await renderOnce(path, out)
  if (!values.watch) return
  const root = statSync(path).isDirectory() ? path : dirname(path)
  const target = resolve(out)
  console.log(`watching ${root}`)
  let pending = false
  watch(root, { recursive: true }, (_event, filename) => {
    // A module, once imported, stays in this process's cache, so each redraw
    // runs in a fresh process: this command again, without --watch.
    if (!filename || filename.includes("node_modules") || resolve(root, filename) === target) return
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      spawnSync(
        process.execPath,
        [...process.execArgv, process.argv[1] ?? "", "render", path, "-o", out],
        {
          stdio: "inherit",
        },
      )
    }, 50)
  })
}

/** A fresh process rereads saved modules; --partial draws unfinished models. */
function assembleFresh(path: string, changed?: string): Snapshot {
  const started = Date.now()
  const run = spawnSync(
    process.execPath,
    [...process.execArgv, process.argv[1] ?? "", "json", "--partial", path],
    { encoding: "utf8" },
  )
  const stamp = new Date().toTimeString().slice(0, 8)
  const cause = changed ? `${changed} saved` : "start"
  const took = `${Date.now() - started}ms`
  if (run.status === 0) {
    const left = run.stderr.trim()
    const count = left === "" ? 0 : left.split("\n").length
    console.log(`${stamp} ${cause}: assembled in ${took}, ${count} to do`)
    if (left !== "") console.log(left.replace(/^/gm, "  "))
    return { json: run.stdout }
  }
  const error = run.stderr || run.stdout
  console.log(`${stamp} ${cause}: assembly failed in ${took}`)
  console.log(error.trimEnd().replace(/^/gm, "  "))
  return { error }
}

function builtViewer(): void {
  if (!existsSync(join(VIEWER_DIST, "index.html")))
    throw new Error(`The viewer is not built. Run \`npm run build\` in ${ROOT}.`)
}

async function exportPage(path: string, out: string): Promise<void> {
  builtViewer()
  const json = JSON.stringify(await assemble(path, { partial: true }))
  writeFileSync(out, exportHtml(VIEWER_DIST, json))
  console.log(`wrote ${out}`)
}

async function view(path: string): Promise<void> {
  builtViewer()
  const server = await serve({
    dist: VIEWER_DIST,
    root: statSync(path).isDirectory() ? path : dirname(path),
    load: async (changed) => assembleFresh(path, changed),
    port: Number(values.port ?? 5311),
  })
  console.log(`viewing ${path} at ${server.url}`)
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
  if (!command || !path) usage()
  else if (command === "init") init(path)
  else if (command === "json") await json(path)
  else if (command === "render" && values.out) await render(path, values.out)
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
