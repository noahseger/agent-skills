// The CLI, run as a user runs it: a fresh node process per command.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
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

test("json prints the model as spec JSON", () => {
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
    assert.deepEqual(JSON.parse(em("json", dir).stdout), { slices: [] })
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
  const run = em("proto", EXAMPLE)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /^usage:/)
})

test("--help prints the usage", () => {
  const run = em("--help")
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /^usage:/)
})

test("proto with no service says so and exits 1", () => {
  const dir = mkdtempSync(here("../tmp-proto-"))
  try {
    writeFileSync(
      join(dir, "index.ts"),
      `import { z } from "zod"
import { m } from "#em"

export const Start = m.command({ id: z.string() })
export const Started = m.event({ id: z.string() })
export const Table = m.readModel({ id: m.key(z.string()) })
export const User = m.actor()
export const Ch = m.chapter()
m.slice().command(Start, Started).chapter(Ch).test("starts", { when: Start({ id: "1" }), then: [Started({ id: "1" })] })
m.slice().view(Table, Started).chapter(Ch).actor(User).test("the row shows", { given: Started({ id: "1" }), then: Table({ id: "1" }) })
export default m.model("x")
`,
    )
    const run = em("proto", dir, "-o", join(dir, "out"))
    assert.equal(run.status, 1)
    assert.match(
      run.stderr,
      /^No slice has a service, so no \.proto was written\. Add \.service\(Api\)/,
    )
    assert.ok(!existsSync(join(dir, "out")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A finished Api service; the view has no specification and Loose is in no slice. */
const API_DONE = `import { z } from "zod"
import { m } from "#em"

export const Api = m.service("api.v1")
export const Start = m.command({ id: z.string() })
export const Started = m.event({ id: z.string() })
export const Table = m.readModel({ id: m.key(z.string()) })
export const Loose = m.event({ id: z.string() })
export const Ch = m.chapter()
m.slice().command(Start, Started).service(Api).chapter(Ch).test("starts", { when: Start({ id: "1" }), then: [Started({ id: "1" })] })
m.slice().view(Table, Started).chapter(Ch)
export default m.model("x")
`

/** \`em proto\` on a model directory holding \`source\`; returns the run and the files under -o. */
function protoOf(source: string) {
  const dir = mkdtempSync(here("../tmp-proto-"))
  try {
    writeFileSync(join(dir, "index.ts"), source)
    const run = em("proto", dir, "-o", join(dir, "out"))
    const read = (path: string) =>
      existsSync(join(dir, "out", path)) ? readFileSync(join(dir, "out", path), "utf8") : undefined
    return { run, api: read("api/v1/api.proto"), board: read("board/v1/board.proto") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("proto writes a finished service whatever is left to do elsewhere", () => {
  const { run, api } = protoOf(API_DONE)
  assert.equal(run.status, 0, run.stderr)
  assert.match(api ?? "", /rpc Start\(StartRequest\) returns \(StartResponse\);/)
})

test("proto skips a service with an unfinished slice, says why, and exits 1", () => {
  const { run, api, board } = protoOf(
    `${API_DONE}export const Board = m.service("board.v1")
export const Listing = m.readModel({ id: m.key(z.string()) })
m.slice().view(Listing, Started).service(Board, "List").chapter(Ch)
`,
  )
  assert.equal(run.status, 1)
  assert.ok(api)
  assert.equal(board, undefined)
  assert.match(
    run.stderr,
    /Skipped .*board\/v1\/board\.proto\. Its service has left to do:\nCh › Listing: no specification shows this view yet\./,
  )
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

/** Runs `act`, then waits for the server to say it reloaded. */
async function reloaded(url: string, act: () => void) {
  const reader = (await fetch(`${url}/events`)).body?.getReader()
  act()
  let seen = ""
  while (!seen.includes("data: changed")) {
    const chunk = await reader?.read()
    if (!chunk || chunk.done) break
    seen += new TextDecoder().decode(chunk.value)
  }
  await reader?.cancel()
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
    const served = (await model.json()) as { name: string; model: unknown }
    assert.equal(served.name, "Todo List Application")
    assert.deepEqual(served.model, JSON.parse(readFileSync(here("./todo-app.json"), "utf8")))

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

export const Games = m.stream()
export const User = m.actor()
export const Chess = m.service("chess.v1")
export const StartGame = m.command({ gameId: z.string() })
export const GameStarted = m.event({ gameId: z.string(), white: z.string(), black: z.string() }).stream(Games)
export const Play = m.chapter()
m.slice().command(StartGame, ${emits}).actor(User).service(Chess).chapter(Play)
export default m.model("Chess")
`
  const error = "index.ts:10  GameStarted: add black, white to the command or set it in the mapping"
  const warnings = async (url: string) =>
    (
      (await (await fetch(`${url}/model.json`)).json()) as { warnings?: { message: string }[] }
    ).warnings?.map((w) => w.message) ?? []
  writeFileSync(file, model("GameStarted"))
  const server = await view(dir)
  try {
    assert.ok(server.log().includes(`\n  ${error}\n`), server.log())
    assert.ok((await warnings(server.url)).includes(error))

    // Saved the way many editors save: a hidden temporary file renamed over the model.
    await reloaded(server.url, () => {
      writeFileSync(
        join(dir, ".!1!index.ts"),
        model('GameStarted(() => ({ white: "me", black: "you" }))'),
      )
      renameSync(join(dir, ".!1!index.ts"), file)
    })
    assert.ok(!(await warnings(server.url)).includes(error))
    const saved = server.log().slice(server.log().indexOf("Saved"))
    assert.ok(saved.startsWith("Saved index.ts ") && !saved.includes(error), server.log())

    await reloaded(server.url, () => writeFileSync(join(dir, "extra.ts"), "export {}\n"))
    await reloaded(server.url, () => rmSync(join(dir, "extra.ts")))
    assert.match(server.log(), /\d Deleted extra\.ts \(/)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("view pairs each compiler error with what assembly found about the same event's fields", async () => {
  const dir = mkdtempSync(here("../tmp-pair-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { z } from "zod"
import { m } from "#em"

export const User = m.actor()
export const Chess = m.service("chess.v1")
export const StartGame = m.command({ gameId: z.string() })
export const GameStarted = m.event({ gameId: z.string(), white: z.string() })
export const Begin = m.command({ gameId: z.string() })
export const Started = m.event({ gameId: z.string(), white: z.string() })
export const Play = m.chapter()
m.slice().command(StartGame, GameStarted).actor(User).service(Chess).chapter(Play)
m.slice().command(Begin, Started).actor(User).service(Chess).chapter(Play)
export default m.model("Chess")
`,
  )
  const server = await view(dir)
  try {
    const { warnings = [] } = (await (await fetch(`${server.url}/model.json`)).json()) as {
      warnings?: { message: string; element: string; slice?: string }[]
    }
    assert.deepEqual(
      warnings
        .filter((w) => w.message.includes("white"))
        .map((w) => [w.message, w.element, w.slice]),
      [
        [
          "index.ts:11  GameStarted: add white to the command or set it in the mapping",
          "GameStarted",
          "StartGame",
        ],
        [
          "index.ts:12  Started: add white to the command or set it in the mapping",
          "Started",
          "Begin",
        ],
      ],
    )
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a model that doesn't load shows the compiler's errors, not the JavaScript one", async () => {
  const dir = mkdtempSync(here("../tmp-load-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { z } from "zod"
import { m } from "#em"

m.slice().command(Retry, Retried).chapter(Ch)
m.slice().command(Retry, Retried).chapter(Later)
export const Received = m.event({ id: z.string() }).stream("Inbox")
export const Sync = m.command({ id: z.string() })
export const Synced = m.event({ id: z.string() })
export const Failed = m.event({ id: z.string() })
export const Ch = m.chapter()
m.slice().command(Sync, Synced).event(Synced, Failed).chapter(Ch)
m.slice().command(Sync)
export const Retry = m.command({ id: z.string() })
export const Retried = m.event({ id: z.string() })
export const Later = m.chapter()
Synced((e, { generate }) => ({ id: generate(e.id) }))
export const Pending = m.readModel({ id: z.string() })
m.slice().view(Pending)
m.slice().automation(Synced)
m.slice().automation(Pending, Sync)
export default m.model("x")
`,
  )
  const server = await view(dir)
  try {
    const log = server.log()
    const shown = log.slice(log.indexOf("The model didn't load:\n") + 23, log.indexOf("Showing"))
    assert.equal(
      shown,
      [
        "  index.ts: declare Retry, Retried, Ch, Later above where they are used.",
        "  index.ts:6  Argument of type 'string' is not assignable to parameter of type 'Stream'.",
        "  index.ts:11  .event() takes one event. To record Failed too, chain .event(Failed).",
        "  index.ts:12  Sync: this slice has no event yet. Add it to the slice's first call.",
        "  index.ts:16  a mapper only works inside a slice: .event(...), .command(...) or .view(...)",
        "  index.ts:18  Pending: this slice has no event yet. Add it to the slice's first call.",
        "  index.ts:19  Synced: this slice has no command yet. Add it to the slice's first call.",
        "  index.ts:20  Sync: this slice has no event yet. Add it to the slice's first call.",
        "",
      ].join("\n"),
    )
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
    loose: { title: string }[]
    warnings: { message: string }[]
  }
  assert.deepEqual(
    json.loose.map((l) => l.title),
    ["GameStarted", "MoveMade", "GameEnded"],
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

test("view and export draw a spec JSON file, and list where it breaks the schema", async () => {
  const dir = mkdtempSync(here("../tmp-spec-"))
  const file = join(dir, "shop.json")
  try {
    const json = JSON.parse(readFileSync(here("./todo-app.json"), "utf8"))
    writeFileSync(file, JSON.stringify(json))
    const server = await view(file)
    try {
      const fetched = async () =>
        (await (await fetch(`${server.url}/model.json`)).json()) as {
          name: string
          model: unknown
          warnings: { message: string }[]
        }
      const valid = await fetched()
      assert.deepEqual([valid.name, valid.model, valid.warnings], ["shop", json, []])
      await reloaded(server.url, () => {
        json.slices[0].sliceType = "VIEW"
        writeFileSync(file, JSON.stringify(json))
      })
      const broken = await fetched()
      assert.deepEqual(
        broken.warnings.map((w) => w.message),
        [
          "shop.json/slices/0/sliceType must be equal to one of the allowed values STATE_CHANGE, STATE_VIEW, AUTOMATION, TRANSLATION",
        ],
      )
      assert.match(server.log(), /1 thing left to do:\n {2}shop\.json\/slices\/0\/sliceType/)
    } finally {
      server.close()
    }
    const run = em("export", file, "-o", join(dir, "shop.html"))
    assert.equal(run.status, 0, run.stderr)
    const html = readFileSync(join(dir, "shop.html"), "utf8")
    assert.match(html, /<title>shop<\/title>/)
    assert.match(html, /shop\.json\/slices\/0\/sliceType must be equal/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
