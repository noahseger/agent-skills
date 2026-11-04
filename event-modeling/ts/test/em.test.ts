// The CLI, run as a user runs it: a fresh node process per command.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const EXAMPLE = here("../examples/todo-app")

/** The same flags the shebang and the npm scripts pass. */
const NODE_FLAGS = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]

function em(...args: string[]) {
  return spawnSync(process.execPath, [...NODE_FLAGS, here("../bin/em.ts"), ...args], {
    encoding: "utf8",
  })
}

test("json prints the assembled model", () => {
  const run = em("json", EXAMPLE)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(
    JSON.parse(run.stdout),
    JSON.parse(readFileSync(here("./todo-app.json"), "utf8")),
  )
})

test("proto writes the generated files under -o", () => {
  const out = mkdtempSync(join(tmpdir(), "em-"))
  try {
    const run = em("proto", EXAMPLE, "-o", out)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(
      readFileSync(join(out, "todo/v1/todo_service.proto"), "utf8"),
      readFileSync(here("../examples/proto/todo/v1/todo_service.proto"), "utf8"),
    )
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("render writes an SVG through event_model.py", () => {
  const out = mkdtempSync(join(tmpdir(), "em-"))
  try {
    const run = em("render", EXAMPLE, "-o", join(out, "model.svg"))
    assert.equal(run.status, 0, run.stderr)
    assert.match(readFileSync(join(out, "model.svg"), "utf8"), /^<svg /)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("init scaffolds a model that assembles, and refuses to overwrite it", () => {
  // Inside the package, so the scaffold's import of the package name resolves.
  const dir = mkdtempSync(here("../tmp-init-"))
  try {
    rmSync(dir, { recursive: true })
    const run = em("init", dir)
    assert.equal(run.status, 0, run.stderr)
    // The scaffold's own package.json ends node's search for the package by
    // name, so the model gets the dependency the way a user's would.
    mkdirSync(join(dir, "node_modules", "@noahseger"), { recursive: true })
    symlinkSync(here(".."), join(dir, "node_modules", "@noahseger", "event-modeling"))
    for (const f of ["index.ts", "tsconfig.json", "package.json"])
      assert.ok(existsSync(join(dir, f)), f)
    assert.deepEqual(JSON.parse(em("json", dir).stdout).chapters, [])
    const again = em("init", dir)
    assert.equal(again.status, 1)
    assert.match(again.stderr, /already exists, so init stopped\. Run it in an empty directory\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an assembly error is one line and exit 1", () => {
  const run = em("json", here("./fixtures/unexported"))
  assert.equal(run.status, 1)
  assert.equal(
    run.stderr.trim(),
    "Ch › slice 1: this slice uses an event that isn't exported. Export it to give it a name.",
  )
})

test("a missing argument prints usage and exits 2", () => {
  const run = em("render", EXAMPLE)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^usage:/)
})

/** `em view` on a free port; resolves once it prints its URL. */
async function view(path: string) {
  const server = spawn(process.execPath, [
    ...NODE_FLAGS,
    here("../bin/em.ts"),
    "view",
    path,
    "--port",
    "0",
    "--no-open",
  ])
  let out = ""
  const url = await new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString()
      const match = out.match(/at (http:\/\/localhost:\d+)/)
      if (match?.[1]) resolve(match[1])
    })
    server.stderr.on("data", (chunk: Buffer) => reject(new Error(chunk.toString())))
    server.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)))
  })
  return { url, log: () => out, close: () => server.kill() }
}

test("view serves the app, the model, and a change feed", async () => {
  const server = await view(EXAMPLE)
  try {
    const { url } = server
    const page = await fetch(`${url}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<div id="app">/)

    const model = await fetch(`${url}/model.json`)
    assert.equal(model.status, 200)
    assert.deepEqual(await model.json(), JSON.parse(readFileSync(here("./todo-app.json"), "utf8")))

    const feed = await fetch(`${url}/events`)
    assert.equal(feed.headers.get("content-type"), "text/event-stream")
    await feed.body?.cancel()

    assert.equal((await fetch(`${url}/../package.json`)).status, 404)
  } finally {
    server.close()
  }
})

test("view lists a compiler error with what assembly found, until a save fixes it", async () => {
  const dir = mkdtempSync(here("../tmp-check-"))
  const file = join(dir, "index.ts")
  const model = (emits: string) => `import { z } from "zod"
import { m } from "#em"

export const User = m.actor()
export const Chess = m.service("chess.v1")
export const StartGame = m.command({ gameId: z.string() })
export const GameStarted = m.event({ gameId: z.string(), white: z.string() })
export const Games = m.stream({ GameStarted })
export default m.model("Chess", { chapters: { Play: [m.slice().actor(User).service(Chess).command(StartGame)${emits}] } })
`
  const error = "index.ts:9  .emits(GameStarted): add white to the command or set it in the mapping"
  const warnings = async (url: string) =>
    (
      (await (await fetch(`${url}/model.json`)).json()) as { warnings?: { message: string }[] }
    ).warnings?.map((w) => w.message) ?? []
  writeFileSync(file, model(".emits(GameStarted)"))
  const server = await view(dir)
  try {
    assert.ok(server.log().includes(`\n  ${error}\n`), server.log())
    assert.ok((await warnings(server.url)).includes(error))

    const feed = await fetch(`${server.url}/events`)
    const reader = feed.body?.getReader()
    writeFileSync(file, model('.emits(GameStarted, () => ({ white: "me" }))'))
    let seen = ""
    while (!seen.includes("data: changed")) {
      const chunk = await reader?.read()
      if (!chunk || chunk.done) break
      seen += new TextDecoder().decode(chunk.value)
    }
    await reader?.cancel()
    assert.ok(!(await warnings(server.url)).includes(error))
    const saved = server.log().slice(server.log().indexOf("Saved"))
    assert.ok(saved !== "" && !saved.includes(error), server.log())
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("export writes one self-contained page carrying the model", () => {
  const out = mkdtempSync(join(tmpdir(), "em-"))
  try {
    const run = em("export", EXAMPLE, "-o", join(out, "model.html"))
    assert.equal(run.status, 0, run.stderr)
    const html = readFileSync(join(out, "model.html"), "utf8")
    assert.match(html, /<title>Todo List Application<\/title>/)
    assert.match(html, /<script type="application\/json" id="model">/)
    assert.match(html, /<script type="module">/)
    assert.match(html, /<style>/)
    assert.doesNotMatch(html, /src="\/assets|href="\/assets/, "nothing is fetched")
    assert.ok(!existsSync(join(out, "assets")))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test("json refuses a storm of events; --partial prints it with what is still to do", () => {
  const storm = here("./fixtures/storm")
  const strict = em("json", storm)
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /GameStarted isn't in a slice yet\./)
  const partial = em("json", "--partial", storm)
  assert.equal(partial.status, 0, partial.stderr)
  const json = JSON.parse(partial.stdout) as {
    loose: { element: string }[]
    warnings: { message: string }[]
  }
  assert.deepEqual(
    json.loose.map((l) => l.element),
    ["GameStarted(gameId)", "MoveMade(gameId, san)", "GameEnded(gameId, result)"],
  )
  assert.deepEqual(
    json.warnings.map((w) => w.message),
    [
      "GameStarted isn't in a slice yet.",
      "MoveMade isn't in a slice yet.",
      "GameEnded isn't in a slice yet.",
    ],
  )
})

test("a directory's dependencies, hidden files and .d.ts files are not the model", () => {
  const dir = mkdtempSync(here("../tmp-walk-"))
  try {
    cpSync(here("./fixtures/storm/index.ts"), join(dir, "index.ts"))
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true })
    writeFileSync(join(dir, "node_modules", "dep", "index.ts"), "throw new Error('dependency')")
    mkdirSync(join(dir, ".cache"))
    writeFileSync(join(dir, ".cache", "x.ts"), "throw new Error('hidden')")
    writeFileSync(join(dir, "types.d.ts"), "export declare const x: string")
    const run = em("json", "--partial", dir)
    assert.equal(run.status, 0, run.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
