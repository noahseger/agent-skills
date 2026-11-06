import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { m, type Slice } from "#em"

import { assemble, assembleModules, load } from "../src/assemble.ts"
import { layout } from "../viewer/src/layout.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** `event_model.py validate` over a render target; the failure message is its output. */
function validate(json: unknown): void {
  const file = join(mkdtempSync(join(tmpdir(), "em-")), "model.json")
  writeFileSync(file, JSON.stringify(json))
  const run = spawnSync("python3", [here("../../event_model.py"), "validate", file], {
    encoding: "utf8",
  })
  assert.equal(run.status, 0, run.stdout + run.stderr)
}

test("the todo example assembles to the checked-in render target", async () => {
  const json = await assemble(here("../examples/todo-app"))
  assert.deepEqual(json, JSON.parse(readFileSync(here("./todo-app.json"), "utf8")))
})

test("load returns the named model the generators read", async () => {
  const { model } = await load(here("../examples/todo-app"))
  const first = model.chapters[0]?.slices[0]
  assert.deepEqual(
    [model.name, first?.name, first?.service?.service.name, first?.service?.service.pkg],
    ["Todo List Application", "CreateList", "TodoService", "todo.v1"],
  )
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

const list = { id: "list-1", name: "Groceries" }
const unspecified = (f: Fixture) =>
  m.slice().command(f.Create).event(f.Created).actor(f.User).service(f.Svc)
const create = (f: Fixture) =>
  unspecified(f).test("A list is created", { when: f.Create(list), then: f.Created(list) })
const project = (f: Fixture) => m.slice().projection(f.Table).event(f.Created)
const projectTable = project
const view = (f: Fixture) => m.slice().view(f.Table).actor(f.User).service(f.Svc, "Get")

/** One module exporting `exports` and a model of one chapter, `Ch`. */
function assembled(exports: Record<string, unknown>, slices: readonly Slice[]) {
  return assembleModules([{ ...exports, default: m.model("x", { chapters: { Ch: slices } }) }])
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
    () =>
      assembled(f, [
        create({ ...f, Created }),
        project({ ...f, Created }),
        view({ ...f, Created }),
      ]),
    /Ch › slice 1: this slice uses an event that isn't exported\. Export it to give it a name\./,
  )
})

test("a declaration exported under two names", () => {
  const f = fixture()
  assert.throws(
    () => assembled({ ...f, Also: f.Created }, [create(f), project(f), view(f)]),
    /Created is exported twice, also as Also\. Keep one\./,
  )
})

test("an event field the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  assert.throws(
    () =>
      assembled({ ...f, Created }, [
        unspecified({ ...f, Created }),
        project({ ...f, Created }),
        view(f),
      ]),
    /Ch › Create: Created\.extra has no value\. Add extra to Create, or set it in the mapping\./,
  )
})

test("a model still being written draws with a field that has no value", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const Ch = [unspecified({ ...f, Created })]
  const json = assembleModules([{ ...f, Created, default: m.model("x", { chapters: { Ch } }) }], {
    partial: true,
  })
  assert.equal(json.chapters[0]?.slices.length, 1)
  assert.ok(json.warnings?.some((w) => w.message.includes("Created.extra has no value")))
})

test("a mapping function fills what the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const slice = m
    .slice()
    .command(f.Create)
    .event(Created((c) => ({ extra: c.name })))
    .actor(f.User)
    .service(f.Svc)
    .test("A list is created", {
      when: f.Create(list),
      then: Created({ ...list, extra: "Groceries" }),
    })
  const json = assembled({ ...f, Created }, [slice, project({ ...f, Created }), view(f)])
  assert.deepEqual(json.chapters[0]?.slices[0]?.mapping, { Created: { extra: { from: "name" } } })
  assert.equal(json.chapters[0]?.slices[0]?.command, "Create(id, name)")
  validate(json)
})

test("generate() fills a field the handler assigns, and a specification gives it any value", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), at: z.string() })
  const slice = m
    .slice()
    .command(f.Create)
    .event(Created((_, { generate }) => ({ at: generate() })))
    .actor(f.User)
    .service(f.Svc)
    .test("Create", {
      when: f.Create({ id: "id-1", name: "Groceries" }),
      then: Created({ id: "id-1", name: "Groceries", at: "2026-01-01T00:00:00Z" }),
    })
  const json = assembled({ ...f, Created }, [slice, project({ ...f, Created }), view(f)])
  assert.deepEqual(json.chapters[0]?.slices[0]?.mapping, { Created: { at: { generate: true } } })
  validate(json)
})

test("a column no .event() writes", () => {
  const f = fixture()
  const Table = m.readModel({ id: m.key(z.string()), name: z.string(), count: z.number() })
  assert.throws(
    () => assembled({ ...f, Table }, [create(f), project({ ...f, Table }), view({ ...f, Table })]),
    /Ch › Table: Table\.count has no value\. Add \.event\(\) for an event that carries count, or set it in a mapping\./,
  )
})

test("an event that carries none of the read model's key columns", () => {
  const f = fixture()
  const Rename = m.command({ name: z.string() })
  const Renamed = m.event({ name: z.string() })
  const rename = m
    .slice()
    .command(Rename)
    .event(Renamed)
    .actor(f.User)
    .service(f.Svc)
    .test("A list is renamed", {
      when: Rename({ name: "Chores" }),
      then: Renamed({ name: "Chores" }),
    })
  const projection = m.slice().projection(f.Table).event(f.Created).event(Renamed)
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, [create(f), rename, projection, view(f)]),
    /Ch › Table: Renamed doesn't say which Table row it changes\. Give it a key field \(id\), or set one in its mapping\./,
  )
})

test("an event nothing consumes", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [create(f)]),
    /Ch › Create: nothing uses Created yet\. Add \.trigger\(Created\) or a projection's \.event\(Created\) where something reacts to it\./,
  )
})

test("an event no slice emits", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [project(f), view(f)]),
    /Ch › Table: nothing emits Created yet\. Add \.event\(Created\) to the slice that causes it\./,
  )
})

test("a read model nothing reads", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [create(f), project(f)]),
    /Ch › Table: nothing reads Table yet\. Add \.readModel\(Table\), \.view\(Table\) or \.todoList\(Table\) where it's needed\./,
  )
})

test("a read model nothing projects", () => {
  const f = fixture()
  const created = f.Created({ id: "1", name: "n" })
  const slice = create(f).test("t", {
    given: created,
    when: f.Create({ id: "1", name: "n" }),
    then: created,
  })
  assert.throws(
    () => assembled(f, [slice, view(f)]),
    /Ch › Get: nothing fills Table yet\. Add a slice with \.projection\(Table\)\./,
  )
})

// A call to a system we do not own: our command, then the system's event with what it sent back.
function call() {
  const f = fixture()
  const Remote = m.external({
    Answered: m.event({ id: z.string(), name: z.string(), detail: z.string() }),
  })
  const Ask = m.command({ id: z.string() })
  const ask = m.slice().command(Ask).event(Remote.Answered).actor(f.User).service(f.Svc)
  return { f, Remote, Ask, ask }
}

/** `call()` with a specification that shows its answer. */
function specifiedCall() {
  const { ask, ...rest } = call()
  const specified = ask.test("The remote system answers", {
    when: rest.Ask({ id: "list-1" }),
    then: rest.Remote.Answered({ ...list, detail: "Two aisles over" }),
  })
  return { ...rest, specified }
}

test("a call ends in the external event, whose fields come from outside", () => {
  const { f, Remote, Ask, specified } = specifiedCall()
  const keep = m
    .slice()
    .trigger(Remote.Answered)
    .command(f.Create)
    .event(f.Created)
    .test("The answer is kept", { when: f.Create(list), then: f.Created(list) })
  const json = assembled({ ...f, Remote, Ask }, [specified, keep, project(f), view(f)])
  const [asked] = json.chapters[0]?.slices ?? []
  assert.deepEqual(asked?.calls, [{ actor: "remote", event: "Answered(id, name, detail)" }])
  assert.equal(asked?.events, undefined)
  validate(json)
})

test("an external event a call ends in that nothing triggers on", () => {
  const { f, Remote, Ask, specified } = specifiedCall()
  const json = assembleModules(
    [
      {
        Remote,
        Ask,
        User: f.User,
        Svc: f.Svc,
        default: m.model("x", { chapters: { Ch: [specified] } }),
      },
    ],
    { partial: true },
  )
  assert.deepEqual(json.warnings, [
    {
      message:
        "Ch › Ask: nothing uses Answered yet. Add .trigger(Answered) or a projection's .event(Answered) where something reacts to it.",
      element: "Answered",
      slice: "Ask",
    },
  ])
})

// A command's events are alternatives; a specification says when each happens.
function outcomes() {
  const f = fixture()
  const Refused = m.event({ id: z.string() })
  const slice = m
    .slice()
    .command(f.Create)
    .event(f.Created)
    .event(Refused)
    .actor(f.User)
    .service(f.Svc)
  const created = slice.test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const project = m.slice().projection(f.Table).event(f.Created).event(Refused)
  const model = (create: Slice) => ({
    ...f,
    Refused,
    default: m.model("x", { chapters: { Ch: [create, project, view(f)] } }),
  })
  return { f, Refused, created, model }
}

test("an outcome no specification shows is left to do, and an error when strict", () => {
  const { created, model } = outcomes()
  const message =
    "Ch › Create: no specification shows Refused yet. Add a .test whose then has Refused(...)."
  const json = assembleModules([model(created)], { partial: true })
  assert.deepEqual(json.warnings, [{ message, element: "Refused", slice: "Create" }])
  assert.throws(() => assembleModules([model(created)]), { message })
})

test("a specification whose then has the outcome finishes it", () => {
  const { f, Refused, created, model } = outcomes()
  const refused = created.test("A second list with the same name is refused", {
    given: f.Created(list),
    when: f.Create(list),
    then: Refused({ id: "list-1" }),
  })
  validate(assembleModules([model(refused)]))
})

test("an external event a call ends in is an outcome", () => {
  const { f, Remote, Ask, ask } = call()
  const json = assembleModules(
    [{ Remote, Ask, User: f.User, Svc: f.Svc, default: m.model("x", { chapters: { Ch: [ask] } }) }],
    { partial: true },
  )
  assert.ok(
    json.warnings?.some(
      (w) => w.element === "Answered" && w.message.includes("no specification shows Answered"),
    ),
  )
})

test("two slices claiming one service method", () => {
  const f = fixture()
  const Rename = m.command({ id: z.string(), name: z.string() })
  const Renamed = m.event({ id: z.string(), name: z.string() })
  const rename = m
    .slice()
    .command(Rename)
    .event(Renamed)
    .actor(f.User)
    .service(f.Svc, "Create")
    .test("A list is renamed", { when: Rename(list), then: Renamed(list) })
  const projection = m.slice().projection(f.Table).event(f.Created).event(Renamed)
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, [create(f), rename, projection, view(f)]),
    /Ch › Rename: Svc\/Create is already used by Ch › Create\. Name this one/,
  )
})

test("slices without a service claim no method", () => {
  const f = fixture()
  const again = m
    .slice()
    .command(f.Create)
    .event(f.Created)
    .actor(f.User)
    .test("A list is created again", { when: f.Create(list), then: f.Created(list) })
  const json = assembled(f, [create(f), again, project(f), view(f)])
  assert.equal(json.chapters[0]?.slices[1]?.ui, "Create")
})

test("an automation's command field its trigger does not carry", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string() })
  // @ts-expect-error the compiler refuses it too; assembly holds for a model run unchecked
  const processor = m.slice("Processor").trigger(f.Created).command(Process).event(Processed)
  assert.throws(
    () => assembled({ ...f, Process, Processed }, [create(f), processor]),
    /Ch › Processor: Process\.label has no value\. Add label to Created, or set it in the mapping\./,
  )
})

test("an automation's mapping fills its command from the trigger", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .trigger(f.Created)
    .command(Process((e) => ({ label: e.name })))
    .event(Processed)
    .test("A created list is processed", {
      when: Process({ id: "list-1", label: "Groceries" }),
      then: Processed({ id: "list-1" }),
    })
  const projection = m.slice().projection(f.Table).event(f.Created).event(Processed)
  const json = assembled({ ...f, Process, Processed }, [create(f), processor, projection, view(f)])
  assert.deepEqual(json.chapters[0]?.slices[1]?.mapping, { Process: { label: { from: "name" } } })
  validate(json)
})

test("a view without a service is named by its read model and has a screen", () => {
  const f = fixture()
  const Ch = [create(f), project(f), m.slice().view(f.Table).actor(f.User)]
  const json = assembled(f, Ch)
  const slice = json.chapters[0]?.slices[2]
  assert.deepEqual([slice?.name, slice?.ui], ["Table", "Table"])
  validate(json)
})

test("a slice with no actor has no screen", () => {
  const f = fixture()
  const create = m
    .slice()
    .command(f.Create)
    .event(f.Created)
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const Ch = [create, project(f), m.slice().view(f.Table)]
  const json = assembled({ Create: f.Create, Created: f.Created, Table: f.Table }, Ch)
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.ui),
    [undefined, undefined, undefined],
  )
  assert.deepEqual(json.warnings, undefined)
})

test("a slice with several actors draws a screen in each one's lane", () => {
  const f = fixture()
  const Admin = m.actor({ icon: "admin" })
  const both = m
    .slice()
    .command(f.Create)
    .event(f.Created)
    .actor(f.User, Admin)
    .service(f.Svc)
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const json = assembled({ ...f, Admin }, [both, project(f), view(f)])
  const slice = json.chapters[0]?.slices[0]
  assert.deepEqual([slice?.actor, slice?.actors], ["user", ["user", "admin"]])
  validate(json)
  const { boxes, rows } = layout(json)
  const lanes = boxes
    .filter((b) => b.kind === "ui" && b.column === 0)
    .map((b) => rows.find((r) => b.y >= r.y && b.y < r.y + r.h)?.id)
  assert.deepEqual(lanes, ["actor:user", "actor:admin"])
})

// --- What the render target reads natively, and what it encodes ---------------

test("a .todoList() automation polls the read model", () => {
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .todoList(f.Table)
    .command(Process)
    .event(Processed)
    .test("A listed row is processed", {
      when: Process({ id: "list-1" }),
      then: Processed({ id: "list-1" }),
    })
  const projection = m.slice().projection(f.Table).event(f.Created).event(Processed)
  const json = assembled({ ...f, Process, Processed }, [create(f), processor, projection])
  const slice = json.chapters[0]?.slices[1]
  assert.equal(slice?.automation, "Processor")
  assert.equal(slice?.trigger, undefined)
  assert.equal(slice?.polls, "Table")
  validate(json)
})

test("same-named streams from two modules are one lane", () => {
  const f = fixture()
  const [Inventory, Stock] = [m.stream(), m.stream()]
  f.Created.stream(Inventory)
  const Recounted = m.event({ id: z.string() }).stream(Stock)
  const Ch = [create(f), project(f), view(f)]
  const json = assembleModules(
    [
      { ...f, default: m.model("x", { chapters: { Ch } }) },
      { Inventory },
      { Inventory: Stock, Recounted },
    ],
    { partial: true },
  )
  assert.deepEqual(json.aggregates, [{ id: "inventory", name: "Inventory" }])
  assert.equal(json.chapters[0]?.slices[0]?.aggregate, "inventory")
  assert.equal(json.loose?.[0]?.aggregate, "inventory")
})

test("a stream no event joins is an empty lane", () => {
  const f = fixture()
  const Inventory = m.stream()
  f.Created.stream(Inventory)
  const json = assembled({ ...f, Inventory, Returns: m.stream() }, [create(f), project(f), view(f)])
  assert.deepEqual(json.aggregates, [
    { id: "inventory", name: "Inventory" },
    { id: "returns", name: "Returns" },
  ])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.aggregate),
    ["inventory", "inventory", "inventory"],
  )
  const rows = layout(json).rows.filter((r) => r.kind === "stream")
  assert.deepEqual(
    rows.map((r) => r.id),
    ["stream:inventory", "stream:returns"],
  )
})

test("two projection slices of one read model fill each other's columns", () => {
  const f = fixture()
  const Table = m.readModel({ id: m.key(z.string()), name: z.string(), status: z.string() })
  const Archive = m.command({ id: z.string() })
  const Archived = m.event({ id: z.string() })
  const archive = m
    .slice()
    .command(Archive)
    .event(Archived)
    .actor(f.User)
    .service(f.Svc)
    .test("A list is archived", {
      when: Archive({ id: "list-1" }),
      then: Archived({ id: "list-1" }),
    })
  const json = assembleModules([
    { ...f, Table, Archive, Archived },
    {
      default: m.model("x", {
        chapters: {
          Capture: [
            create(f),
            m
              .slice()
              .projection(Table)
              .event(f.Created(() => ({ status: "open" }))),
          ],
          Tidy: [
            archive,
            m
              .slice()
              .projection(Table)
              .event(Archived(() => ({ status: "archived" }))),
            view({ ...f, Table }),
          ],
        },
      }),
    },
  ])
  assert.deepEqual(
    json.chapters.map((c) => c.slices.map((s) => s.name)),
    [
      ["Create", "Table"],
      ["Archive", "Table", "Get"],
    ],
  )
})

test("a column neither projection slice writes is reported once, at the first", () => {
  const f = fixture()
  const Table = m.readModel({ id: m.key(z.string()), name: z.string(), status: z.string() })
  const Ch = [create(f), project({ ...f, Table }), project({ ...f, Table })]
  const json = assembleModules([{ ...f, Table, default: m.model("x", { chapters: { Ch } }) }], {
    partial: true,
  })
  assert.deepEqual(
    json.warnings?.map((w) => w.message),
    [
      "Ch › Table: Table.status has no value. Add .event() for an event that carries status, or set it in a mapping.",
      "Ch › Table: nothing reads Table yet. Add .readModel(Table), .view(Table) or .todoList(Table) where it's needed.",
    ],
  )
})

test("a single file written top to bottom extends an earlier read model in a later chapter", async () => {
  const json = await assemble(here("./fixtures/top-to-bottom.ts"))
  assert.equal(json.warnings, undefined)
  assert.equal(json.loose, undefined)
  assert.deepEqual(
    json.aggregates.map((a) => a.id),
    ["notes"],
  )
  validate(json)
})

test("a view may show more than one read model", () => {
  const f = fixture()
  const Other = m.readModel({ id: m.key(z.string()), count: z.number() })
  const view = m.slice().view(f.Table, Other).actor(f.User).service(f.Svc, "Both")
  const project = m
    .slice()
    .projection(Other)
    .event(f.Created(() => ({ count: 0 })))
  const json = assembled({ ...f, Other }, [create(f), projectTable(f), project, view])
  assert.deepEqual(
    json.chapters[0]?.slices.at(-1)?.read_models?.map((r) => r.match(/^\w+/)?.[0]),
    ["Table", "Other"],
  )
})

test("a read model in given is named as one", () => {
  const f = fixture()
  const row = f.Table({ id: "1", name: "n" })
  const slice = create(f).test("t", {
    // @ts-expect-error a read model is not an event
    given: row,
    when: f.Create({ id: "1", name: "n" }),
    then: f.Created({ id: "1", name: "n" }),
  })
  assert.throws(
    () => assembled(f, [slice, project(f), view(f)]),
    /Ch › Create: Table in given is a read model\. given lists events that already happened\./,
  )
})

test("a declaration in no slice is an error", () => {
  const f = fixture()
  const Loose = m.event({ id: z.string() })
  assert.throws(
    () => assembled({ ...f, Loose }, [create(f), project(f), view(f)]),
    /Loose isn't in a slice yet\./,
  )
})

test("a partial assembly lists the dead ends and keeps the loose declarations in stream order", () => {
  const f = fixture()
  const Games = m.stream()
  const Started = m.event({ id: z.string() }).stream(Games)
  const Ended = m.event({ id: z.string() }).stream(Games)
  const Ch = [create(f)]
  const json = assembleModules(
    [{ ...f, Ended, Started, Games, default: m.model("x", { chapters: { Ch } }) }],
    { partial: true },
  )
  assert.deepEqual(json.warnings, [
    {
      message:
        "Ch › Create: nothing uses Created yet. Add .trigger(Created) or a projection's .event(Created) where something reacts to it.",
      element: "Created",
      slice: "Create",
    },
    { message: "Started isn't in a slice yet.", element: "Started" },
    { message: "Ended isn't in a slice yet.", element: "Ended" },
    { message: "Table isn't in a slice yet.", element: "Table" },
  ])
  assert.deepEqual(json.loose, [
    { kind: "event", element: "Started(id)", aggregate: "games" },
    { kind: "event", element: "Ended(id)", aggregate: "games" },
    { kind: "readModel", element: "Table(*id, name)", aggregate: "games" },
  ])
})

test("an actor in no slice is still one of the model's actors", () => {
  const f = fixture()
  const Bartender = m.actor()
  const Ch = [create(f)]
  const json = assembleModules([{ ...f, Bartender, default: m.model("x", { chapters: { Ch } }) }], {
    partial: true,
  })
  assert.deepEqual(
    json.actors.map((a) => a.id),
    ["user", "bartender"],
  )
})

test("an event declared inside m.external is named by its key and drawn in the system's lane", () => {
  const Calendar = m.external({
    Authenticated: m.event({ accessToken: z.string() }),
    TaskMoved: m.event({ taskId: z.string() }),
  })
  const Connect = m.command({ accessToken: z.string() })
  const Connected = m.event({ accessToken: z.string() })
  const Ch = [m.slice().trigger(Calendar.Authenticated).command(Connect).event(Connected)]
  const json = assembleModules(
    [{ Calendar, Connect, Connected, default: m.model("x", { chapters: { Ch } }) }],
    { partial: true },
  )
  assert.equal(json.chapters[0]?.slices[0]?.external_event, "Authenticated(accessToken)")
  assert.deepEqual(json.loose, [
    { kind: "external", element: "TaskMoved(taskId)", aggregate: "events", actor: "calendar" },
  ])
})

// --- Slices in no chapter, and declarations written in place ------------------

test("a slice in no chapter is drawn after the story, finished or not", () => {
  const f = fixture()
  const base = m.slice().command(f.Create)
  base.event(f.Created).actor(f.User)
  base.event("Renamed", { id: z.string(), name: z.string() }).service(f.Svc)
  m.slice().projection(f.Table)
  const json = assembleModules([{ ...f, default: m.model("x") }], { partial: true })
  // The shared prefix is not a slice of its own.
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [["", ["Create", "Create", "Table"]]],
  )
  assert.deepEqual(
    json.warnings?.filter((w) => w.message.endsWith("isn't in a chapter yet.")),
    ["Create", "Create", "Table"].map((name) => ({
      message: `${name} isn't in a chapter yet.`,
      element: "",
      slice: name,
    })),
  )
})

test("a slice in no chapter is an error", () => {
  const f = fixture()
  view(f)
  assert.throws(() => assembled(f, [create(f), project(f)]), /Get isn't in a chapter yet\./)
})

test("an assembly sees only the slices written since the last one", () => {
  const f = fixture()
  create(f)
  const first = assembleModules([{ ...f, default: m.model("x") }], { partial: true })
  assert.equal(first.chapters[0]?.slices.length, 1)
  const second = assembleModules([{ ...f, default: m.model("x") }], { partial: true })
  assert.deepEqual(second.chapters, [])
})

test("loading a model from files sees only the slices its modules write", async () => {
  const f = fixture()
  create(f)
  const { unchaptered } = await load(here("./fixtures/storming"), { partial: true })
  assert.deepEqual(
    unchaptered.map((s) => [s.name, s.events.map((e) => e.decl.name)]),
    [["CreateNote", ["NoteCreated"]]],
  )
})

test("a command and event declared in place are drawn and checked like exported ones", () => {
  const f = fixture()
  const rename = m
    .slice()
    .command("Rename", { id: z.string(), name: z.string() })
    .event("Renamed", { id: z.string(), name: z.string() })
    .actor(f.User)
    .service(f.Svc)
  const json = assembleModules(
    [
      {
        ...f,
        default: m.model("x", { chapters: { Ch: [create(f), rename, project(f), view(f)] } }),
      },
    ],
    { partial: true },
  )
  const slice = json.chapters[0]?.slices[1]
  assert.deepEqual(
    [slice?.ui, slice?.command, slice?.events],
    ["Svc/Rename", "Rename(id, name)", ["Renamed(id, name)"]],
  )
  assert.deepEqual(json.warnings, [
    {
      message:
        "Ch › Rename: no specification shows Renamed yet. Add a .test whose then has Renamed(...).",
      element: "Renamed",
      slice: "Rename",
    },
    {
      message:
        "Ch › Rename: nothing uses Renamed yet. Add .trigger(Renamed) or a projection's .event(Renamed) where something reacts to it.",
      element: "Renamed",
      slice: "Rename",
    },
  ])
})

test("a name declared twice", () => {
  const f = fixture()
  const again = m
    .slice()
    .command(f.Create)
    .event("Created", { id: z.string() })
    .actor(f.User)
    .service(f.Svc, "Again")
  assert.throws(
    () => assembled(f, [create(f), again, project(f), view(f)]),
    /Created is declared twice\. Keep one and use it in both places\./,
  )
  const twice = (method: string) =>
    m
      .slice()
      .command("Rename", { id: z.string(), name: z.string() })
      .event(f.Created)
      .actor(f.User)
      .service(f.Svc, method)
  assert.throws(
    () => assembled(f, [twice("A"), twice("B")]),
    /Rename is declared twice\. Keep one and use it in both places\./,
  )
})

test("an external system declared in two modules names both", async () => {
  await assert.rejects(
    load(here("./fixtures/external-twice"), { partial: true }),
    /^Error: Mail is declared in both calendar\.ts and inbox\.ts\. Keep one and import it in the other\.$/,
  )
})

test("a trigger nothing emits yet is drawn on its own", () => {
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const Ch = [m.slice("Processor").trigger(f.Created).command(Process).event(Processed)]
  const json = assembleModules(
    [{ ...f, Process, Processed, default: m.model("x", { chapters: { Ch } }) }],
    { partial: true },
  )
  assert.deepEqual(
    json.loose?.find((l) => l.element.startsWith("Created")),
    { kind: "event", element: "Created(id, name)", aggregate: "events" },
  )
  const { boxes, edges } = layout(json)
  const id = (name: string) => boxes.find((b) => b.name === name)?.id
  assert.ok(edges.some((e) => e.from === id("Created") && e.to === id("Processor")))
})

test("an example's nested values are printed", () => {
  const f = fixture()
  const Order = m.command({ id: z.string(), items: z.array(z.object({ name: z.string() })) })
  const Ordered = m.event({ id: z.string(), items: z.array(z.object({ name: z.string() })) })
  const slice = m
    .slice()
    .command(Order)
    .event(Ordered)
    .actor(f.User)
    .service(f.Svc)
    .test("t", {
      when: Order({ id: "1", items: [{ name: "a" }, { name: "b" }] }),
      then: Ordered({ id: "1", items: [{ name: "a" }] }),
    })
  const json = assembleModules(
    [{ Order, Ordered, ...f, default: m.model("x", { chapters: { Ch: [slice] } }) }],
    { partial: true },
  )
  const t = json.chapters[0]?.slices[0]?.tests[0]
  assert.deepEqual(
    [t?.when, t?.then],
    ["Order(id=1, items=[{name=a}, {name=b}])", ["Ordered(id=1, items=[{name=a}])"]],
  )
})
