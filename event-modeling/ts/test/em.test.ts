// The CLI, run as a user runs it: a fresh node process per command.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
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
    assert.ok(existsSync(join(dir, "index.ts")) && existsSync(join(dir, "tsconfig.json")))
    assert.deepEqual(JSON.parse(em("json", dir).stdout).chapters, [])
    const again = em("init", dir)
    assert.equal(again.status, 1)
    assert.match(again.stderr, /does not overwrite/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an assembly error is one line and exit 1", () => {
  const run = em("json", here("./fixtures/unexported"))
  assert.equal(run.status, 1)
  assert.equal(run.stderr.trim(), "slice #1 in 'Ch' uses an event that no module exports.")
})

test("a missing argument prints usage and exits 2", () => {
  const run = em("render", EXAMPLE)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^usage:/)
})

test("view serves the app, the model, and a change feed", async () => {
  const server = spawn(process.execPath, [
    ...NODE_FLAGS,
    here("../bin/em.ts"),
    "view",
    EXAMPLE,
    "--port",
    "0",
    "--no-open",
  ])
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = ""
      server.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString()
        const match = out.match(/at (http:\/\/localhost:\d+)/)
        if (match?.[1]) resolve(match[1])
      })
      server.stderr.on("data", (chunk: Buffer) => reject(new Error(chunk.toString())))
      server.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)))
    })
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
    server.kill()
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
