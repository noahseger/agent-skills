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
import { createServer } from "node:net"
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
    for (const f of ["index.ts", "tsconfig.json", "package.json", "generated/d.d.ts"])
      assert.ok(existsSync(join(dir, f)), f)
    assert.deepEqual(JSON.parse(em("json", dir).stdout), { slices: [] })
    // The model types d from the start: what init writes is what em types would.
    const types = em("types", "--check", dir)
    assert.equal(types.status, 0, types.stderr)
    const again = em("init", dir)
    assert.equal(again.status, 1)
    assert.match(again.stderr, /already exists, so init stopped\. Run it in an empty directory\./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("an assembly error is one line and exit 1; d types a name declared twice as each declaration, so only assembly says so", () => {
  const run = em("json", here("./fixtures/declared-twice"))
  assert.equal(run.status, 1)
  assert.equal(
    run.stderr.trim(),
    "Created: declared twice, at index.ts:5 and index.ts:6. Keep one.",
  )
  assert.ok(
    readFileSync(here("./fixtures/declared-twice/generated/d.d.ts"), "utf8").includes(
      '    Created: EventDecl<"Created", { id: Field<string> }> & EventDecl<"Created", { id: Field<string>; at: Field<string, "datetime"> }>\n',
    ),
  )
})

/**
 * Each name the declaration map maps, and the text between where it maps the name's start and its end,
 * which an editor reports as the definition's span.
 */
function mapped(dir: string): [string, string][] {
  const generated = join(dir, "generated")
  const map = JSON.parse(readFileSync(join(generated, "d.d.ts.map"), "utf8")) as {
    sources: string[]
    mappings: string
  }
  const lines = readFileSync(join(generated, "d.d.ts"), "utf8").split("\n")
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  const at = [0, 0, 0]
  return map.mappings.split(";").flatMap((text, line) => {
    if (text === "") return []
    const ends = text.split(",").map((segment) => {
      const values: number[] = []
      let value = 0
      let shift = 0
      for (const char of segment) {
        const digit = digits.indexOf(char)
        value += (digit & 31) << shift
        shift += 5
        if (digit & 32) continue
        values.push(value & 1 ? -(value >> 1) : value >> 1)
        value = 0
        shift = 0
      }
      for (const i of [0, 1, 2]) at[i] = (at[i] ?? 0) + (values[i + 1] ?? 0)
      return [...at]
    })
    const [file = 0, row = 0, col = 0] = ends[0] ?? []
    const [, endRow, endCol] = ends[1] ?? []
    const source =
      readFileSync(join(generated, map.sources[file] ?? ""), "utf8").split("\n")[row] ?? ""
    const name = (lines[line] ?? "").trim().split(":")[0] ?? ""
    return [[name, endRow === row ? source.slice(col, endCol) : `ends on line ${endRow}`]]
  })
}

test("types writes what d is into the model's generated folder, with a map to each name's string; --check says when it is stale", () => {
  const dir = mkdtempSync(here("../tmp-types-"))
  try {
    const model = (above = "") => `import { d, m, t } from "#em"
${above}
m.stream("Notes")
m.command("CaptureNote", { text: t.string() })
m.event(
  "NoteCaptured",
  { noteId: t.uuid(), text: t.string(), at: t.datetime().optional() },
).stream(d.Notes)
m.view("Inbox", { noteId: t.uuid().key(), text: t.string() })
m.view("NoteActivity", t.array({ noteId: t.uuid().key(), what: t.enum(["captured", "filed"]) }))
m.actor("Filer", { icon: "system" })
`
    writeFileSync(join(dir, "index.ts"), model())
    const stale = em("types", "--check", dir)
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /d\.d\.ts: out of date\. Run em types /)
    const wrote = em("types", dir)
    assert.equal(wrote.status, 0, wrote.stderr)
    assert.match(wrote.stdout, /^Wrote .*d\.d\.ts\n$/)
    const text = readFileSync(join(dir, "generated", "d.d.ts"), "utf8")
    for (const member of [
      'CaptureNote: CommandDecl<"CaptureNote", { text: Field<string> }>',
      "Filer: SystemActor",
      'Inbox: ViewDecl<"Inbox", { noteId: Field<string, "uuid", true>; text: Field<string> }, false>',
      'NoteActivity: ViewDecl<"NoteActivity", { noteId: Field<string, "uuid", true>; what: Field<"captured" | "filed"> }, true>',
      'NoteCaptured: EventDecl<"NoteCaptured", { noteId: Field<string, "uuid">; text: Field<string>; at: Field<string | undefined, "datetime"> }>',
      "Notes: Stream",
    ])
      assert.ok(text.includes(`    ${member}\n`), member)
    // Go-to-definition and rename on d.Name land inside the string that declares it.
    const names = ["CaptureNote", "Filer", "Inbox", "NoteActivity", "NoteCaptured", "Notes"]
    assert.deepEqual(
      mapped(dir),
      names.map((n) => [n, n]),
    )
    assert.equal(em("types", "--check", dir).status, 0)
    assert.match(em("types", dir).stdout, /is up to date\.\n$/)
    // A line above moves every string, so the map is stale though the types are not.
    writeFileSync(join(dir, "index.ts"), model("// Notes, captured and filed.\n"))
    assert.equal(em("types", "--check", dir).status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

test("proto with no service warns so, writes nothing, and exits 0: nothing is wrong", () => {
  const dir = mkdtempSync(here("../tmp-proto-"))
  try {
    writeFileSync(
      join(dir, "index.ts"),
      `import { d, m, t } from "#em"

m.command("Start", { id: t.string() })
m.event("Started", { id: t.string() })
m.view("Table", { id: t.string().key() })
m.actor("User")
m.chapter("Ch", 1)
m.slice().command(d.Start).event(d.Started).chapter(d.Ch).spec("starts", { when: d.Start({ id: "1" }), then: [d.Started({ id: "1" })] })
m.slice().view(d.Table).event(d.Started).chapter(d.Ch).actor(d.User).spec("the row shows", { given: d.Started({ id: "1" }), then: d.Table({ id: "1" }) })
export default m.model("x")
`,
    )
    const run = em("proto", dir, "-o", join(dir, "out"))
    assert.equal(run.status, 0)
    assert.match(run.stderr, /^No service: no \.proto written\. Add \.service\(d\.Api\)/)
    assert.ok(!existsSync(join(dir, "out")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A finished Api service; the view has no specification and Loose is in no slice. */
const API_DONE = `import { d, m, t } from "#em"

m.service("Api", "api.v1")
m.command("Start", { id: t.string() })
m.event("Started", { id: t.string() })
m.view("Table", { id: t.string().key() })
m.event("Loose", { id: t.string() })
m.chapter("Ch", 1)
m.slice().command(d.Start).event(d.Started).service(d.Api).chapter(d.Ch).spec("starts", { when: d.Start({ id: "1" }), then: [d.Started({ id: "1" })] })
m.slice().view(d.Table).event(d.Started).chapter(d.Ch)
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

test("proto writes a service with no errors whatever is wrong elsewhere", () => {
  const { run, api } = protoOf(API_DONE)
  assert.equal(run.status, 0, run.stderr)
  assert.match(api ?? "", /rpc Start\(StartRequest\) returns \(StartResponse\);/)
})

test("proto writes a service whose slices only warn: a missing specification holds nothing back", () => {
  const { run, board } = protoOf(
    `${API_DONE}m.service("Board", "board.v1")
m.view("Listing", { id: t.string().key() })
m.slice().view(d.Listing).event(d.Started).service(d.Board, "List").chapter(d.Ch)
`,
  )
  assert.equal(run.status, 0, run.stderr)
  assert.match(board ?? "", /rpc List\(ListRequest\) returns \(ListResponse\);/)
})

test("proto skips a service whose own slice has an error, says why, and exits 1", () => {
  const { run, api, board } = protoOf(
    `${API_DONE}m.service("Board", "board.v1")
m.view("Listing", { id: t.string().key(), name: t.string() })
m.slice().view(d.Listing).event(d.Started).service(d.Board, "List").chapter(d.Ch).spec("lists", { given: d.Started({ id: "1" }), then: d.Listing({ id: "1" }) })
`,
  )
  assert.equal(run.status, 1)
  assert.ok(api)
  assert.equal(board, undefined)
  assert.match(
    run.stderr,
    /Skipped .*board\/v1\/board\.proto: Board has 1 error:\nListing\.name \(Ch › Listing\): no source\./,
  )
})

test("proto never writes a nameless rpc: a state view's service with no method is an error", () => {
  const { run, api, board } = protoOf(
    `${API_DONE}m.service("Board", "board.v1")
m.view("Games", { id: t.string().key() })
m.slice().view(d.Games).event(d.Started).service(d.Board).chapter(d.Ch).spec("lists", { given: d.Started({ id: "1" }), then: d.Games({ id: "1" }) })
`,
  )
  assert.equal(run.status, 1)
  assert.ok(api)
  assert.equal(board, undefined)
  assert.match(
    run.stderr,
    /Skipped .*board\/v1\/board\.proto: Board has 1 error:\nCh › Games: method has no name\. Write \.service\(d\.Board, "ListGames"\)\./,
  )
})

/** `em view`, by default on a free port; resolves once it prints its URL. */
async function view(path: string, port = ["--port", "0"]) {
  const server = spawn(process.execPath, [
    ...NODE_FLAGS,
    here("../bin/em.ts"),
    "view",
    path,
    ...port,
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
    assert.match(server.log(), /^\d\d:\d\d:\d\d Started \(\d+ms\)\. Nothing left to do\.\n/)
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

test("view takes a free port when 5311 is taken, and refuses a taken --port", async () => {
  // Another `em view` may hold 5311 already; either way it is taken. A browser tab left open on
  // 5311 keeps reconnecting, so drop each connection, or closing the server waits for it forever.
  const other = createServer((socket) => socket.destroy())
  await new Promise<void>((resolve) =>
    other.once("error", () => resolve()).listen(5311, "127.0.0.1", resolve),
  )
  try {
    const server = await view(EXAMPLE, [])
    server.close()
    assert.doesNotMatch(server.url, /:5311$/)

    const run = em("view", EXAMPLE, "--port", "5311", "--no-open")
    assert.equal(run.status, 1)
    assert.equal(run.stderr, "Port 5311 is in use.\n")
  } finally {
    other.close()
  }
})

test("view lists a compiler error with what assembly found, until a save fixes it", async () => {
  const dir = mkdtempSync(here("../tmp-check-"))
  const file = join(dir, "index.ts")
  const model = (emits: string) => `import { d, m, t } from "#em"

m.stream("Games")
m.actor("User")
m.service("Chess", "chess.v1")
m.command("StartGame", { gameId: t.string() })
m.event("GameStarted", { gameId: t.string(), white: t.string(), black: t.string() }).stream(d.Games)
m.chapter("Play", 1)
m.slice().command(d.StartGame).event(${emits}).actor(d.User).service(d.Chess).chapter(d.Play)
export default m.model("Chess")
`
  const error =
    "index.ts:9  GameStarted.black: no source. Add black to a step before .event(), or set it in the mapping."
  type Said = { message: string }[]
  const messages = async (url: string) => {
    const feed = (await (await fetch(`${url}/model.json`)).json()) as {
      errors?: Said
      warnings?: Said
    }
    return [...(feed.errors ?? []), ...(feed.warnings ?? [])].map((m) => m.message)
  }
  writeFileSync(file, model("d.GameStarted"))
  const server = await view(dir)
  try {
    assert.match(
      server.log(),
      /\(\d+ms\)\. 2 errors, 2 warnings:\n {2}index\.ts:9 {2}GameStarted\.black: /,
    )
    assert.ok(server.log().includes(`\n  ${error}\n`), server.log())
    assert.ok((await messages(server.url)).includes(error))

    // Saved the way many editors save: a hidden temporary file renamed over the model.
    await reloaded(server.url, () => {
      writeFileSync(
        join(dir, ".!1!index.ts"),
        model('d.GameStarted, () => ({ white: t.literal("me"), black: t.literal("you") })'),
      )
      renameSync(join(dir, ".!1!index.ts"), file)
    })
    assert.ok(!(await messages(server.url)).includes(error))
    const saved = server.log().slice(server.log().indexOf("Saved"))
    assert.ok(saved.startsWith("Saved index.ts ") && !saved.includes(error), server.log())

    // Or a visible one: the save is still the model file's.
    await reloaded(server.url, () => {
      writeFileSync(join(dir, "index.ts.tmp.2.f00d"), readFileSync(file, "utf8"))
      renameSync(join(dir, "index.ts.tmp.2.f00d"), file)
    })
    assert.equal(
      server
        .log()
        .match(/(?:Saved|Deleted) \S+/g)
        ?.at(-1),
      "Saved index.ts",
    )

    await reloaded(server.url, () => writeFileSync(join(dir, "extra.ts"), "export {}\n"))
    await reloaded(server.url, () => rmSync(join(dir, "extra.ts")))
    assert.match(server.log(), /\d Deleted extra\.ts \(/)

    // A save that declares a name types it at once: the load writes generated/d.d.ts, and checks again.
    await reloaded(server.url, () =>
      writeFileSync(
        join(dir, "ending.ts"),
        `import { d, m, t } from "#em"
m.slice("Ender").automation(d.GameStarted).command(d.EndGame).event(d.GameEnded).chapter(d.Play)
m.command("EndGame", { gameId: t.string() })
m.event("GameEnded", { gameId: t.string() }).stream(d.Games)
`,
      ),
    )
    assert.match(readFileSync(join(dir, "generated", "d.d.ts"), "utf8"), /GameEnded: EventDecl/)
    const ended = (await messages(server.url)).filter((m) => m.startsWith("ending.ts"))
    assert.deepEqual(ended, [])
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("view pairs each compiler error with what assembly found about the same event's fields", async () => {
  const dir = mkdtempSync(here("../tmp-pair-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { d, m, t } from "#em"

m.actor("User")
m.service("Chess", "chess.v1")
m.command("StartGame", { gameId: t.string() })
m.event("GameStarted", { gameId: t.string(), white: t.string() })
m.command("Begin", { gameId: t.string() })
m.event("Started", { gameId: t.string(), white: t.string() })
m.chapter("Play", 1)
m.slice().command(d.StartGame).event(d.GameStarted).actor(d.User).service(d.Chess).chapter(d.Play)
m.slice().command(d.Begin).event(d.Started).actor(d.User).service(d.Chess).chapter(d.Play)
export default m.model("Chess")
`,
  )
  const server = await view(dir)
  try {
    const { errors = [] } = (await (await fetch(`${server.url}/model.json`)).json()) as {
      errors?: { message: string; ui?: string; element: string; slice?: string }[]
    }
    assert.deepEqual(
      errors
        .filter((m) => m.message.includes("white"))
        .map((m) => [m.message, m.ui, m.element, m.slice]),
      [
        [
          "index.ts:10  GameStarted.white: no source. Add white to a step before .event(), or set it in the mapping.",
          "Game Started: white has no source",
          "GameStarted",
          "start-game",
        ],
        [
          "index.ts:11  Started.white: no source. Add white to a step before .event(), or set it in the mapping.",
          "Started: white has no source",
          "Started",
          "begin",
        ],
      ],
    )
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("view lists a field the mapping must set: one that does not fit, mapped or by name, or that two steps carry, with a mapping or without", async () => {
  const dir = mkdtempSync(here("../tmp-fit-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { d, m, t } from "#em"

m.stream("Notes")
m.chapter("Capture", 1)
m.event("NoteCaptured", { noteId: t.uuid(), text: t.string() }).stream(d.Notes)
m.command("CaptureNote", { text: t.string() })
m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ noteId: c.CaptureNote.text })).chapter(d.Capture)
m.event("NoteTaken", { noteId: t.uuid(), text: t.string() }).stream(d.Notes)
m.command("TakeNote", { noteId: t.string(), text: t.string() })
m.slice().command(d.TakeNote).event(d.NoteTaken).chapter(d.Capture)
m.external("Wiki")
m.event("PageMade", { noteId: t.uuid() }).external(d.Wiki)
m.command("LinkNote", { noteId: t.uuid() })
m.event("NoteLinked", { noteId: t.uuid() }).stream(d.Notes)
m.slice().command(d.LinkNote).event(d.PageMade).event(d.NoteLinked).chapter(d.Capture)
m.event("NoteFiled", { noteId: t.uuid(), at: t.datetime() }).stream(d.Notes)
m.slice().command(d.LinkNote).event(d.PageMade).event(d.NoteFiled, () => ({ at: m.generate() })).chapter(d.Capture)
m.view("Drafts", { noteId: t.uuid().key(), text: t.string().optional() })
m.command("Publish", { noteId: t.uuid() })
m.event("Published", { noteId: t.uuid(), text: t.string() }).stream(d.Notes)
m.slice().command(d.Publish).query(d.Drafts, "noteId").event(d.Published).chapter(d.Capture)
export default m.model("Notes")
`,
  )
  const server = await view(dir)
  try {
    const { errors = [] } = (await (await fetch(`${server.url}/model.json`)).json()) as {
      errors?: { message: string }[]
    }
    assert.deepEqual(
      errors.filter((m) => m.message.startsWith("index.ts:")).map((m) => m.message),
      [
        "index.ts:7  noteId: doesn't fit. Set it to a field of its type, a t.literal() or m.generate().",
        "index.ts:10  NoteTaken.noteId: doesn't fit. Set it to a field of its type, a t.literal() or m.generate().",
        "index.ts:15  NoteLinked.noteId: comes from LinkNote and PageMade. Set it in the mapping.",
        "index.ts:17  NoteFiled.noteId: comes from LinkNote and PageMade. Set it in the mapping.",
        "index.ts:21  Published.text: doesn't fit. Set it to a field of its type, a t.literal() or m.generate().",
      ],
    )
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("view words what the types refuse as the fix: a query with no filter or two sources, a state view's service with no method, an external event an automation starts with, and what is not a declaration", async () => {
  const dir = mkdtempSync(here("../tmp-fix-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { d, m, t } from "#em"

m.service("Api", "api.v1")
m.chapter("Ch", 1)
m.event("Started", { id: t.string() })
m.command("Finish", { id: t.string() })
m.event("Finished", { id: t.string() })
m.view("Table", { id: t.string().key() })
m.slice().automation(d.Started).query(d.Table).command(d.Finish).event(d.Finished).chapter(d.Ch)
m.slice().view(d.Table).event(d.Started).service(d.Api).chapter(d.Ch)
m.external("Calendar")
m.event("Scheduled", { id: t.string() }).external(d.Calendar)
m.slice().automation(d.Scheduled).command(d.Finish).event(d.Finished).chapter(d.Ch)
m.command("Rename", { id: t.string(), name: t.string() })
m.view("Names", { id: t.string().key(), name: t.string() })
m.view("Titles", { name: t.string().key() })
m.slice().command(d.Rename).query(d.Names, "id").query(d.Titles, "name").event(d.Finished).chapter(d.Ch)
m.slice().command(d.Finish({ id: "1" })).event(d.Finished).chapter(d.Ch)
export default m.model("Fix")
`,
  )
  const server = await view(dir)
  try {
    const { errors = [] } = (await (await fetch(`${server.url}/model.json`)).json()) as {
      errors?: { message: string; ui?: string }[]
    }
    assert.deepEqual(
      errors.filter((m) => m.message.startsWith("index.ts:")).map((m) => [m.message, m.ui]),
      [
        [
          "index.ts:9  Table: say which rows: a column, a mapping, or () => ({}) for every row.",
          "Table: query doesn't say which rows",
        ],
        [
          'index.ts:10  method has no name. Write .service(d.Api, "ListX").',
          "A state view's method has no name",
        ],
        [
          "index.ts:13  Scheduled: comes from outside. Start its slice with .translation(d.Scheduled).",
          "Scheduled: needs a translation",
        ],
        [
          "index.ts:17  Titles.name: comes from Rename and Names. Map it.",
          "Titles: name has two sources",
        ],
        ["index.ts:18  not a declaration. Pass a command as d.Name.", "A step names no element"],
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
    `import { d, m, t } from "#em"

m.event("Received", { id: t.string() }).stream("Inbox")
m.command("Sync", { id: t.string() })
m.event("Synced", { id: t.string() })
m.chapter("Ch", 1)
m.view("Pending", t.array({ id: t.string().key() }))
m.slice().command(d.Sync).query(d.Pending, "id").event(d.Synced).chapter(d.Ch)
m.slice().command(d.Sync).event(d.Synced).spec("syncs", { when: d.Sync({ id: "1" }), then: synced })
const synced = d.Synced({ id: "1" })
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
        "  synced: used above its declaration in index.ts. Move it up.",
        "  index.ts:3  Argument of type 'string' is not assignable to parameter of type 'Stream'.",
        "  index.ts:8  Pending: many rows (the view is a list); only an automation reads many, before its .command().",
        "",
      ].join("\n"),
    )
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a model that stops loading shows the error that stopped it, not the names declared after it", async () => {
  const dir = mkdtempSync(here("../tmp-stop-"))
  writeFileSync(
    join(dir, "index.ts"),
    `import { d, m, t } from "#em"

m.event("Created", { id: t.string() }).spec("creates", { then: [] })
m.command("Create", { id: t.string() })
m.slice().command(d.Create).event(d.Created)
export default m.model("x")
`,
  )
  const server = await view(dir)
  try {
    const log = server.log()
    assert.equal(
      log.slice(log.indexOf("The model didn't load:\n") + 23, log.indexOf("Showing")),
      "  index.ts:3  Property 'spec' does not exist on type 'EventNoted'.\n",
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

test("json prints a storm of events as the timeline, each in a slice of its own, with nothing left to do", () => {
  const storm = here("./fixtures/storm")
  const strict = em("json", storm)
  assert.equal(strict.status, 0, strict.stderr)
  assert.equal(strict.stderr, "")
  const { slices } = JSON.parse(strict.stdout) as {
    slices: { title: string; events: { title: string }[] }[]
  }
  assert.deepEqual(
    slices.map((s) => [s.title, s.events.map((e) => e.title)]),
    [
      ["GameStarted", ["GameStarted"]],
      ["MoveMade", ["MoveMade"]],
      ["GameEnded", ["GameEnded"]],
    ],
  )
  const partial = em("json", "--partial", storm)
  assert.equal(partial.status, 0, partial.stderr)
  assert.deepEqual(JSON.parse(partial.stdout).model, JSON.parse(strict.stdout))
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
          errors?: { message: string }[]
        }
      const valid = await fetched()
      assert.deepEqual([valid.name, valid.model, valid.errors], ["shop", json, undefined])
      await reloaded(server.url, () => {
        json.slices[0].sliceType = "VIEW"
        writeFileSync(file, JSON.stringify(json))
      })
      const broken = await fetched()
      assert.deepEqual(
        broken.errors?.map((m) => m.message),
        [
          "shop.json /slices/0/sliceType: must be equal to one of the allowed values STATE_CHANGE, STATE_VIEW, AUTOMATION, TRANSLATION",
        ],
      )
      assert.match(server.log(), /1 error:\n {2}shop\.json \/slices\/0\/sliceType: /)
    } finally {
      server.close()
    }
    const run = em("export", file, "-o", join(dir, "shop.html"))
    assert.equal(run.status, 0, run.stderr)
    const html = readFileSync(join(dir, "shop.html"), "utf8")
    assert.match(html, /<title>shop<\/title>/)
    assert.match(html, /shop\.json \/slices\/0\/sliceType: must be equal/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
