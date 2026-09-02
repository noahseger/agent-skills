import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { m } from "#em"
import { z } from "zod"

import { assemble, assembleModules } from "../src/assemble.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** `event_model.py validate` over a render target; the failure message is its output. */
function validate(json: unknown): void {
  const file = join(mkdtempSync(join(tmpdir(), "em-")), "model.json")
  writeFileSync(file, JSON.stringify(json))
  const run = spawnSync("python3", [here("../../event_model.py"), "validate", file], { encoding: "utf8" })
  assert.equal(run.status, 0, run.stdout + run.stderr)
}

test("the todo example assembles to the checked-in render target", async () => {
  const json = await assemble(here("../examples/todo-app"))
  assert.deepEqual(json, JSON.parse(readFileSync(here("./todo-app.json"), "utf8")))
})

test("event_model.py accepts the render target", () => {
  validate(JSON.parse(readFileSync(here("./todo-app.json"), "utf8")))
})

// --- Assembly errors. Each fixture is the smallest model that trips one. -----

function fixture() {
  const User = m.actor()
  const Svc = m.service("t.v1")
  const Create = m.command({ id: z.string(), name: z.string() })
  const Created = m.event({ id: z.string(), name: z.string() })
  const Table = m.readModel({ id: m.key(z.string()), name: z.string() })
  return { User, Svc, Create, Created, Table }
}
type Fixture = ReturnType<typeof fixture>

const create = (f: Fixture) => m.slice().actor(f.User).service(f.Svc).command(f.Create).emits(f.Created)
const project = (f: Fixture) => m.slice().projects(f.Table).on(f.Created)
const projectTable = project
const view = (f: Fixture) => m.slice().actor(f.User).reads(f.Table).service(f.Svc, "Get")

/** One module exporting `exports` and a model of one chapter, `Ch`. */
function assembled(exports: Record<string, unknown>, slices: Parameters<typeof m.chapter>[0]) {
  const Ch = m.chapter(slices)
  return assembleModules([{ ...exports, Ch, default: m.model("x", { chapters: [Ch] }) }])
}

test("a well-formed model assembles", () => {
  const f = fixture()
  const json = assembled(f, [create(f), project(f), view(f)])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.name),
    ["Create", "Table", "Get"],
  )
  assert.deepEqual(json.aggregates, [{ id: "events", name: "Events" }])
  validate(json)
})

test("a declaration used in a slice that no module exports", () => {
  const { Created, ...f } = fixture()
  assert.throws(
    () => assembled(f, [create({ ...f, Created }), project({ ...f, Created }), view({ ...f, Created })]),
    /slice #1 in 'Ch' uses an event that no module exports/,
  )
})

test("a declaration exported under two names", () => {
  const f = fixture()
  assert.throws(
    () => assembled({ ...f, Also: f.Created }, [create(f), project(f), view(f)]),
    /'Created' is also exported as 'Also'/,
  )
})

test("an event field the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  assert.throws(
    () => assembled({ ...f, Created }, [create({ ...f, Created }), project({ ...f, Created }), view(f)]),
    /slice 'Create' in 'Ch': Created\.extra is filled by nothing\. Create does not carry it and no function sets it/,
  )
})

test("a mapping function fills what the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const slice = m
    .slice()
    .actor(f.User)
    .service(f.Svc)
    .command(f.Create)
    .emits(Created, (c) => ({ extra: c.name }))
  const json = assembled({ ...f, Created }, [slice, project({ ...f, Created }), view(f)])
  assert.deepEqual(json.chapters[0]?.slices[0]?.mapping, { Created: { extra: { from: "name" } } })
  assert.equal(json.chapters[0]?.slices[0]?.command, "Create(id, name, extra)")
  validate(json)
})

test("a column no .on() writes", () => {
  const f = fixture()
  const Table = m.readModel({ id: m.key(z.string()), name: z.string(), count: z.number() })
  assert.throws(
    () => assembled({ ...f, Table }, [create(f), project({ ...f, Table }), view({ ...f, Table })]),
    /slice 'Table' in 'Ch': Table\.count is filled by nothing\. No \.on\(\) writes it/,
  )
})

test("an event that carries none of the read model's key columns", () => {
  const f = fixture()
  const Rename = m.command({ name: z.string() })
  const Renamed = m.event({ name: z.string() })
  const rename = m.slice().actor(f.User).service(f.Svc).command(Rename).emits(Renamed)
  const projection = m.slice().projects(f.Table).on(f.Created).on(Renamed)
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, [create(f), rename, projection, view(f)]),
    /slice 'Table' in 'Ch': Renamed carries none of Table's key columns \(id\)/,
  )
})

test("an event nothing consumes", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [create(f)]),
    /slice 'Create' in 'Ch' emits Created, which nothing consumes: no \.on\(\) and no given/,
  )
})

test("an event no slice emits", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [project(f), view(f)]),
    /slice 'Table' in 'Ch' uses Created, which no slice emits/,
  )
})

test("a read model nothing reads", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [create(f), project(f)]),
    /slice 'Table' in 'Ch' projects Table, which nothing reads/,
  )
})

test("a read model nothing projects", () => {
  const f = fixture()
  const created = f.Created.with({ id: "1", name: "n" })
  const slice = create(f).test("t", { given: created, when: f.Create.with({ id: "1", name: "n" }), then: created })
  assert.throws(
    () => assembled(f, [slice, view(f)]),
    /slice 'Get' in 'Ch' reads Table, which nothing projects/,
  )
})

test("a slice that emits an external event", () => {
  const f = fixture()
  const Pushed = m.event({ id: z.string(), name: z.string() })
  const Cal = m.external({ Pushed })
  const slice = m.slice().actor(f.User).service(f.Svc).command(f.Create).emits(Pushed)
  assert.throws(
    () => assembled({ ...f, Pushed, Cal }, [slice]),
    /slice 'Create' in 'Ch' emits Pushed, an event of Cal\. External events are translated, never emitted/,
  )
})

test("two slices claiming one service method", () => {
  const f = fixture()
  const Rename = m.command({ id: z.string(), name: z.string() })
  const Renamed = m.event({ id: z.string(), name: z.string() })
  const rename = m.slice().actor(f.User).service(f.Svc, "Create").command(Rename).emits(Renamed)
  const projection = m.slice().projects(f.Table).on(f.Created).on(Renamed)
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, [create(f), rename, projection, view(f)]),
    /slice 'Create' in 'Ch' and slice 'Rename' in 'Ch' both claim Svc\/Create/,
  )
})

// --- Encodings the render target has no native word for ----------------------

test("a .polls() automation has the read model as its trigger", () => {
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m.slice("Processor").polls(f.Table).command(Process).emits(Processed)
  const projection = m.slice().projects(f.Table).on(f.Created).on(Processed)
  const json = assembled({ ...f, Process, Processed }, [create(f), processor, projection])
  const slice = json.chapters[0]?.slices[1]
  assert.equal(slice?.automation, "Processor")
  assert.equal(slice?.trigger, "Table*(*id, name)")
  assert.equal(slice?.polls, "Table")
  validate(json)
})

test("same-named streams from two modules are one lane", () => {
  const f = fixture()
  const Ch = m.chapter([create(f), project(f), view(f)])
  const json = assembleModules([
    { ...f, Ch, default: m.model("x", { chapters: [Ch] }) },
    { Inventory: m.stream({ Create: f.Create }) },
    { Inventory: m.stream({ Created: f.Created }) },
  ])
  assert.deepEqual(json.aggregates, [{ id: "inventory", name: "Inventory" }])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.aggregate),
    ["inventory", "inventory", "inventory"],
  )
})

test("a slice may read more than one read model", () => {
  const f = fixture()
  const Other = m.readModel({ id: m.key(z.string()), count: z.number() })
  const view = m.slice().actor(f.User).reads(f.Table).reads(Other).service(f.Svc, "Both")
  const project = m.slice().projects(Other).on(f.Created, () => ({ count: 0 }))
  const json = assembled({ ...f, Other }, [create(f), projectTable(f), project, view])
  assert.deepEqual(
    json.chapters[0]?.slices.at(-1)?.read_models?.map((r) => r.match(/^\w+/)?.[0]),
    ["Table", "Other"],
  )
})

test("a read model in given is named as one", () => {
  const f = fixture()
  const row = f.Table.with({ id: "1", name: "n" })
  const slice = create(f).test("t", {
    // @ts-expect-error a read model is not an event
    given: row,
    when: f.Create.with({ id: "1", name: "n" }),
    then: f.Created.with({ id: "1", name: "n" }),
  })
  assert.throws(
    () => assembled(f, [slice, project(f), view(f)]),
    /slice 'Create' in 'Ch' gives Table, a read model; given takes events\./,
  )
})
