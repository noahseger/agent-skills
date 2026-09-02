#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// em <command> <path> [options]
//
//   init   <dir>                  scaffold a model directory
//   json   <path>                 print the assembled JSON
//   render <path> -o out.svg      draw the diagram; --watch redraws on save
//   proto  <path> -o dir          write one .proto per service
//   view   <path> [--port n]      serve the live diagram; --no-open keeps the browser closed
//
// <path> is a model directory or a single module. Every command assembles the
// model first, so an assembly error stops all of them the same way: its
// message, exit 1. render shells out to event_model.py, which owns the SVG.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { assemble, load } from "../src/assemble.ts"
import { generateProto } from "../src/proto.ts"
import { type Snapshot, serve } from "../src/serve.ts"

const USAGE = `usage:
  em init   <dir>
  em json   <path>
  em render <path> -o <out.svg> [--watch]
  em proto  <path> -o <dir>
  em view   <path> [--port <n>] [--no-open]`

const EVENT_MODEL_PY = fileURLToPath(new URL("../../event_model.py", import.meta.url))
const VIEWER_DIST = fileURLToPath(new URL("../viewer/dist/", import.meta.url))

const INDEX_TS = `import { m } from "@noahseger/event-modeling"

export default m.model("My System", {
  description: "",
  chapters: [],
})
`

// What node needs to run the model with no build step. verbatimModuleSyntax
// keeps type-only imports marked as such, or node would try to load them.
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

const { values, positionals } = parseArgs({
  options: {
    out: { type: "string", short: "o" },
    watch: { type: "boolean" },
    port: { type: "string" },
    open: { type: "boolean", default: true },
  },
  allowPositionals: true,
  allowNegative: true,
})
const [command, path] = positionals

function init(dir: string): void {
  const files = { "index.ts": INDEX_TS, "tsconfig.json": TSCONFIG }
  for (const name of Object.keys(files)) {
    if (existsSync(join(dir, name)))
      throw new Error(`${join(dir, name)} exists; init does not overwrite.`)
  }
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text)
    console.log(`wrote ${join(dir, name)}`)
  }
}

async function json(path: string): Promise<void> {
  console.log(JSON.stringify(await assemble(path), null, 2))
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
  // event_model.py reads a file, so the JSON goes to a scratch directory that
  // does not outlive the render.
  const scratch = mkdtempSync(join(tmpdir(), "em-"))
  try {
    const file = join(scratch, "model.json")
    writeFileSync(file, JSON.stringify(await assemble(path)))
    const run = spawnSync("python3", [EVENT_MODEL_PY, "render", file, "-o", out], {
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

/** The model, assembled in a fresh process so a saved module is read again. */
function assembleFresh(path: string): Snapshot {
  const run = spawnSync(
    process.execPath,
    [...process.execArgv, process.argv[1] ?? "", "json", path],
    { encoding: "utf8" },
  )
  return run.status === 0 ? { json: run.stdout } : { error: run.stderr || run.stdout }
}

async function view(path: string): Promise<void> {
  if (!existsSync(join(VIEWER_DIST, "index.html")))
    throw new Error("The viewer is not built. Run `npm run build` in the package.")
  const server = await serve({
    dist: VIEWER_DIST,
    root: statSync(path).isDirectory() ? path : dirname(path),
    load: async () => assembleFresh(path),
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
