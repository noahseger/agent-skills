import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { t } from "#em"

import {
  type Feed,
  assemble as feedAt,
  assembleModules as feedOf,
  load,
  loadModules,
} from "../src/assemble.ts"
import { toFeed } from "../src/spec.ts"
import { validate } from "../src/validate.ts"
import { layout } from "../viewer/src/layout.ts"
import { read } from "../viewer/src/read.ts"
import { type C, d, m } from "./loose.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** What the viewer draws, once the spec JSON under it validates. */
function drawn(feed: Feed) {
  assert.deepEqual(validate(feed.model), [])
  return read(feed)
}
const assembleModules = (...args: Parameters<typeof feedOf>) => drawn(feedOf(...args))
const assemble = async (...args: Parameters<typeof feedAt>) => drawn(await feedAt(...args))

// A module runs once per process, so each example is loaded once, one after the other.
const todoApp = await load(here("../examples/todo-app"))
const otbChess = await load(here("../examples/otb-chess"))

test("each example emits its checked-in spec JSON, and the JSON validates", async () => {
  for (const [example, file] of [
    [todoApp, "./todo-app.json"],
    [otbChess, "./otb-chess.json"],
  ] as const) {
    const json = JSON.parse(readFileSync(here(file), "utf8"))
    assert.deepEqual(toFeed(example).model, json)
    assert.deepEqual(validate(json), [])
  }
})

test("load returns the named model the generators read", async () => {
  const { model, chapters } = todoApp
  const first = chapters[0]?.slices[0]
  assert.deepEqual(
    [model.name, first?.name, first?.service?.service.name, first?.service?.service.pkg],
    ["Todo List Application", "CreateList", "TodoService", "todo.v1"],
  )
})

// --- Assembly errors. Each fixture is the smallest model that trips one. -----

/** What most fixtures declare. An assembly takes what was declared, so each declares it afresh. */
const shared = {
  User: () => m.actor("User"),
  Svc: () => m.service("Svc", "t.v1"),
  Create: () => m.command("Create", { id: t.string(), name: t.string() }),
  Created: () => m.event("Created", { id: t.string(), name: t.string() }),
  Table: () => m.view("Table", { id: t.string().key(), name: t.string() }),
}

/** Declares what fixtures share, less `except`, which a test declares its own way or not at all. */
function fixture(...except: (keyof typeof shared)[]) {
  for (const [name, declare] of Object.entries(shared))
    if (!except.includes(name as keyof typeof shared)) declare()
}

type Slice = ReturnType<typeof m.slice>

const list = { id: "list-1", name: "Groceries" }
const unspecified = () => m.slice().command(d.Create).event(d.Created).actor(d.User).service(d.Svc)
const create = () =>
  unspecified().spec("A list is created", { when: d.Create(list), then: d.Created(list) })
const unspecifiedView = (...events: unknown[]) => {
  let built = m.slice().view(d.Table).event(d.Created)
  for (const e of events) built = built.event(e)
  return built.actor(d.User).service(d.Svc, "Get")
}
const view = (...events: unknown[]) =>
  unspecifiedView(...events).spec("A new list is a row", {
    given: d.Created(list),
    then: d.Table(list),
  })
/** A view's specification that needs no event. */
const nothing = ["No list shows before one is created", { then: [] }] as const

/** A chapter per key, numbered in key order, that its slices join in array order. */
function chapters(story: Record<string, readonly Slice[]>) {
  for (const [i, [name, slices]] of Object.entries(story).entries()) {
    m.chapter(name, i + 1)
    for (const s of slices) s.chapter(d[name])
  }
}

/** A model of one chapter, `Ch`, of `slices`. */
function assembled(slices: readonly Slice[]) {
  chapters({ Ch: slices })
  return assembleModules([{ default: m.model("x") }])
}

test("a well-formed model assembles", () => {
  fixture()
  const json = assembled([create(), view()])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.name),
    ["Create", "Table"],
  )
  assert.deepEqual(json.aggregates, [{ id: "events", name: "Events" }])
})

test("a declaration used in a slice that nothing declares is drawn without that call, and the error names it", () => {
  const modules = () => {
    fixture("Created")
    chapters({ Ch: [unspecified(), unspecifiedView()] })
    return [{ default: m.model("x") }]
  }
  const message = (where: string) =>
    `d.Created (${where}): not declared. Declare it with m.event("Created", …).`
  const partial = feedOf(modules(), { partial: true })
  const undeclared = (slice: string) => ({
    kind: "error",
    message: message(`Ch › ${slice}`),
    ui: "Created: not declared",
    element: "Created",
    slice: slice.toLowerCase(),
  })
  assert.deepEqual(
    partial.errors?.filter((m) => m.message.includes("d.Created")),
    [undeclared("Create"), undeclared("Table")],
  )
  assert.deepEqual(
    drawn(partial).chapters[0]?.slices.map((s) => [s.name, s.command, s.events]),
    [
      ["Create", "Create(id, name)", undefined],
      ["Table", undefined, undefined],
    ],
  )
  assert.throws(
    () => feedOf(modules()),
    (e: Error) =>
      [message("Ch › Create"), message("Ch › Table")].every((m) =>
        e.message.split("\n").includes(m),
      ),
  )
})

test("an event field the command does not carry", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), extra: t.string() })
  assert.throws(
    () => assembled([unspecified(), view()]),
    /Created\.extra \(Ch › Create\): no source\. Add extra to a step before \.event\(\), or set it in the mapping\./,
  )
})

test("a model still being written draws with a field that has no value", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), extra: t.string() })
  chapters({ Ch: [unspecified()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.equal(json.chapters[0]?.slices.length, 1)
  assert.ok(
    json.messages?.some((m) => m.message.startsWith("Created.extra (Ch › Create): no source.")),
  )
})

test("an optional field one slice leaves unfilled, another fills", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), extra: t.string().optional() })
  m.command("CreateWith", { id: t.string(), name: t.string(), extra: t.string() })
  const withExtra = { ...list, extra: "x" }
  const json = assembled([
    create(),
    m
      .slice()
      .command(d.CreateWith)
      .event(d.Created)
      .spec("A list is created with extra", {
        when: d.CreateWith(withExtra),
        then: d.Created(withExtra),
      }),
    view(),
  ])
  assert.equal(json.messages, undefined)
})

test("an optional field no slice fills", () => {
  const modules = () => {
    fixture("Created")
    m.event("Created", { id: t.string(), name: t.string(), extra: t.string().optional() })
    chapters({ Ch: [create(), view()] })
    return [{ default: m.model("x") }]
  }
  const message =
    "Created.extra: no slice fills it. Add extra to a command that records Created, or set it in a mapping."
  assert.throws(() => assembleModules(modules()), { message })
  const json = assembleModules(modules(), { partial: true })
  assert.deepEqual(json.messages, [
    { kind: "error", message, ui: "Created: extra has no source", element: "Created" },
  ])
})

test("a mapping function fills what the command does not carry", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), extra: t.string() })
  const slice = m
    .slice()
    .command(d.Create)
    .event(d.Created, (c: C) => ({ extra: c.Create.name }))
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is created", {
      when: d.Create(list),
      then: d.Created({ ...list, extra: "Groceries" }),
    })
  const json = assembled([slice, view()])
  assert.deepEqual(json.chapters[0]?.slices[0]?.mapping, { Created: { extra: { from: "name" } } })
  assert.equal(json.chapters[0]?.slices[0]?.command, "Create(id, name)")
})

test("a mapping spreads a whole declaration and sets the rest from another", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), extra: t.string() })
  const slice = m
    .slice()
    .command(d.Create)
    .query(d.Table, "id")
    .event(d.Created, (c: C) => ({ ...c.Create, extra: c.Table.name }))
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is renamed", {
      given: d.Created({ ...list, extra: "" }),
      when: d.Create({ ...list, name: "Errands" }),
      then: d.Created({ ...list, name: "Errands", extra: "Groceries" }),
    })
  chapters({ Ch: [slice, view()] })
  const feed = feedOf([{ default: m.model("x") }])
  assert.deepEqual(feed.model.slices[0]?.mappings, {
    Created: { id: "id", name: "name", extra: "Table(id).name" },
  })
})

test("m.generate() records what a value is made from, and a specification gives it any value", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string(), at: t.string() })
  const slice = m
    .slice()
    .command(d.Create)
    .event(d.Created, (c: C) => ({ at: m.generate(c.Create.id, c.Create.name) }))
    .actor(d.User)
    .service(d.Svc)
    .spec("Create", {
      when: d.Create({ id: "id-1", name: "Groceries" }),
      then: d.Created({ id: "id-1", name: "Groceries", at: "2026-01-01T00:00:00Z" }),
    })
  chapters({ Ch: [slice, view()] })
  const feed = feedOf([{ default: m.model("x") }])
  assert.deepEqual(feed.model.slices[0]?.mappings, { Created: { at: "generate(id, name)" } })
  assert.deepEqual(drawn(feed).chapters[0]?.slices[0]?.mapping, {
    Created: { at: { generate: ["id", "name"] } },
  })
})

test("m.generate() in a specification is one value of its field's type wherever the test uses it, the same every run", () => {
  const fields = {
    id: t.string(),
    gameId: t.uuid(),
    ply: t.int(),
    side: t.enum(["white", "black"]),
    at: t.datetime(),
    day: t.date(),
    takes: t.duration(),
    email: t.email(),
    site: t.url(),
  }
  const model = () => {
    fixture()
    m.event("Moved", fields)
    m.view("Moves", { ...fields, id: t.string().key() })
    const shown = m
      .slice()
      .view(d.Moves)
      .event(d.Moved)
      .actor(d.User)
      .service(d.Svc, "Get")
      .spec("agrees", () => {
        const move = {
          id: m.generate(),
          gameId: m.generate(),
          ply: m.generate(),
          side: m.generate(),
          at: m.generate(),
          day: m.generate(),
          takes: m.generate(),
          email: m.generate(),
          site: m.generate(),
        }
        return { given: d.Moved(move), then: d.Moves(move) }
      })
      .spec("disagrees", {
        given: d.Moved({ id: m.generate() }),
        then: d.Moves({ id: m.generate() }),
      })
    chapters({ Ch: [shown] })
    return { default: m.model("x") }
  }
  const feed = feedOf([model()], { partial: true })
  drawn(feed)
  const said = (name: string) =>
    (feed.errors ?? []).filter((m) => m.message.includes(`"${name}"`)).map((m) => m.message)
  assert.deepEqual(said("agrees"), [])
  assert.match(
    said("disagrees")[0] ?? "",
    /^Moves in "disagrees" \(Ch › Moves\): then has \{"id":"[^"]+"\}, but given builds no such row\./,
  )
  const [agrees] = feed.model.slices.find((s) => s.title === "Moves")?.specifications ?? []
  const given = agrees?.given[0]?.examples?.[0]
  assert.deepEqual(given, agrees?.then[0]?.examples?.[0])
  assert.equal(z.object(fields as never).safeParse(given).success, true)
  assert.deepEqual(feedOf([model()], { partial: true }).model, feed.model)
})

test("m.generate() nested in a list is one value of its field's type, as at the top", () => {
  fixture()
  const Item = t.object({ itemId: t.uuid(), price: t.number() })
  m.event("Added", { id: t.string(), itemId: t.uuid(), price: t.number() })
  m.view("Cart", { id: t.string().key(), items: t.array(Item) })
  const shown = m
    .slice()
    .view(d.Cart)
    .event(d.Added, (c: C) => ({ items: m.generate(c.Added) }))
    .actor(d.User)
    .spec("lists", () => {
      const itemId = m.generate()
      return {
        given: d.Added({ id: "c-1", itemId, price: 2 }),
        then: d.Cart({ id: "c-1", items: [{ itemId, price: 2 }] }),
      }
    })
  chapters({ Ch: [shown] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    [...(feed.errors ?? []), ...(feed.warnings ?? [])].filter((m) => m.message.includes('"lists"')),
    [],
  )
  const [spec] = feed.model.slices.find((s) => s.title === "Cart")?.specifications ?? []
  const given = spec?.given[0]?.examples?.[0] as { itemId: string }
  const then = spec?.then[0]?.examples?.[0] as { items: { itemId: string }[] }
  assert.equal(then.items[0]?.itemId, given.itemId)
  assert.equal(z.uuid().safeParse(given.itemId).success, true)
})

test("an example Zod refuses is an error naming the spec and where in it, and the model still draws", () => {
  fixture()
  const Item = t.object({ itemId: t.uuid() })
  m.view("Cart", { id: t.string().key(), items: t.array(Item) })
  const shown = m
    .slice()
    .view(d.Cart)
    .event(d.Created)
    .actor(d.User)
    .spec("lists", {
      given: d.Created(list),
      then: d.Cart({ id: "list-1", items: [{ itemId: 7 }] }),
    })
  chapters({ Ch: [shown] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  drawn(feed)
  assert.deepEqual(
    feed.errors?.filter((m) => m.message.includes('"lists"')),
    [
      {
        kind: "error",
        message: `Cart.items[0].itemId in "lists" (Ch › Cart): Invalid input: expected string, received number`,
        ui: "Cart: items[0].itemId isn't valid",
        element: "Cart",
        slice: "cart",
      },
    ],
  )
})

test("a specification written as a function runs at assembly, so its examples may be declared below it; one that throws is an error", () => {
  fixture()
  const shown = unspecified()
    .spec("A list is created", () => ({ when: creates, then: d.Created(list) }))
    .spec("A list is renamed", () => {
      throw new Error("renames is not defined")
    })
  const creates = d.Create(list)
  chapters({ Ch: [shown] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  drawn(feed)
  assert.deepEqual(feed.model.slices[0]?.specifications[0]?.when?.[0]?.examples, [list])
  assert.deepEqual(
    feed.errors?.filter((m) => m.message.includes('"A list is')),
    [
      {
        kind: "error",
        message: `"A list is renamed" (Ch › Create): threw: renames is not defined`,
        ui: `"A list is renamed": didn't run`,
        element: "",
        slice: "create",
      },
    ],
  )
})

test("a command field no event records is an error; generating from it records it", () => {
  const model = (recorded: boolean) => {
    fixture("Created")
    m.event("Created", { id: t.string(), slug: t.string() })
    const slice = m
      .slice()
      .command(d.Create)
      .event(d.Created, (c: C) => ({
        slug: recorded ? m.generate(c.Create.name) : m.generate(),
      }))
      .spec("Create", {
        when: d.Create(list),
        then: d.Created({ id: "list-1", slug: "groceries" }),
      })
    chapters({ Ch: [slice] })
    return { default: m.model("x") }
  }
  const message = "Create.name (Ch › Create): reaches no event. Record it in Created, or remove it."
  const json = feedOf([model(false)], { partial: true })
  assert.ok(json.errors?.some((m) => m.message === message))
  assert.throws(
    () => feedOf([model(false)]),
    (e: Error) => e.message.includes(message),
  )
  const fixed = feedOf([model(true)], { partial: true })
  assert.ok(!fixed.errors?.some((m) => m.message.includes("reaches no event")))
})

test("a call sends out only the command fields its external event carries", () => {
  fixture()
  m.external("Remote")
  m.event("Answered", { id: t.string() }).external(d.Remote)
  m.command("Ask", { id: t.string(), note: t.string() })
  chapters({ Ch: [m.slice().command(d.Ask).event(d.Answered).actor(d.User).service(d.Svc)] })
  const json = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.errors?.filter((m) => m.message.includes("reaches no event")).map((m) => m.message),
    ["Ask.note (Ch › Ask): reaches no event. Record it in Answered, or remove it."],
  )
})

test("a command field that filters a query after the command is used", () => {
  fixture()
  m.event("Renamed", { id: t.string() })
  const rename = m
    .slice()
    .command(d.Create)
    .query(d.Table, (c: C) => ({ id: c.Create.id, name: c.Create.name }))
    .event(d.Renamed)
    .actor(d.User)
  chapters({ Ch: [rename] })
  const json = feedOf([{ default: m.model("x") }], { partial: true })
  assert.ok(!json.errors?.some((m) => m.message.includes("reaches no event")))
})

test("a mapping that returns a whole command records only the fields its event has", () => {
  fixture()
  m.event("Renamed", { id: t.string() })
  const rename = m
    .slice()
    .command(d.Create)
    .event(d.Renamed, (c: C) => c.Create)
    .actor(d.User)
  chapters({ Ch: [rename] })
  const json = feedOf([{ default: m.model("x") }], { partial: true })
  assert.ok(
    json.errors?.some(
      (m) =>
        m.message ===
        "Create.name (Ch › Create): reaches no event. Record it in Renamed, or remove it.",
    ),
  )
})

test("a mapping recognises a source field, a t.literal() and m.generate(); a schema it computes is an error", () => {
  // An assembly takes what was declared and written since the last, so each declares and writes afresh.
  const modules = () => {
    fixture("Created")
    m.event("Created", {
      id: t.string(),
      name: t.string(),
      alias: t.string(),
      label: t.string(),
      size: t.number(),
    })
    const slice = m
      .slice()
      .command(d.Create)
      .event(d.Created, (c: C) => ({
        alias: c.Create.id,
        label: c.Create.name.describe("loud"),
        size: t.literal(2),
      }))
      .spec("Create", {
        when: d.Create(list),
        then: d.Created({ ...list, alias: "list-1", label: "x", size: 2 }),
      })
    chapters({ Ch: [slice, view()] })
    return [{ default: m.model("x") }]
  }
  const label =
    "Created.label (Ch › Create): computed in the mapping. Set it to a source field, a t.literal(), or m.generate() with what it is made from."
  const partial = feedOf(modules(), { partial: true })
  assert.deepEqual(
    partial.errors?.filter((m) => m.slice === "create").map((m) => [m.message, m.ui]),
    [[label, "Created: label is computed"]],
  )
  assert.deepEqual(drawn(partial).chapters[0]?.slices[0]?.mapping, {
    Created: { alias: { from: "id" }, label: { generate: [] }, size: { value: 2 } },
  })
  assert.throws(() => feedOf(modules()), { message: label })
  // Two fields that share a schema are told apart.
  const Id = t.string()
  m.command("Pair", { a: Id, b: Id })
  m.event("Paired", { a: Id, b: Id })
  m.slice()
    .command(d.Pair)
    .event(d.Paired, (c: C) => ({ a: c.Pair.b, b: c.Pair.a }))
  const [swapped] = loadModules([{ default: m.model("x") }], { partial: true }).unchaptered
  const decl = swapped?.command?.decl
  assert.equal(decl?.name, "Pair")
  assert.deepEqual(swapped?.events[0]?.mapping, {
    a: { from: "b", decl },
    b: { from: "a", decl },
  })
})

test("a column no event writes", () => {
  fixture("Table")
  m.view("Table", { id: t.string().key(), name: t.string(), count: t.number() })
  assert.throws(
    () => assembled([create(), view()]),
    /Table\.count \(Ch › Table\): no source\. Add \.event\(\) with an event that carries count, or set it in a mapping\./,
  )
})

test("an event that carries none of the view's key columns", () => {
  fixture()
  m.command("Rename", { name: t.string() })
  m.event("Renamed", { name: t.string() })
  const rename = m
    .slice()
    .command(d.Rename)
    .event(d.Renamed)
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is renamed", {
      when: d.Rename({ name: "Chores" }),
      then: d.Renamed({ name: "Chores" }),
    })
  assert.throws(
    () => assembled([create(), rename, view(d.Renamed)]),
    /Renamed \(Ch › Table\): doesn't say which Table row\. Give it id, or set it in its mapping\./,
  )
})

test("an event that carries only some of the view's key columns", () => {
  fixture("Table", "Create", "Created")
  m.view("Table", { id: t.string().key(), owner: t.string().key(), name: t.string() })
  m.command("Create", { id: t.string(), owner: t.string(), name: t.string() })
  m.event("Created", { id: t.string(), owner: t.string(), name: t.string() })
  m.event("Renamed", { id: t.string(), name: t.string() })
  const row = { ...list, owner: "u-1" }
  const create = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .event(d.Renamed)
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is created", { when: d.Create(row), then: d.Created(row) })
    .spec("A list is renamed", { when: d.Create(row), then: d.Renamed(list) })
  const shown = m
    .slice()
    .view(d.Table)
    .event(d.Created)
    .event(d.Renamed)
    .actor(d.User)
    .spec("A list is a row", { given: [d.Created(row), d.Renamed(list)], then: d.Table(row) })
  assert.throws(
    () => assembled([create, shown]),
    /Renamed \(Ch › Table\): doesn't say which Table row\. Give it owner, or set it in its mapping\./,
  )
})

test("an event nothing consumes is unused: a warning, which a strict assembly does not refuse", () => {
  fixture()
  assert.deepEqual(assembled([create()]).messages, [
    {
      kind: "warning",
      message:
        "Created (Ch › Create): unused. Add .automation(d.Created), or .event(d.Created) to a state view.",
      ui: "Created: unused",
      element: "Created",
      slice: "create",
    },
  ])
})

test("an event no slice records, that a view reads, has no source: an error", () => {
  fixture()
  assert.throws(
    () => assembled([view()]),
    /Created \(Ch › Table\): nothing records it\. Add \.event\(d\.Created\) to the slice that causes it\./,
  )
})

test("an event no slice records is one line, at the slices that react to it", () => {
  fixture()
  const created = d.Created({ id: "1", name: "n" })
  m.command("Process", { id: t.string(), name: t.string() })
  m.event("Processed", { id: t.string() })
  const processor = m
    .slice("Processor")
    .automation(d.Created)
    .command(d.Process)
    .event(d.Processed)
    .spec("one", { given: created, when: d.Process({ id: "1" }), then: d.Processed({ id: "1" }) })
    .spec("two", { given: created, when: d.Process({ id: "1" }), then: d.Processed({ id: "1" }) })
  m.command("Rename", { id: t.string() })
  m.event("Renamed", { id: t.string() })
  const assumes = m
    .slice()
    .command(d.Rename)
    .event(d.Renamed)
    .actor(d.User)
    .spec("renames", { given: created, when: d.Rename({ id: "1" }), then: d.Renamed({ id: "1" }) })
  chapters({ Ch: [processor, view()], Other: [assumes] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.messages?.filter((m) => m.message.includes("nothing records it")),
    [
      {
        kind: "error",
        message:
          "Created (Ch › Processor, Ch › Table): nothing records it. Add .event(d.Created) to the slice that causes it.",
        ui: "Created: nothing records it",
        element: "Created",
        slice: "processor",
      },
    ],
  )
})

test("a view nothing reads is unused: a warning", () => {
  fixture()
  const unseen = m
    .slice()
    .view(d.Table)
    .event(d.Created)
    .spec("A new list is a row", { given: d.Created(list), then: d.Table(list) })
  assert.deepEqual(assembled([create(), unseen]).messages, [
    {
      kind: "warning",
      message: "Ch › Table: unused. Add .actor(), .query(d.Table, …) or .automation(d.Table).",
      ui: "Table: unused",
      element: "Table",
      slice: "table",
    },
  ])
})

test("a view nothing builds", () => {
  fixture()
  const created = d.Created({ id: "1", name: "n" })
  const slice = m
    .slice()
    .command(d.Create)
    .query(d.Table, "id")
    .event(d.Created, (c: C) => ({ name: c.Create.name }))
    .actor(d.User)
    .service(d.Svc)
    .spec("t", {
      given: created,
      when: d.Create({ id: "1", name: "n" }),
      then: created,
    })
  assert.throws(
    () => assembled([slice]),
    /Table \(Ch › Create\): nothing builds it\. Add a state view: m\.slice\(\)\.view\(d\.Table\)\.event\(d\.Event\)\./,
  )
})

/**
 * A call to a system we do not own: our command, then the system's event with what it sent back.
 * `except` is what the fixture leaves undeclared.
 */
function call(...except: Parameters<typeof fixture>) {
  fixture(...except)
  m.external("Remote")
  m.event("Answered", { id: t.string(), name: t.string(), detail: t.string() }).external(d.Remote)
  m.command("Ask", { id: t.string() })
  return m.slice().command(d.Ask).event(d.Answered).actor(d.User).service(d.Svc)
}

/** `call()` with a specification that shows its answer. */
function specifiedCall(...except: Parameters<typeof fixture>) {
  return call(...except).spec("The remote system answers", {
    when: d.Ask({ id: "list-1" }),
    then: d.Answered({ ...list, detail: "Two aisles over" }),
  })
}

test("a call ends in the external event, whose fields come from outside", () => {
  const specified = specifiedCall()
  const keep = m
    .slice()
    .translation(d.Answered)
    .command(d.Create)
    .event(d.Created)
    .spec("The answer is kept", {
      given: d.Answered({ ...list, detail: "Two aisles over" }),
      when: d.Create(list),
      then: d.Created(list),
    })
  const json = assembled([specified, keep, view()])
  const [asked] = json.chapters[0]?.slices ?? []
  assert.deepEqual(asked?.calls, [{ actor: "remote", event: "Answered(id, name, detail)" }])
  assert.equal(asked?.events, undefined)
})

test("an event of ours that maps a field the command shares from the external event is drawn from that event", () => {
  fixture()
  m.external("Remote")
  m.event("Answered", { id: t.string() }).external(d.Remote)
  m.event("Kept", { id: t.string() })
  const ask = m
    .slice()
    .command(d.Create)
    .event(d.Answered)
    .event(d.Kept, (c: C) => ({ id: c.Answered.id }))
  chapters({ Ch: [ask] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  const kept = feed.model.slices[0]?.events.find((e) => e.title === "Kept")
  assert.deepEqual(
    kept?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "Create"],
      ["INBOUND", "Answered"],
    ],
  )
})

test("the external event a call gets back fills an event of ours after it, in the same slice", () => {
  fixture()
  m.external("Remote")
  m.event("Answered", { id: t.string(), detail: t.string() }).external(d.Remote)
  m.command("Ask", { id: t.string(), name: t.string() })
  m.event("Kept", { id: t.string(), name: t.string(), detail: t.string(), said: t.string() })
  const ask = m
    .slice()
    .command(d.Ask)
    .event(d.Answered)
    .event(d.Kept, (c: C) => ({ id: c.Ask.id, said: c.Answered.detail }))
    .actor(d.User)
    .service(d.Svc)
    .spec("The answer is kept", {
      when: d.Ask(list),
      then: [
        d.Answered({ ...list, detail: "Two aisles over" }),
        d.Kept({ ...list, detail: "Two aisles over", said: "Two aisles over" }),
      ],
    })
  chapters({ Ch: [ask] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    [...(feed.errors ?? []), ...(feed.warnings ?? [])]
      .filter((m) => m.slice === "ask")
      .map((m) => m.message),
    ["Kept (Ch › Ask): unused. Add .automation(d.Kept), or .event(d.Kept) to a state view."],
  )
  const asked = feed.model.slices.find((s) => s.title === "Ask")
  const kept = asked?.events.find((e) => e.title === "Kept")
  assert.deepEqual(
    kept?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "Ask"],
      ["INBOUND", "Answered"],
    ],
  )
  assert.equal(asked?.mappings?.Kept?.said, "detail")
  const out = layout(drawn(feed))
  const from = out.boxes.find((b) => b.name === "Answered")
  const to = out.boxes.find((b) => b.name === "Kept" && !b.compact)
  assert.ok(from && to && out.edges.some((e) => e.from === from.id && e.to === to.id))
})

test("a view refuses an external event, which isn't stored", () => {
  const modules = () => {
    const specified = specifiedCall("Create", "Created")
    const projected = m
      .slice()
      .view(d.Table)
      .event(d.Answered, (c: C) => ({ id: c.Answered.id }))
      .actor(d.User)
      .spec("The answer is a row", {
        given: d.Answered({ ...list, detail: "Two aisles over" }),
        then: d.Table(list),
      })
    chapters({ Ch: [specified, projected] })
    return [{ default: m.model("x") }]
  }
  const message =
    "Answered (Ch › Table): Remote's, not stored, so it can't build Table. Translate it into an event of ours, then project that."
  assert.deepEqual(
    feedOf(modules(), { partial: true }).errors?.map((m) => [m.message, m.ui]),
    [[message, "Answered: not stored"]],
  )
  assert.throws(() => feedOf(modules()), { message })
})

test("an external event we produce is published, and needs no translation", () => {
  chapters({ Ch: [specifiedCall("Create", "Created", "Table")] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.equal(json.messages, undefined)
})

test("an external event only a given has is still left to translate: a warning", () => {
  fixture()
  m.external("Remote")
  m.event("Answered", { id: t.string(), detail: t.string() }).external(d.Remote)
  const after = create().spec("A list is created after an answer", {
    given: d.Answered({ id: "list-1", detail: "Two aisles over" }),
    when: d.Create(list),
    then: d.Created(list),
  })
  chapters({ Ch: [after, view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(json.messages, [
    {
      kind: "warning",
      message: "Answered (Ch › Create): nothing translates it. Add .translation(d.Answered).",
      ui: "Answered: nothing translates it",
      element: "Answered",
      slice: "create",
    },
  ])
})

/**
 * A command's events are alternatives; a specification says when each happens. This model's
 * command shows one, and `more` may specify it further.
 */
function outcomes(more = (created: Slice) => created) {
  fixture()
  m.event("Refused", { id: t.string() })
  const created = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .event(d.Refused)
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
  const shown = unspecifiedView(d.Refused).spec("A refused list stays as it was", {
    given: [d.Created(list), d.Refused({ id: "list-1" })],
    then: d.Table(list),
  })
  chapters({ Ch: [more(created), shown] })
  return [{ default: m.model("x") }]
}

/** A missing specification in the slice with id `slice`: a warning, which a strict assembly lets through. */
function missing(model: () => object[], element: string, slice: string, message: string) {
  const expected = [
    { kind: "warning", message, ui: `${element}: missing specification`, element, slice },
  ]
  assert.deepEqual(assembleModules(model(), { partial: true }).messages, expected)
  assert.deepEqual(assembleModules(model()).messages, expected)
}

test("an outcome no specification shows is a missing specification", () => {
  missing(
    outcomes,
    "Refused",
    "create",
    "Refused (Ch › Create): missing specification. Add a .spec whose then has Refused(…).",
  )
})

test("a specification whose then has the outcome finishes it", () => {
  const refused = (created: Slice) =>
    created.spec("A second list with the same name is refused", {
      given: d.Created(list),
      when: d.Create(list),
      then: d.Refused({ id: "list-1" }),
    })
  assembleModules(outcomes(refused))
})

test("an event a view handles that no specification's given has is a missing specification", () => {
  const model = () => {
    fixture()
    chapters({ Ch: [create(), unspecifiedView().spec(...nothing)] })
    return [{ default: m.model("x") }]
  }
  missing(
    model,
    "Created",
    "table",
    "Created (Ch › Table): missing specification. Add a .spec whose given has Created(…).",
  )
})

test("a view with no specification is a missing specification", () => {
  const model = () => {
    fixture()
    chapters({ Ch: [create(), unspecifiedView()] })
    return [{ default: m.model("x") }]
  }
  missing(
    model,
    "Table",
    "table",
    "Ch › Table: missing specification. Add a .spec whose then has Table(…).",
  )
})

const hardware = { id: "list-2", name: "Hardware" }

/** The errors in a model whose view is `view`. */
const viewed = (view: Slice) => {
  chapters({ Ch: [create(), view] })
  return feedOf([{ default: m.model("x") }], { partial: true }).errors?.map((m) => m.message)
}

test("a view's specification shows the rows given builds that its query asks for", () => {
  fixture()
  const byName = unspecifiedView()
    .context({ name: t.string() })
    .spec("Only Groceries shows", {
      given: [d.Created(list), d.Created(hardware)],
      when: { name: "Groceries" },
      then: d.Table(list),
    })
  chapters({ Ch: [create(), byName] })
  const feed = feedOf([{ default: m.model("x") }])
  assert.deepEqual(feed.model.slices[1]?.specifications[0]?.when, [
    {
      id: "table:spec:0:when:0",
      title: "Get",
      type: "SPEC_COMMAND",
      examples: [{ name: "Groceries" }],
    },
  ])
  assert.deepEqual([feed.errors, feed.warnings], [undefined, undefined])
})

test("a view's row given does not build, or with another value, is named", () => {
  fixture()
  const wrong = unspecifiedView().spec("Groceries shows", {
    given: d.Created(list),
    then: [d.Table({ ...list, name: "Hardware" }), d.Table({ id: "list-9", name: "Nails" })],
  })
  assert.deepEqual(viewed(wrong), [
    'Table.name in "Groceries shows" (Ch › Table): then has "Hardware", but Created in given has "Groceries".',
    'Table in "Groceries shows" (Ch › Table): then has {"id":"list-9"}, but given builds no such row.',
  ])
})

test("a row given does not build is an error when strict", () => {
  // A field an example leaves out is not compared, so the second row is the one given builds.
  const model = () => {
    fixture()
    const missing = unspecifiedView().spec("A new list is a row", {
      given: d.Created(list),
      then: [d.Table({ ...list, id: "missing" }), d.Table({ id: "list-1" })],
    })
    chapters({ Ch: [create(), missing] })
    return { default: m.model("x") }
  }
  const message =
    'Table in "A new list is a row" (Ch › Table): then has {"id":"missing"}, but given builds no such row.'
  assert.deepEqual(
    feedOf([model()], { partial: true }).errors?.map((m) => [m.message, m.ui]),
    [[message, "Table: shows a row nothing builds"]],
  )
  assert.throws(() => feedOf([model()]), { message })
})

test("a view's row its query excludes is named", () => {
  fixture()
  const byName = unspecifiedView()
    .context({ name: t.string() })
    .spec("Only Hardware shows", {
      given: [d.Created(list), d.Created(hardware)],
      when: { name: "Hardware" },
      then: [d.Table(hardware), d.Table({ id: "list-1" })],
    })
  assert.deepEqual(viewed(byName), [
    'Table in "Only Hardware shows" (Ch › Table): then has {"id":"list-1"}, but when excludes it. Remove it from then.',
  ])
})

test("a row given builds that then leaves out is named, unless the query excludes it", () => {
  fixture()
  const search = unspecifiedView()
    .context({ text: t.string() })
    .spec("A search finds Groceries", {
      given: [d.Created(list), d.Created(hardware)],
      when: { text: "Groc" },
      then: d.Table(list),
    })
  assert.deepEqual(viewed(search), [
    'Table in "A search finds Groceries" (Ch › Table): given builds {"id":"list-2"}, but then leaves it out. Add it to then.',
  ])
})

test("a then that describes its outcome may leave out rows given builds, and still checks the rows it has", () => {
  fixture()
  const described = unspecifiedView().spec("Only Groceries shows", {
    given: [d.Created(list), d.Created(hardware)],
    then: ["Hardware is archived", d.Table({ ...list, name: "Hardware" })],
  })
  chapters({ Ch: [create(), described] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.errors?.map((m) => [m.message, m.ui]),
    [
      [
        'Table.name in "Only Groceries shows" (Ch › Table): then has "Hardware", but Created in given has "Groceries".',
        "Table: name doesn't match",
      ],
    ],
  )
  assert.deepEqual(validate(feed.model), [])
  assert.deepEqual(feed.model.slices[1]?.specifications[0]?.then[0], {
    id: "table:spec:0:then:0",
    title: "Hardware is archived",
    type: "SPEC_DESCRIPTION",
  })
  const card = layout(read(feed)).specs[1]?.steps.at(-1)?.cards[0]
  assert.deepEqual([card?.kind, card?.lines], ["description", ["Hardware is archived"]])
})

test("a described outcome shows no event", () => {
  fixture()
  const described = unspecified().spec("A list is created", {
    when: d.Create(list),
    then: "The list exists",
  })
  const message =
    "Created (Ch › Create): missing specification. Add a .spec whose then has Created(…)."
  chapters({ Ch: [described, view()] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.warnings?.map((m) => m.message),
    [message],
  )
})

test("a specification's given may hold events its slice does not handle", () => {
  fixture()
  m.event("Refused", { id: t.string() })
  const create = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .event(d.Refused)
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
    .spec("A second list with the same name is refused", {
      given: d.Created(list),
      when: d.Create(list),
      then: d.Refused({ id: "list-1" }),
    })
  const history = [d.Created(list), d.Refused({ id: "list-1" })]
  const shown = unspecifiedView().spec("The list shows after a refusal", {
    given: history,
    then: d.Table(list),
  })
  assembled([create, shown])
})

test("an external event a call ends in is an outcome", () => {
  chapters({ Ch: [call("Create", "Created", "Table")] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.ok(
    json.messages?.some(
      (m) => m.element === "Answered" && m.message.includes("missing specification"),
    ),
  )
})

test("two slices claiming one service method", () => {
  const model = () => {
    fixture()
    m.command("Rename", { id: t.string(), name: t.string() })
    m.event("Renamed", { id: t.string(), name: t.string() })
    const rename = m
      .slice()
      .command(d.Rename)
      .event(d.Renamed)
      .actor(d.User)
      .service(d.Svc, "Create")
      .spec("A list is renamed", { when: d.Rename(list), then: d.Renamed(list) })
    chapters({ Ch: [create(), rename, view(d.Renamed)] })
    return { default: m.model("x") }
  }
  assert.throws(
    () => assembleModules([model()]),
    /Svc\/Create \(Ch › Rename\): already used by Ch › Create\. Name this one/,
  )
  const partial = feedOf([model()], { partial: true })
  assert.equal(drawn(partial).chapters[0]?.slices.length, 3)
  assert.deepEqual(
    partial.errors?.filter((m) => m.slice === "rename").map((m) => [m.message, m.ui]),
    [
      [
        'Svc/Create (Ch › Rename): already used by Ch › Create. Name this one with .service(d.Svc, "Name").',
        "Svc: Create used twice",
      ],
    ],
  )
})

test("slices without a service claim no method", () => {
  fixture()
  const again = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .actor(d.User)
    .spec("A list is created again", { when: d.Create(list), then: d.Created(list) })
  const json = assembled([create(), again, view()])
  assert.equal(json.chapters[0]?.slices[1]?.ui, "Create")
})

test("an automation's command field its trigger does not carry", () => {
  fixture()
  m.command("Process", { id: t.string(), label: t.string() })
  m.event("Processed", { id: t.string() })
  // The compiler refuses it too; assembly holds for a model run unchecked.
  const processor = m.slice("Processor").automation(d.Created).command(d.Process).event(d.Processed)
  assert.throws(
    () => assembled([create(), processor]),
    /Process\.label \(Ch › Processor\): no source\. Add label to a step before \.command\(\), or set it in the mapping\./,
  )
})

/** The table a created list is a row of, and stays one once processed. */
const processedView = () =>
  unspecifiedView(d.Processed).spec("A processed list stays as it was", {
    given: [d.Created(list), d.Processed({ id: "list-1" })],
    then: d.Table(list),
  })

test("an automation's trigger no specification's given has is a missing specification; one a view starts has none", () => {
  const model = () => {
    fixture()
    m.command("Process", { id: t.string() })
    m.event("Processed", { id: t.string() })
    const triggered = m
      .slice("Processor")
      .automation(d.Created)
      .command(d.Process)
      .event(d.Processed)
      .spec("A list is processed", {
        when: d.Process({ id: "list-1" }),
        then: d.Processed({ id: "list-1" }),
      })
    chapters({ Ch: [create(), triggered, processedView()] })
    return [{ default: m.model("x") }]
  }
  missing(
    model,
    "Created",
    "processor",
    "Created (Ch › Processor): missing specification. Add a .spec whose given has Created(…).",
  )
})

test("an automation's mapping fills its command from the trigger", () => {
  fixture()
  m.command("Process", { id: t.string(), label: t.string() })
  m.event("Processed", { id: t.string(), label: t.string().optional() })
  const processor = m
    .slice("Processor")
    .automation(d.Created)
    .command(d.Process, (c: C) => ({ label: c.Created.name }))
    .event(d.Processed)
    .spec("A created list is processed", {
      given: d.Created(list),
      when: d.Process({ id: "list-1", label: "Groceries" }),
      then: d.Processed({ id: "list-1" }),
    })
  const json = assembled([create(), processor, processedView()])
  assert.deepEqual(json.chapters[0]?.slices[1]?.mapping, { Process: { label: { from: "name" } } })
})

test("a generated value in an automation's command has no source: an error", () => {
  const model = () => {
    fixture()
    m.command("Process", { id: t.string(), label: t.string() })
    m.event("Processed", { id: t.string(), label: t.string().optional() })
    const processor = m
      .slice("Processor")
      .automation(d.Created)
      .command(d.Process, () => ({ label: m.generate() }))
      .event(d.Processed)
      .spec("A created list is processed", {
        given: d.Created(list),
        when: d.Process({ id: "list-1", label: "x" }),
        then: d.Processed({ id: "list-1" }),
      })
    chapters({ Ch: [create(), processor, processedView()] })
    return { default: m.model("x") }
  }
  const message =
    "Process.label (Ch › Processor): an automation can't generate it. Add label to Created or a view it queries, or generate it in an event Process records."
  const json = assembleModules([model()], { partial: true })
  assert.deepEqual(json.messages, [
    {
      kind: "error",
      message,
      ui: "Process: label has no source",
      element: "Process",
      slice: "processor",
    },
  ])
  assert.throws(() => assembleModules([model()]), { message })
})

test("the first system actor declared runs what names none, and .actor() names another", () => {
  fixture()
  m.actor("Syncer", { icon: "system" })
  m.actor("Mailer", { icon: "system" })
  m.command("Process", { id: t.string() })
  m.event("Processed", { id: t.string() })
  m.command("Mail", { id: t.string() })
  m.event("Mailed", { id: t.string() })
  m.external("Remote")
  m.event("Answered", { id: t.string() }).external(d.Remote)
  chapters({
    Ch: [
      create(),
      m.slice("Processor").automation(d.Created).command(d.Process).event(d.Processed),
      m.slice("Notifier").automation(d.Created).command(d.Mail).event(d.Mailed).actor(d.Mailer),
      m.slice("Translator").translation(d.Answered).command(d.Mail).event(d.Mailed).actor(d.Mailer),
      m.slice().view(d.Table).event(d.Created),
    ],
  })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.model.slices.map((s) => [s.title, s.actors?.map((a) => a.name), s.screens.length]),
    [
      ["Create", ["User"], 1],
      ["Processor", ["Syncer"], 0],
      ["Notifier", ["Mailer"], 0],
      ["Translator", ["Mailer"], 0],
      ["Table", ["Syncer"], 0],
    ],
  )
  const board = drawn(feed)
  assert.deepEqual(
    board.chapters[0]?.slices.map((s) => s.actor),
    ["user", "syncer", "mailer", "remote", "syncer"],
  )
  const drawing = layout(board)
  const lanes = drawing.rows.filter((r) => r.kind === "actor")
  assert.deepEqual(
    lanes.map((r) => `${r.label} (${r.sub})`),
    ["User (Actor)", "Syncer (System)", "Mailer (System)", "Remote (External)"],
  )
  const gears = drawing.boxes.filter((b) => b.kind === "automation")
  assert.deepEqual(
    gears.map((b) => lanes.find((r) => b.y >= r.y && b.y < r.y + r.h)?.id),
    ["actor:syncer", "actor:mailer", "actor:mailer"],
  )
})

test("a state view without a service is named by its view and has a screen", () => {
  fixture()
  const unserved = m
    .slice()
    .view(d.Table)
    .event(d.Created)
    .actor(d.User)
    .spec("A new list is a row", { given: d.Created(list), then: d.Table(list) })
  const json = assembled([create(), unserved])
  const slice = json.chapters[0]?.slices[1]
  assert.deepEqual([slice?.name, slice?.ui], ["Table", "Table"])
})

test("a slice with no actor has no screen", () => {
  fixture("User")
  const create = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
  const unseen = m
    .slice()
    .view(d.Table)
    .event(d.Created)
    .service(d.Svc, "Get")
    .spec("A new list is a row", { given: d.Created(list), then: d.Table(list) })
  const json = assembled([create, unseen])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.ui),
    [undefined, undefined],
  )
  assert.deepEqual(json.messages, undefined)
})

test("a slice with several actors draws a screen in each one's lane", () => {
  fixture()
  m.actor("Admin", { icon: "admin" })
  const both = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .actor(d.User, d.Admin)
    .service(d.Svc)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
  const json = assembled([both, view()])
  const slice = json.chapters[0]?.slices[0]
  assert.deepEqual([slice?.actor, slice?.actors], ["user", ["user", "admin"]])
  const { boxes, rows } = layout(json)
  const lanes = boxes
    .filter((b) => b.kind === "ui" && b.column === 0)
    .map((b) => rows.find((r) => b.y >= r.y && b.y < r.y + r.h)?.id)
  assert.deepEqual(lanes, ["actor:user", "actor:admin"])
})

// --- What the viewer draws: polls, lanes, screens ------------------------------

test("a .automation() automation polls the view", () => {
  fixture()
  m.command("Process", { id: t.string() })
  m.event("Processed", { id: t.string() })
  const processor = m
    .slice("Processor")
    .automation(d.Table)
    .command(d.Process)
    .event(d.Processed)
    .spec("A listed row is processed", {
      given: d.Created(list),
      when: d.Process({ id: "list-1" }),
      then: d.Processed({ id: "list-1" }),
    })
  const json = assembled([create(), processor, processedView()])
  const slice = json.chapters[0]?.slices[1]
  assert.equal(slice?.automation, "Processor")
  assert.equal(slice?.trigger, undefined)
  assert.equal(slice?.polls, "Table")
})

test("a polled command's when matches the row given builds", () => {
  const model = (label: string) => {
    fixture()
    m.command("Process", { id: t.string(), label: t.string() })
    m.event("Processed", { id: t.string(), label: t.string().optional() })
    const processor = m
      .slice("Processor")
      .automation(d.Table)
      .command(d.Process, (c: C) => ({ label: c.Table.name }))
      .event(d.Processed)
      .spec("A listed row is processed", {
        given: d.Created(list),
        when: d.Process({ id: "list-1", label }),
        then: d.Processed({ id: "list-1" }),
      })
    return assembled([create(), processor, processedView()])
  }
  model("Groceries")
  assert.throws(() => model("Milk"), {
    message: `Process.label in "A listed row is processed" (Ch › Processor): when has "Milk", but the Table row given builds has name "Groceries".`,
  })
})

test("a polled command's when whose row given builds none of, or several of, is an error", () => {
  fixture("Table", "Created")
  m.view("Table", { id: t.string().key(), owner: t.string().key(), name: t.string() })
  m.event("Created", { id: t.string(), owner: t.string(), name: t.string() })
  m.command("Process", { id: t.string() })
  m.event("Processed", { id: t.string() })
  const mine = { ...list, owner: "u-1" }
  const theirs = { ...list, owner: "u-2" }
  const processor = m
    .slice("Processor")
    .automation(d.Table)
    .command(d.Process)
    .event(d.Processed)
    .spec("none", {
      given: d.Created(mine),
      when: d.Process({ id: "list-2" }),
      then: d.Processed({ id: "list-2" }),
    })
    .spec("several", {
      given: [d.Created(mine), d.Created(theirs)],
      when: d.Process({ id: "list-1" }),
      then: d.Processed({ id: "list-1" }),
    })
  const projection = m.slice().view(d.Table).event(d.Created)
  chapters({ Ch: [processor, projection] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.messages
      ?.filter((m) => m.element === "Table" && m.kind === "error")
      .map((m) => [m.message, m.ui]),
    [
      [
        'Table in "none" (Ch › Processor): when is for row {"id":"list-2"}, but given builds none. Add the event that does.',
        "Table: no row for Process",
      ],
      [
        'Table in "several" (Ch › Processor): when is for row {"id":"list-1"}, but given builds 2. Copy every key column into Process.',
        "Table: several rows for Process",
      ],
    ],
  )
})

test("same-named streams from two modules are one lane", () => {
  fixture("Created")
  m.stream("Inventory")
  m.event("Created", { id: t.string(), name: t.string() }).stream(d.Inventory)
  // Declared again, as another module would: one lane by name.
  m.stream("Inventory")
  m.event("Recounted", { id: t.string() }).stream(d.Inventory)
  chapters({ Ch: [create(), view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(json.aggregates, [{ id: "inventory", name: "Inventory" }])
  assert.deepEqual(
    json.chapters.flatMap((c) => c.slices.map((s) => [s.name, s.aggregate])),
    [
      ["Create", "inventory"],
      ["Table", "inventory"],
      ["Recounted", "inventory"],
    ],
  )
})

test("a stream no event joins is an empty lane: a warning", () => {
  fixture("Created")
  m.stream("Inventory")
  m.event("Created", { id: t.string(), name: t.string() }).stream(d.Inventory)
  m.stream("Returns")
  chapters({ Ch: [create(), view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(json.messages, [
    {
      kind: "warning",
      message: "Returns: no events. Add .stream(d.Returns) to one.",
      ui: "Returns: empty",
      element: "Returns",
    },
  ])
  assert.deepEqual(json.aggregates, [
    { id: "inventory", name: "Inventory" },
    { id: "returns", name: "Returns" },
  ])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.aggregate),
    ["inventory", "inventory"],
  )
  const rows = layout(json).rows.filter((r) => r.kind === "stream")
  assert.deepEqual(
    rows.map((r) => r.id),
    ["stream:inventory", "stream:returns"],
  )
})

test("slices on one screen draw it, titled with its name, in the actor's lane", () => {
  fixture()
  m.screen("Lock")
  const json = assembled([create().screen(d.Lock), view().screen(d.Lock)])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.screen),
    ["Lock", "Lock"],
  )
  const screens = layout(json).boxes.filter((b) => b.kind === "ui")
  assert.deepEqual(
    screens.map((b) => b.name),
    ["Lock", "Lock"],
  )
})

test("a screen no one sees is a warning, and one no slice names is storming, with nothing to do", () => {
  fixture()
  m.screen("Lock")
  m.screen("Home")
  const unseen = m
    .slice()
    .command(d.Create)
    .event(d.Created)
    .screen(d.Lock)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
  chapters({ Ch: [unseen, view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(json.messages, [
    {
      kind: "warning",
      message: "Lock (Ch › Create): no one sees it. Add .actor() for who does.",
      ui: "Lock: no one sees it",
      element: "Lock",
      slice: "create",
    },
  ])
})

test("every m.slice().view() of a view is one slice: its events in, its screen out, drawn where the first is", () => {
  fixture("Table")
  m.view("Table", { id: t.string().key(), name: t.string(), status: t.string() })
  m.command("Archive", { id: t.string() })
  m.event("Archived", { id: t.string() })
  const archive = m
    .slice()
    .command(d.Archive)
    .event(d.Archived)
    .actor(d.User)
    .service(d.Svc)
    .spec("A list is archived", {
      when: d.Archive({ id: "list-1" }),
      then: d.Archived({ id: "list-1" }),
    })
  chapters({
    Capture: [
      create(),
      m
        .slice()
        .view(d.Table)
        .event(d.Created, () => ({ status: t.literal("open") }))
        .actor(d.User)
        .service(d.Svc, "Get")
        .spec("A new list is open", {
          given: d.Created(list),
          then: d.Table({ ...list, status: "open" }),
        }),
    ],
    Tidy: [archive],
  })
  m.slice()
    .view(d.Table)
    .event(d.Archived, () => ({ status: t.literal("archived") }))
    .actor(d.User)
    .service(d.Svc, "Get")
    .spec("An archived list is archived", {
      given: [d.Created(list), d.Archived({ id: "list-1" })],
      then: d.Table({ ...list, status: "archived" }),
    })
  const feed = feedOf([{ default: m.model("x") }])
  assert.deepEqual(
    drawn(feed).chapters.map((c) => c.slices.map((s) => s.name)),
    [["Create", "Table"], ["Archive"]],
  )
  const table = feed.model.slices.filter((s) => s.sliceType === "STATE_VIEW")
  assert.deepEqual(
    table.map((s) => [
      s.context,
      s.events.map((e) => e.title),
      s.readmodels.map((r) => `${r.service}/${r.apiEndpoint}`),
      s.screens.map((e) => e.title),
      s.specifications.map((t) => t.title),
    ]),
    [
      [
        "Capture",
        ["Created", "Archived"],
        ["Svc/Get"],
        ["Get"],
        ["A new list is open", "An archived list is archived"],
      ],
    ],
  )
})

test("a later .view() that says where or how to draw the slice is an error", () => {
  fixture()
  m.actor("Admin", { icon: "admin" })
  m.screen("Lock")
  chapters({ Capture: [create(), view()], Tidy: [] })
  m.slice("Other")
    .view(d.Table)
    .event(d.Created)
    .chapter(d.Tidy)
    .context({ name: t.string() })
    .actor(d.Admin)
    .screen(d.Lock)
    .service(d.Svc, "List")
    .note("Rebuilt nightly.")
  const drawnAs = (rest: string) =>
    `Table: a later .view() says ${rest}. Remove it, or move the first.`
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.errors?.map((m) => m.message),
    [
      drawnAs("chapter Tidy; the first says chapter Capture"),
      drawnAs('the name "Other"; the first says the name "Table"'),
      drawnAs("actor Admin; the first says actor User"),
      drawnAs("screen Lock; the first says no screen"),
      drawnAs("method Svc/List; the first says method Svc/Get"),
      drawnAs("context name; the first says no context"),
      drawnAs('the note "Rebuilt nightly."; the first says no note'),
    ],
  )
  assert.equal(feed.errors?.[0]?.ui, "Table: its slices disagree on its chapter")
  assert.deepEqual(
    feed.warnings?.map((m) => m.message),
    ["Tidy: no slices. Add .chapter(d.Tidy) to one."],
  )
})

test("a column no m.slice().view() of the view writes is reported once", () => {
  fixture("Table")
  m.view("Table", { id: t.string().key(), name: t.string(), status: t.string() })
  chapters({ Ch: [create(), view(), view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.messages?.map((m) => m.message),
    [
      "Table.status (Ch › Table): no source. Add .event() with an event that carries status, or set it in a mapping.",
    ],
  )
})

test("a single file written top to bottom extends an earlier view in a later chapter", async () => {
  const json = await assemble(here("./fixtures/top-to-bottom"))
  assert.equal(json.messages, undefined)
  assert.equal(json.loose, undefined)
  assert.deepEqual(
    json.aggregates.map((a) => a.id),
    ["notes"],
  )
})

test("a view in given is named as one", () => {
  fixture()
  // The compiler refuses a view in given too.
  const slice = create().spec("t", {
    given: d.Table({ id: "1", name: "n" }),
    when: d.Create({ id: "1", name: "n" }),
    then: d.Created({ id: "1", name: "n" }),
  })
  assert.throws(
    () => assembled([slice, view()]),
    /Table \(Ch › Create\): in given, but is a view\. given lists events that already happened\./,
  )
})

test("a declaration in no slice is storming, with nothing to do", () => {
  fixture()
  m.event("Loose", { id: t.string() })
  m.command("Idle", { id: t.string() })
  chapters({ Ch: [create(), view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.equal(json.messages, undefined)
})

test("everything is on the timeline in declaration order until organized into slices and chapters", () => {
  m.stream("Notes")
  m.chapter("Capture", 1)
  m.event("NoteCaptured", { noteId: t.uuid() }).stream(d.Notes)
  m.event("NoteFiled", { noteId: t.uuid() }).stream(d.Notes)
  m.event("NoteArchived", { noteId: t.uuid() }).stream(d.Notes)
  m.command("FileNote", { noteId: t.uuid() })
  m.slice().command(d.FileNote).event(d.NoteFiled).chapter(d.Capture)
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  // A slice sits where the first of its elements is declared.
  assert.deepEqual(
    feed.model.slices.map((s) => [s.title, s.sliceType, s.context, s.events.map((e) => e.title)]),
    [
      ["NoteCaptured", "STATE_CHANGE", undefined, ["NoteCaptured"]],
      ["FileNote", "STATE_CHANGE", "Capture", ["NoteFiled"]],
      ["NoteArchived", "STATE_CHANGE", undefined, ["NoteArchived"]],
    ],
  )
  assert.deepEqual(
    feed.warnings?.map((w) => w.ui),
    ["Note Filed: missing specification", "Note Filed: unused"],
  )
  const drawing = layout(drawn(feed))
  assert.deepEqual(
    drawing.columns.map((c) => c.title),
    ["Note Captured", "File Note", "Note Archived"],
  )
  assert.deepEqual(
    drawing.rows.map((r) => r.label),
    ["", "Notes"],
    "nothing here has an actor, so no actor has a lane",
  )
})

test("chapters group their slices, and what is in no chapter follows the column declared before it", () => {
  m.chapter("Late", 2)
  m.chapter("Early", 1)
  for (const name of ["C", "A", "X", "B", "Y"]) m.event(name, { id: t.string() })
  for (const name of ["DoC", "DoA", "DoB"]) m.command(name, { id: t.string() })
  m.slice().command(d.DoC).event(d.C)
  m.slice().command(d.DoA).event(d.A).chapter(d.Late)
  m.slice().command(d.DoB).event(d.B).chapter(d.Early)
  const board = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    board.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [
      ["", ["DoC"]],
      ["Early", ["DoB"]],
      ["", ["Y"]],
      ["Late", ["DoA"]],
      ["", ["X"]],
    ],
  )
})

test("a message names its slice by an id no other slice has, so of two slices with one name only its own is marked", () => {
  fixture()
  m.chapter("Lists", 1)
  m.chapter("Imports", 2)
  create().chapter(d.Lists)
  view().chapter(d.Lists)
  m.slice().command(d.Create).event(d.Created).chapter(d.Imports)
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.model.slices.map((s) => [s.id, s.title, s.context]),
    [
      ["create", "Create", "Lists"],
      ["table", "Table", "Lists"],
      ["create-2", "Create", "Imports"],
    ],
  )
  assert.deepEqual(
    feed.warnings?.map((w) => [w.message, w.slice]),
    [
      [
        "Created (Imports › Create): missing specification. Add a .spec whose then has Created(…).",
        "create-2",
      ],
    ],
  )
  assert.deepEqual(
    layout(drawn(feed)).columns.map((c) => [c.title, c.mark]),
    [
      ["Create", undefined],
      ["Table", undefined],
      ["Create", "warning"],
    ],
  )
})

test("a partial assembly lists the warnings and draws each declaration in no slice where it is declared", () => {
  fixture()
  m.stream("Games")
  m.event("Started", { id: t.string() }).stream(d.Games)
  m.event("Ended", { id: t.string() }).stream(d.Games)
  chapters({ Ch: [create()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.messages?.map((m) => [m.kind, m.message, m.ui]),
    [
      [
        "warning",
        "Created (Ch › Create): unused. Add .automation(d.Created), or .event(d.Created) to a state view.",
        "Created: unused",
      ],
      [
        "warning",
        "Created: no stream. Add .stream() where it's declared, with the stream it belongs to.",
        "Created: no stream",
      ],
    ],
  )
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => [s.name, s.events, s.read_models])]),
    [
      ["Ch", [["Create", ["Created(id, name)"], undefined]]],
      [
        "",
        [
          ["Table", undefined, ["Table(*id, name)"]],
          ["Started", ["Started(id)"], undefined],
          ["Ended", ["Ended(id)"], undefined],
        ],
      ],
    ],
  )
  assert.equal(json.loose, undefined)
})

test("an actor in no slice is still one of the model's actors", () => {
  fixture()
  m.actor("Bartender")
  chapters({ Ch: [create()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.actors.map((a) => a.id),
    ["user", "bartender"],
  )
})

test("an external event is drawn in its system's lane", () => {
  m.external("Calendar")
  m.event("Authenticated", { accountId: t.string() }).external(d.Calendar)
  m.event("TaskMoved", { taskId: t.string() }).external(d.Calendar)
  m.command("Connect", { accountId: t.string() })
  m.event("Connected", { accountId: t.string() })
  chapters({ Ch: [m.slice().translation(d.Authenticated).command(d.Connect).event(d.Connected)] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [
      ["", ["TaskMoved"]],
      ["Ch", ["Connect"]],
    ],
  )
  assert.deepEqual(json.chapters[0]?.slices[0]?.calls, [
    { actor: "calendar", event: "TaskMoved(taskId)" },
  ])
  assert.equal(json.chapters[1]?.slices[0]?.external_event, "Authenticated(accountId)")
})

// --- Chapters -----------------------------------------------------------------

test("chapters come in the order of their numbers, each with its slices in the order written", () => {
  fixture()
  m.chapter("Second", 2)
  m.chapter("First", 1).note("Where it starts.")
  // The same chapter, declared again as another module would, is one chapter.
  m.chapter("Second", 2)
  view().chapter(d.Second)
  create().chapter(d.Second)
  m.slice("Recreate")
    .command(d.Create)
    .event(d.Created)
    .spec("A list is created", { when: d.Create(list), then: d.Created(list) })
    .chapter(d.First)
  const json = assembleModules([{ default: m.model("x") }])
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [
      ["First", ["Recreate"]],
      ["Second", ["Table", "Create"]],
    ],
  )
  assert.deepEqual(json.notes.First, [{ text: "Where it starts.", kind: "info" }])
  assert.equal(layout(json).chapters[0]?.note, "Where it starts.")
})

test("a file that imports an example from a later chapter's file still comes first, and so do its lanes", async () => {
  const json = await assemble(here("./fixtures/imported-later"))
  assert.equal(json.messages, undefined)
  assert.deepEqual(
    json.chapters.map((c) => c.name),
    ["Capture", "Filing"],
  )
  assert.deepEqual(
    json.aggregates.map((a) => a.name),
    ["Notes", "Archive"],
  )
})

test("two chapters of one number are an error, and drawn in the order declared", () => {
  const modules = () => {
    fixture()
    m.chapter("A", 1)
    m.chapter("B", 1)
    create().chapter(d.B)
    view().chapter(d.A)
    return [{ default: m.model("x") }]
  }
  assert.throws(
    () => assembleModules(modules()),
    /^Error: B: chapter 1 is taken by A\. Give each its own number\.$/,
  )
  const json = assembleModules(modules(), { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => c.name),
    ["A", "B"],
  )
  assert.deepEqual(json.messages, [
    {
      kind: "error",
      message: "B: chapter 1 is taken by A. Give each its own number.",
      ui: "A, B: both chapter 1",
      element: "",
    },
  ])
})

test("a chapter with no number comes after the numbered ones, in the order declared", () => {
  fixture()
  m.chapter("Capture")
  m.chapter("Filing", 2)
  m.chapter("Review")
  create().chapter(d.Capture)
  view().chapter(d.Filing)
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => c.name),
    ["Filing", "Capture", "Review"],
  )
  assert.deepEqual(
    json.messages?.map((m) => m.message),
    ["Review: no slices. Add .chapter(d.Review) to one."],
  )
})

test("a second .note() adds another, each with its kind, info by default, on a slice and on a declaration", () => {
  fixture("Created")
  m.event("Created", { id: t.string(), name: t.string() })
    .note("Recorded once.")
    .note("Never edited?", "question")
  const noted = create().note("Slow.", "critical").note("Cached.")
  chapters({ Ch: [noted, view()] })
  const feed = feedOf([{ default: m.model("x") }])
  const [slice] = feed.model.slices
  assert.deepEqual(slice?.comments, [
    { description: "Slow.", kind: "critical" },
    { description: "Cached.", kind: "info" },
  ])
  assert.deepEqual(slice?.events[0]?.comments, [
    { description: "Recorded once.", kind: "info" },
    { description: "Never edited?", kind: "question" },
  ])
  const json = drawn(feed)
  assert.deepEqual(json.chapters[0]?.slices[0]?.notes, [
    { text: "Slow.", kind: "critical" },
    { text: "Cached.", kind: "info" },
  ])
  assert.deepEqual(json.notes.Created, [
    { text: "Recorded once.", kind: "info" },
    { text: "Never edited?", kind: "question" },
  ])
})

test("a chapter no slice joins is drawn empty, as a warning", () => {
  fixture()
  chapters({ Ch: [create(), view()] })
  m.chapter("Later", 2)
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(json.chapters.at(-1), { name: "Later", slices: [] })
  assert.deepEqual(json.messages, [
    {
      kind: "warning",
      message: "Later: no slices. Add .chapter(d.Later) to one.",
      ui: "Later: empty",
      element: "",
    },
  ])
  assert.equal(layout(json).chapters.at(-1)?.title, "Later")
})

test("a slice joins one chapter", () => {
  fixture()
  m.chapter("A", 1)
  m.chapter("B", 2)
  view().chapter(d.A)
  create().chapter(d.A).chapter(d.B)
  assert.throws(
    () => assembleModules([{ default: m.model("x") }]),
    /^Error: Create: joins A and B\. Keep one \.chapter\(\)\.$/,
  )
})

test("a partial assembly draws a slice in two chapters in the first, and lists it", () => {
  fixture()
  m.chapter("A", 1)
  m.chapter("B", 2)
  for (const s of [create(), view()]) s.chapter(d.A)
  m.slice().command(d.Create).event(d.Created).chapter(d.A).chapter(d.B)
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.length]),
    [
      ["A", 3],
      ["B", 0],
    ],
  )
  assert.ok(
    json.messages?.some(
      (m) =>
        m.message === "Create: joins A and B. Keep one .chapter()." &&
        m.ui === "Create: in two chapters",
    ),
  )
})

test("a chapter a slice joins that nothing declares", () => {
  const modules = () => {
    fixture("Table")
    create().chapter(d.Later)
    return [{ default: m.model("x") }]
  }
  const message = 'd.Later (Create): not declared. Declare it with m.chapter("Later").'
  const partial = feedOf(modules(), { partial: true })
  assert.deepEqual(
    [...(partial.errors ?? []), ...(partial.warnings ?? [])]
      .filter((m) => m.slice === "create")
      .map((m) => m.message),
    [
      message,
      "Created (Create): unused. Add .automation(d.Created), or .event(d.Created) to a state view.",
    ],
  )
  assert.deepEqual(
    drawn(partial).chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [["", ["Create"]]],
  )
  assert.throws(() => feedOf(modules()), { message })
})

// --- Slices in no chapter -----------------------------------------------------

test("a slice in no chapter is drawn where it is declared, and is not left to do: chapters are optional", () => {
  fixture()
  const base = m.slice().command(d.Create).event(d.Created)
  base.actor(d.User)
  base.service(d.Svc)
  m.slice().view(d.Table).event(d.Created)
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  // The shared prefix is not a slice of its own.
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [["", ["Create", "Create", "Table"]]],
  )
  assert.deepEqual(
    json.messages?.filter((m) => m.message.includes("chapter")),
    [],
  )
})

test("a state view's context written as it once was, as a query, is drawn without it", () => {
  fixture()
  // .context() declares the context, and .query() takes d.Name.
  const shown = m.slice().view(d.Table).event(d.Created).query({ id: t.string() })
  chapters({ Ch: [shown] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    drawn(feed)
      .chapters.find((c) => c.name === "Ch")
      ?.slices.map((s) => s.name),
    ["Table"],
  )
  assert.deepEqual(
    feed.errors?.filter((m) => m.message.includes("not a declaration")),
    [
      {
        kind: "error",
        message: "Ch › Table: [object Object] is not a declaration. Pass d.Name.",
        ui: "Table: a step names no element",
        element: "",
        slice: "table",
      },
    ],
  )
})

test("a slice missing part of its core is drawn with the rest and warns of what it lacks, which a strict assembly lets through", () => {
  const slices = () => {
    fixture()
    return [
      create(),
      m.slice().command(d.Create).actor(d.User),
      m.slice().automation(d.Created),
      view(),
    ]
  }
  chapters({ Ch: slices() })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => [s.name, s.command, s.events]),
    [
      ["Create", "Create(id, name)", ["Created(id, name)"]],
      ["Create", "Create(id, name)", undefined],
      ["Created", undefined, undefined],
      ["Table", undefined, undefined],
    ],
  )
  assert.deepEqual(
    json.messages?.filter((m) => /: no (event|command)\. /.test(m.message)),
    [
      {
        kind: "warning",
        message: "Ch › Create: no event. Add .event() after .command(d.Create).",
        ui: "Create: no event",
        element: "",
        slice: "create-2",
      },
      {
        kind: "warning",
        message: "Ch › Created: no command. Add .command() after .automation(d.Created).",
        ui: "Created: no command",
        element: "",
        slice: "created",
      },
    ],
  )
  assert.ok(layout(json).boxes.length > 0)
  assert.doesNotThrow(() => assembled(slices()))
})

test("a mapping that throws is an error, naming its slice, which is drawn whole", () => {
  fixture()
  const throws = m
    .slice()
    .command(d.Create)
    .event(d.Created, () => ({ id: m.generate("id") }))
  chapters({ Ch: [throws, view()] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => [s.name, s.command, s.events]),
    [
      ["Create", "Create(id, name)", ["Created(id, name)"]],
      ["Table", undefined, undefined],
    ],
  )
  assert.deepEqual(
    json.messages?.filter((m) => m.slice === "create").map((m) => [m.message, m.ui]),
    [
      [
        "Created (Ch › Create): m.generate() takes fields of c, such as m.generate(c.AddNote.title), not id.",
        "Created: generated from something that isn't a field",
      ],
      [
        "Created (Ch › Create): missing specification. Add a .spec whose then has Created(…).",
        "Created: missing specification",
      ],
    ],
  )
})

test("a slice in no chapter is no error", () => {
  fixture()
  view()
  assert.doesNotThrow(() => assembled([create()]))
})

test("an assembly sees only the slices written since the last one", () => {
  fixture("Table")
  create()
  const first = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.equal(first.chapters[0]?.slices.length, 1)
  const second = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(second.chapters, [])
})

test("an example names its declaration in the assembly it is in, so one example serves two", () => {
  const created = d.Created(list)
  const twice = () => {
    fixture()
    chapters({
      Ch: [
        create(),
        unspecifiedView().spec("A list is a row", { given: created, then: d.Table(list) }),
      ],
    })
    const { errors, warnings } = feedOf([{ default: m.model("x") }], { partial: true })
    return [errors, warnings]
  }
  // Nothing is left to do either time.
  assert.deepEqual(twice(), [undefined, undefined])
  assert.deepEqual(twice(), [undefined, undefined])
})

test("loading a model from files sees only the slices its modules write", async () => {
  fixture()
  create()
  const { unchaptered } = await load(here("./fixtures/storming"), { partial: true })
  assert.deepEqual(
    unchaptered.map((s) => [s.name, s.events.map((e) => e.decl.name)]),
    [["CreateNote", ["NoteCreated"]]],
  )
})

test("a name declared twice", () => {
  const modules = () => {
    fixture()
    m.event("Created", { id: t.string() })
    return [{ default: m.model("x") }]
  }
  const twice =
    /^Created: declared twice, at test\/assemble\.test\.ts:\d+ and test\/assemble\.test\.ts:\d+\. Keep one\.$/
  assert.throws(
    () => assembleModules(modules()),
    (e: Error) => twice.test(e.message),
  )
  const json = assembleModules(modules(), { partial: true })
  assert.ok(json.messages?.some((m) => twice.test(m.message) && m.ui === "Created: declared twice"))
})

test("an external system declared in two modules is one lane", async () => {
  const json = await assemble(here("./fixtures/external-twice"), { partial: true })
  assert.deepEqual(
    json.actors.filter((a) => a.type === "external"),
    [{ id: "mail", name: "Mail", type: "external" }],
  )
  assert.deepEqual(
    json.chapters.map((c) => c.slices[0]?.actor),
    ["mail", "mail"],
  )
})

test("an external system no event joins is an empty lane", () => {
  fixture()
  m.external("Mail")
  const json = assembled([create(), view()])
  assert.deepEqual(json.actors.at(-1), { id: "mail", name: "Mail", type: "external" })
  assert.ok(layout(json).rows.some((r) => r.id === "actor:mail"))
})

test("an event in a stream and an external system", () => {
  fixture("Created")
  m.stream("Lists")
  m.external("Mail")
  m.event("Created", { id: t.string(), name: t.string() }).stream(d.Lists).external(d.Mail)
  assert.throws(
    () => assembled([create(), view()]),
    /^Error: Created: in stream Lists and system Mail\. Keep one: \.stream\(\) for ours, \.external\(\) for theirs\.$/,
  )
})

test("a trigger nothing emits yet is drawn on its own, where it is declared", () => {
  fixture("Create", "Table")
  m.command("Process", { id: t.string() })
  m.event("Processed", { id: t.string() })
  chapters({
    Ch: [m.slice("Processor").automation(d.Created).command(d.Process).event(d.Processed)],
  })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => [s.name, s.events])]),
    [
      ["", [["Created", ["Created(id, name)"]]]],
      ["Ch", [["Processor", ["Processed(id)"]]]],
    ],
  )
  const { boxes, edges } = layout(json)
  const id = (name: string) => boxes.find((b) => b.name === name)?.id
  assert.ok(edges.some((e) => e.from === id("Created") && e.to === id("Processor")))
})

test("an example's nested values are printed", () => {
  fixture("Create", "Created", "Table")
  m.command("Order", { id: t.string(), items: t.array(t.object({ name: t.string() })) })
  m.event("Ordered", { id: t.string(), items: t.array(t.object({ name: t.string() })) })
  const slice = m
    .slice()
    .command(d.Order)
    .event(d.Ordered)
    .actor(d.User)
    .service(d.Svc)
    .spec("t", {
      when: d.Order({ id: "1", items: [{ name: "a" }, { name: "b" }] }),
      then: d.Ordered({ id: "1", items: [{ name: "a" }] }),
    })
  chapters({ Ch: [slice] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  const spec = json.chapters[0]?.slices[0]?.tests[0]
  assert.deepEqual(
    [spec?.when, spec?.then],
    ["Order(id=1, items=[{name=a}, {name=b}])", ["Ordered(id=1, items=[{name=a}])"]],
  )
})

// --- A specification agrees with what flows into it. ---------------------------

/** What a partial assembly says about the specifications of `slices`. */
function disagreements(slices: readonly Slice[]): string[] {
  chapters({ Ch: slices })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  return (json.messages ?? []).map((m) => m.message).filter((m) => / in ".*" \(/.test(m))
}

test("a state change's then has what its command sends and its mapping sets", () => {
  const tags = t.array(t.object({ name: t.string() }))
  const sent = { id: "a-1", text: "buy milk", tags: [{ name: "food" }] }
  /** The slice, specified so it agrees and, when `wrong`, so it does not too. */
  const add = (wrong: boolean) => {
    fixture()
    m.command("Add", { id: t.string(), text: t.string(), tags })
    m.event("Added", {
      id: t.string(),
      title: t.string(),
      status: t.string(),
      at: t.string(),
      tags,
    })
    const slice = m
      .slice()
      .command(d.Add)
      .event(d.Added, (c: C) => ({
        title: c.Add.text,
        status: t.literal("open"),
        at: m.generate(),
      }))
      .spec("agrees", {
        when: d.Add(sent),
        then: d.Added({
          id: "a-1",
          title: "buy milk",
          status: "open",
          at: "any",
          tags: [{ name: "food" }],
        }),
      })
    if (!wrong) return slice
    return slice.spec("disagrees", {
      when: d.Add(sent),
      then: d.Added({
        id: "a-2",
        title: "buy bread",
        status: "done",
        at: "any",
        tags: [{ name: "drink" }],
      }),
    })
  }
  assert.deepEqual(disagreements([add(false)]), [])
  assert.deepEqual(disagreements([add(true)]), [
    'Added.id in "disagrees" (Ch › Add): then has "a-2", but when sends "a-1".',
    'Added.title in "disagrees" (Ch › Add): then has "buy bread", but when sends text "buy milk".',
    `Added.status in "disagrees" (Ch › Add): then has "done", but Added's mapping sets "open".`,
    'Added.tags in "disagrees" (Ch › Add): then has [{"name":"drink"}], but when sends [{"name":"food"}].',
  ])
  chapters({ Ch: [add(true)] })
  const json = assembleModules([{ default: m.model("x") }], { partial: true })
  assert.ok(json.messages?.some((m) => m.element === "Added" && m.slice === "add"))
  chapters({ Ch: [add(true)] })
  assert.throws(
    () => assembleModules([{ default: m.model("x") }]),
    // Every problem, not just the first.
    /^Error: Added\.id in "disagrees" \(Ch › Add\): then has "a-2", but when sends "a-1"\.\nAdded\.title in "disagrees" /,
  )
})

test("an external event's fields come from outside, so its then may have anything", () => {
  fixture()
  m.external("Remote")
  m.event("Answered", { id: t.string(), name: t.string() }).external(d.Remote)
  const ask = m
    .slice()
    .command(d.Create)
    .event(d.Answered)
    .spec("answered", {
      when: d.Create(list),
      then: d.Answered({ id: "other", name: "other" }),
    })
  assert.deepEqual(disagreements([ask]), [])
})

test("an automation's when has what its trigger in given carries and its mapping sets", () => {
  /** The slice, specified so it agrees and, when `wrong`, so it does not too. */
  const processor = (wrong: boolean) => {
    fixture()
    m.command("Process", { id: t.string(), label: t.string(), by: t.string() })
    m.event("Processed", { id: t.string() })
    const slice = m
      .slice("Processor")
      .automation(d.Created)
      .command(d.Process, (c: C) => ({ label: c.Created.name, by: t.literal("processor") }))
      .event(d.Processed)
      .spec("agrees", {
        given: d.Created(list),
        when: d.Process({ id: "list-1", label: "Groceries", by: "processor" }),
        then: d.Processed({ id: "list-1" }),
      })
      .spec("no trigger given", {
        when: d.Process({ id: "list-9", label: "Anything", by: "processor" }),
        then: d.Processed({ id: "list-9" }),
      })
    if (!wrong) return slice
    return slice.spec("disagrees", {
      given: d.Created(list),
      when: d.Process({ id: "list-2", label: "Chores", by: "someone" }),
      then: d.Processed({ id: "list-3" }),
    })
  }
  assert.deepEqual(disagreements([processor(false)]), [])
  assert.deepEqual(disagreements([processor(true)]), [
    'Process.id in "disagrees" (Ch › Processor): when has "list-2", but Created in given has "list-1".',
    'Process.label in "disagrees" (Ch › Processor): when has "Chores", but Created in given has name "Groceries".',
    `Process.by in "disagrees" (Ch › Processor): when has "someone", but Process's mapping sets "processor".`,
    'Processed.id in "disagrees" (Ch › Processor): then has "list-3", but when sends "list-2".',
  ])
})

test("a view's rows have what given builds, matched by key", () => {
  const groceries = { userId: "u-1", listId: "l-1" }
  const chores = { userId: "u-1", listId: "l-2" }
  /** The projection, specified by `then` from the same given. */
  const projection = (name: string, then: (typeof groceries & Record<string, unknown>)[]) => {
    m.view("Lists", {
      userId: t.string().key(),
      listId: t.string().key(),
      name: t.string(),
      title: t.string(),
      items: t.int(),
      status: t.string(),
    })
    m.event("ListCreated", { userId: t.string(), listId: t.string(), name: t.string() })
    m.event("ItemAdded", { userId: t.string(), listId: t.string() })
    m.event("ListClosed", { userId: t.string(), listId: t.string() })
    return m
      .slice()
      .view(d.Lists)
      .event(d.ListCreated, (c: C) => ({
        title: c.ListCreated.name,
        items: t.literal(0),
        status: t.literal("open"),
      }))
      .event(d.ItemAdded, (c: C) => ({ items: m.generate(c.ItemAdded) }))
      .event(d.ListClosed, () => ({ status: t.literal("closed") }))
      .spec(name, {
        given: [
          d.ListCreated({ ...groceries, name: "Groceries" }),
          d.ListCreated({ ...chores, name: "Chores" }),
          d.ItemAdded(groceries),
          d.ItemAdded(groceries),
          d.ListClosed(chores),
        ],
        then: then.map((row) => d.Lists(row)),
      })
  }
  const agrees = projection("agrees", [
    { ...groceries, name: "Groceries", title: "Groceries", items: 2, status: "open" },
    { ...chores, name: "Chores", title: "Chores", items: 0, status: "closed" },
  ])
  assert.deepEqual(disagreements([agrees]), [])
  const wrong = projection("disagrees", [
    { ...groceries, name: "Chores", title: "Chores", items: 1, status: "closed" },
    { ...chores, status: "open" },
  ])
  assert.deepEqual(disagreements([wrong]), [
    'Lists.name in "disagrees" (Ch › Lists): then has "Chores", but ListCreated in given has "Groceries".',
    'Lists.title in "disagrees" (Ch › Lists): then has "Chores", but ListCreated in given has name "Groceries".',
    `Lists.status in "disagrees" (Ch › Lists): then has "closed", but ListCreated's mapping sets "open".`,
    `Lists.status in "disagrees" (Ch › Lists): then has "open", but ListClosed's mapping sets "closed".`,
  ])
})

test("a list view: each event adds a row, told apart by every value, and drawn as a list", () => {
  const projection = () => {
    m.event("Captured", { noteId: t.string() })
    m.event("Edited", { noteId: t.string() })
    m.view("Activity", t.array({ noteId: t.string().key(), what: t.string() }))
    return m
      .slice()
      .view(d.Activity)
      .event(d.Captured, () => ({ what: t.literal("captured") }))
      .event(d.Edited, () => ({ what: t.literal("edited") }))
      .context({ noteId: t.string() })
  }
  const given = () => [d.Captured({ noteId: "n-1" }), d.Edited({ noteId: "n-1" })]
  const both = projection().spec("both", {
    given: given(),
    when: { noteId: "n-1" },
    then: [
      d.Activity({ noteId: "n-1", what: "captured" }),
      d.Activity({ noteId: "n-1", what: "edited" }),
    ],
  })
  assert.deepEqual(disagreements([both]), [])
  const one = projection().spec("one", {
    given: given(),
    when: { noteId: "n-1" },
    then: d.Activity({ noteId: "n-1", what: "captured" }),
  })
  assert.deepEqual(disagreements([one]), [
    'Activity in "one" (Ch › Activity): given builds {"noteId":"n-1","what":"edited"}, but then leaves it out. Add it to then.',
  ])
  chapters({ Ch: [projection()] })
  const feed = feedOf([{ default: m.model("x") }], { partial: true })
  const [table] = feed.model.slices.find((s) => s.title === "Activity")?.readmodels ?? []
  assert.deepEqual([table?.fields.type, table?.key], ["array", ["noteId"]])
  const board = drawn(feed)
  const activity = board.chapters.find((c) => c.name === "Ch")?.slices[0]
  assert.deepEqual(activity?.read_models, ["Activity[](*noteId, what)"])
  assert.deepEqual(
    layout(board)
      .boxes.filter((b) => b.name === "Activity")
      .map((b) => b.list),
    [true],
  )
})

// --- A query: the rows a filter picks from what given builds. -----------------

/** The eventsourcing book's cart: a price change archives the item in every cart that holds it. */
function cart() {
  m.command("CreateCart", { aggregateId: t.uuid() })
  m.event("CartCreated", { aggregateId: t.uuid() })
  m.command("AddItem", {
    aggregateId: t.uuid(),
    itemId: t.uuid(),
    productId: t.uuid(),
    price: t.number(),
  })
  m.event("ItemAdded", {
    aggregateId: t.uuid(),
    itemId: t.uuid(),
    productId: t.uuid(),
    price: t.number(),
  })
  m.command("ChangePrice", { productId: t.uuid(), oldPrice: t.number(), newPrice: t.number() })
  m.event("PriceChanged", { productId: t.uuid(), oldPrice: t.number(), newPrice: t.number() })
  m.view("CartsWithProducts", {
    aggregateId: t.uuid().key(),
    productId: t.uuid().key(),
    itemId: t.uuid(),
  })
  m.command("ArchiveItem", { aggregateId: t.uuid(), productId: t.uuid() })
  m.event("ItemArchived", { aggregateId: t.uuid(), itemId: t.uuid() })
  m.view("ArchivedItems", { aggregateId: t.uuid(), itemId: t.uuid().key() })
  m.actor("User")
}

const cartId = "11111111-1111-4111-8111-111111111111"
const otherCart = "22222222-2222-4222-8222-222222222222"
const productId = "33333333-3333-4333-8333-333333333333"
const itemId = "44444444-4444-4444-8444-444444444444"

/**
 * The book's ArchiveItem slice: the processor finds the carts that hold the product, and the
 * handler reads the one row its command is for.
 */
const archiveItem = () =>
  m
    .slice("ArchiveItemScheduler")
    .automation(d.PriceChanged)
    .query(d.CartsWithProducts, "productId")
    .command(d.ArchiveItem)
    .query(d.CartsWithProducts, (c: C) => ({
      aggregateId: c.ArchiveItem.aggregateId,
      productId: c.ArchiveItem.productId,
    }))
    .event(d.ItemArchived)

test("the book's ArchiveItem slice: a price change archives the item in the cart that holds it", () => {
  cart()
  const added = d.ItemAdded({ aggregateId: cartId, itemId, productId, price: 10 })
  const story = [
    m
      .slice()
      .command(d.CreateCart)
      .event(d.CartCreated)
      .actor(d.User)
      .spec("A cart is created", {
        when: d.CreateCart({ aggregateId: cartId }),
        then: d.CartCreated({ aggregateId: cartId }),
      }),
    m
      .slice()
      .command(d.AddItem)
      .event(d.ItemAdded)
      .actor(d.User)
      .spec("An item is added", {
        when: d.AddItem({ aggregateId: cartId, itemId, productId, price: 10 }),
        then: added,
      }),
    m
      .slice()
      .command(d.ChangePrice)
      .event(d.PriceChanged)
      .actor(d.User)
      .spec("A price changes", {
        when: d.ChangePrice({ productId, oldPrice: 10, newPrice: 12 }),
        then: d.PriceChanged({ productId, oldPrice: 10, newPrice: 12 }),
      }),
    m
      .slice()
      .view(d.CartsWithProducts)
      .event(d.ItemAdded)
      .spec("An added item is in its cart", {
        given: added,
        then: d.CartsWithProducts({ aggregateId: cartId, productId, itemId }),
      }),
    archiveItem().spec("A price change archives the item", {
      given: [
        d.CartCreated({ aggregateId: cartId }),
        added,
        d.PriceChanged({ productId, oldPrice: 10, newPrice: 12 }),
      ],
      when: d.ArchiveItem({ aggregateId: cartId, productId }),
      then: d.ItemArchived({ aggregateId: cartId, itemId }),
    }),
    m
      .slice()
      .view(d.ArchivedItems)
      .event(d.ItemArchived)
      .actor(d.User)
      .spec("An archived item is listed", {
        given: d.ItemArchived({ aggregateId: cartId, itemId }),
        then: d.ArchivedItems({ aggregateId: cartId, itemId }),
      }),
  ]
  chapters({ Ch: story })
  const feed = feedOf([{ default: m.model("x") }])
  assert.deepEqual([feed.errors, feed.warnings], [undefined, undefined])
  drawn(feed)
  const slice = feed.model.slices.find((s) => s.title === "ArchiveItemScheduler")
  const command = slice?.commands[0]
  assert.deepEqual(slice?.mappings, {
    ArchiveItem: { aggregateId: "CartsWithProducts(productId).aggregateId" },
    ItemArchived: { itemId: "CartsWithProducts(aggregateId, productId).itemId" },
  })
  const read = slice?.readmodels.find((r) => r.title === "CartsWithProducts")
  assert.deepEqual(
    read?.dependencies.map((d) => [d.type, d.title]),
    [["OUTBOUND", "ArchiveItem"]],
  )
  assert.ok(
    command?.dependencies.some((d) => d.type === "INBOUND" && d.title === "CartsWithProducts"),
  )
})

/** A projection of the cart's view, so a query has rows to pick from. */
const cartsView = () => m.slice().view(d.CartsWithProducts).event(d.ItemAdded)

test("an automation's when is for one of the rows its query picks", () => {
  cart()
  const inCart = (aggregateId: string) => d.ItemAdded({ aggregateId, itemId, productId, price: 10 })
  const given = [inCart(cartId), inCart(otherCart), d.PriceChanged({ productId, newPrice: 12 })]
  const slice = archiveItem()
    .spec("agrees", {
      given,
      when: d.ArchiveItem({ aggregateId: otherCart, productId }),
      then: d.ItemArchived({ aggregateId: otherCart }),
    })
    .spec("disagrees", {
      given,
      when: d.ArchiveItem({ aggregateId: "55555555-5555-4555-8555-555555555555", productId }),
      then: d.ItemArchived({ aggregateId: "55555555-5555-4555-8555-555555555555" }),
    })
  assert.deepEqual(disagreements([slice, cartsView()]), [
    `CartsWithProducts in "disagrees" (Ch › ArchiveItemScheduler): when matches none of the 2 rows with {"productId":"${productId}"}.`,
  ])
})

test("a query that picks no row: an automation issues nothing, and a command is refused", () => {
  cart()
  const issues = archiveItem().spec("no cart holds the product", {
    given: d.PriceChanged({ productId, newPrice: 12 }),
    when: d.ArchiveItem({ aggregateId: cartId, productId }),
    then: d.ItemArchived({ aggregateId: cartId }),
  })
  assert.deepEqual(disagreements([issues, cartsView()]), [
    `CartsWithProducts in "no cart holds the product" (Ch › ArchiveItemScheduler): given builds no row with {"productId":"${productId}"}, so ArchiveItem is never issued. Add the event that builds it.`,
  ])
  cart()
  const archive = m
    .slice()
    .command(d.ArchiveItem)
    .query(d.CartsWithProducts, (x: C) => ({
      aggregateId: x.ArchiveItem.aggregateId,
      productId: x.ArchiveItem.productId,
    }))
    .event(d.ItemArchived, (x: C) => ({
      itemId: m.generate(x.ArchiveItem.productId),
    }))
    .spec("archived", {
      when: d.ArchiveItem({ aggregateId: cartId, productId }),
      then: d.ItemArchived({ aggregateId: cartId }),
    })
    .spec("refused", {
      when: d.ArchiveItem({ aggregateId: cartId, productId }),
      reject: "the cart does not hold the product",
    })
    .spec("described", {
      when: d.ArchiveItem({ aggregateId: cartId, productId }),
      then: "The cart no longer holds the product",
    })
  assert.deepEqual(disagreements([archive, cartsView()]), [
    `CartsWithProducts in "archived" (Ch › ArchiveItem): given builds no row with {"aggregateId":"${cartId}","productId":"${productId}"}, so ArchiveItem is refused. Add the event that builds it, or reject.`,
    `CartsWithProducts in "described" (Ch › ArchiveItem): given builds no row with {"aggregateId":"${cartId}","productId":"${productId}"}, so ArchiveItem is refused. Add the event that builds it, or reject.`,
  ])
})

test("a translation whose query picks no row never issues its command", () => {
  m.external("Provider")
  m.event("Authorized", { state: t.string() }).external(d.Provider)
  m.view("Pending", { state: t.string().key() })
  m.event("Requested", { state: t.string() })
  m.command("Complete", { state: t.string() })
  m.event("Completed", { state: t.string() })
  const forged = m
    .slice()
    .translation(d.Authorized)
    .query(d.Pending, "state")
    .command(d.Complete)
    .event(d.Completed)
    .spec("forged", {
      given: d.Authorized({ state: "s-1" }),
      when: d.Complete({ state: "s-1" }),
      then: d.Completed({ state: "s-1" }),
    })
  assert.deepEqual(disagreements([forged, m.slice().view(d.Pending).event(d.Requested)]), [
    `Pending in "forged" (Ch › Complete): given builds no row with {"state":"s-1"}, so Complete is never issued. Add the event that builds it.`,
  ])
})

test("an event nothing uses is one line, naming every slice that records it", () => {
  fixture()
  m.command("Recreate", { id: t.string(), name: t.string() })
  const again = m.slice().command(d.Recreate).event(d.Created)
  chapters({ Ch: [unspecified(), again] })
  const json = feedOf([{ default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.warnings?.flatMap((m) => (m.message.includes("unused") ? [m.message] : [])),
    [
      "Created (Ch › Create, Ch › Recreate): unused. Add .automation(d.Created), or .event(d.Created) to a state view.",
    ],
  )
})

test("t.literal([]) sets the empty list, a constant", () => {
  m.actor("User")
  m.command("Plan", { weekOf: t.string() })
  m.event("Planned", { weekOf: t.string() })
  m.view("Groceries", { weekOf: t.string().key(), added: t.array(t.string()) })
  const week = { weekOf: "2026-11-23" }
  chapters({
    Ch: [
      m
        .slice()
        .command(d.Plan)
        .event(d.Planned)
        .actor(d.User)
        .spec("A week is planned", { when: d.Plan(week), then: d.Planned(week) }),
      m
        .slice()
        .view(d.Groceries)
        .event(d.Planned, () => ({ added: t.literal([]) }))
        .actor(d.User)
        .spec("A new week has nothing added", {
          given: d.Planned(week),
          then: d.Groceries({ ...week, added: [] }),
        }),
    ],
  })
  const feed = feedOf([{ default: m.model("x") }])
  const groceries = feed.model.slices.find((s) => s.title === "Groceries")
  assert.deepEqual(groceries?.mappings, { Planned: { added: "= []" } })
})
