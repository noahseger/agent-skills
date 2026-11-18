import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { type Chapter, type EventDecl, m, type Slice } from "#em"

import { type Feed, assemble as feedAt, assembleModules as feedOf, load } from "../src/assemble.ts"
import { toFeed } from "../src/spec.ts"
import { DRAFTS, META } from "../src/types.ts"
import { validate } from "../src/validate.ts"
import { layout } from "../viewer/src/layout.ts"
import { read } from "../viewer/src/read.ts"

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

function fixture() {
  const User = m.actor()
  const Svc = m.service("t.v1")
  const Create = m.command({ id: z.string(), name: z.string() })
  const Created = m.event({ id: z.string(), name: z.string() })
  const Table = m.view({ id: z.string(), name: z.string() }).key("id")
  return { User, Svc, Create, Created, Table }
}
type Fixture = ReturnType<typeof fixture>

const list = { id: "list-1", name: "Groceries" }
const unspecified = (f: Fixture) =>
  m.slice().command({ Create: f.Create }).event({ Created: f.Created }).actor(f.User).service(f.Svc)
const create = (f: Fixture) =>
  unspecified(f).test("A list is created", { when: f.Create(list), then: f.Created(list) })
const unspecifiedView = (f: Fixture, ...events: Record<string, EventDecl>[]) => {
  let built = m.slice().view({ Table: f.Table }).event({ Created: f.Created })
  for (const e of events) built = built.event(e)
  return built.actor(f.User).service(f.Svc, "Get")
}
const view = (f: Fixture, ...events: Record<string, EventDecl>[]) =>
  unspecifiedView(f, ...events).test("A new list is a row", {
    given: f.Created(list),
    then: f.Table(list),
  })
/** A view's specification that needs no event. */
const nothing = ["No list shows before one is created", { then: [] }] as const

/** A chapter per key, declared in key order, that its slices join in array order. */
function chapters(story: Record<string, readonly Slice[]>): Record<string, Chapter> {
  return Object.fromEntries(
    Object.entries(story).map(([name, slices]) => {
      const chapter = m.chapter()
      for (const s of slices) s.chapter(chapter)
      return [name, chapter]
    }),
  )
}

/** One module exporting `exports` and a model of one chapter, `Ch`. */
function assembled(exports: Record<string, unknown>, slices: readonly Slice[]) {
  return assembleModules([{ ...exports, ...chapters({ Ch: slices }), default: m.model("x") }])
}

test("a well-formed model assembles", () => {
  const f = fixture()
  const json = assembled(f, [create(f), view(f)])
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.name),
    ["Create", "Table"],
  )
  assert.deepEqual(json.aggregates, [{ id: "events", name: "Events" }])
})

test("a declaration used in a slice that no module exports", () => {
  const { Created, ...f } = fixture()
  assert.throws(
    () => assembled(f, [create({ ...f, Created }), view({ ...f, Created })]),
    /Ch › slice 1: this slice uses an event that isn't exported\. Export it to give it a name\./,
  )
})

test("a declaration exported under two names", () => {
  const f = fixture()
  assert.throws(
    () => assembled({ ...f, Also: f.Created }, [create(f), view(f)]),
    /Created is exported twice, also as Also\. Keep one\./,
  )
})

test("a call names its declaration as it is exported: a bare or renamed one is drawn, and left to do", () => {
  const said = [
    "Ch › Create: pass Create as { Create }, so the compiler knows its name.",
    "Ch › Renamed: { Made: Created } renames Created. Write { Created }: a mapping reads it as c.Created.",
  ]
  const modules = () => {
    const f = fixture()
    // @ts-expect-error a bare declaration: the compiler refuses it too
    const bare = m.slice().command(f.Create).event({ Created: f.Created })
    const renamed = m.slice("Renamed").command({ Create: f.Create }).event({ Made: f.Created })
    return [{ ...f, ...chapters({ Ch: [bare, renamed, view(f)] }), default: m.model("x") }]
  }
  const partial = feedOf(modules(), { partial: true })
  assert.deepEqual(
    partial.warnings?.flatMap((w) => (said.includes(w.message) ? [w.message] : [])),
    said,
  )
  assert.deepEqual(
    drawn(partial).chapters[0]?.slices.map((s) => s.name),
    ["Create", "Renamed", "Table"],
  )
  assert.throws(() => feedOf(modules()), /renames Created/)
})

test("an event field the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  assert.throws(
    () => assembled({ ...f, Created }, [unspecified({ ...f, Created }), view({ ...f, Created })]),
    /Ch › Create: Created\.extra has no value\. Add extra to a step before \.event\(\) or set it in the mapping\./,
  )
})

test("a model still being written draws with a field that has no value", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const Ch = [unspecified({ ...f, Created })]
  const json = assembleModules([{ ...f, Created, ...chapters({ Ch }), default: m.model("x") }], {
    partial: true,
  })
  assert.equal(json.chapters[0]?.slices.length, 1)
  assert.ok(json.warnings?.some((w) => w.message.includes("Created.extra has no value")))
})

test("an optional field one slice leaves unfilled, another fills", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string().optional() })
  const CreateWith = m.command({ id: z.string(), name: z.string(), extra: z.string() })
  const withExtra = { ...list, extra: "x" }
  const json = assembled({ ...f, Created, CreateWith }, [
    create({ ...f, Created }),
    m
      .slice()
      .command({ CreateWith })
      .event({ Created })
      .test("A list is created with extra", {
        when: CreateWith(withExtra),
        then: Created(withExtra),
      }),
    view({ ...f, Created }),
  ])
  assert.equal(json.warnings, undefined)
})

test("an optional field no slice fills", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string().optional() })
  const exports = { ...f, Created }
  const slices = () => [create(exports), view(exports)]
  const message =
    "Created.extra is never filled by any slice. Add extra to a command that records Created, or set it in a mapping."
  assert.throws(() => assembled(exports, slices()), { message })
  const json = assembleModules(
    [{ ...exports, ...chapters({ Ch: slices() }), default: m.model("x") }],
    {
      partial: true,
    },
  )
  assert.deepEqual(json.warnings, [{ message, element: "Created" }])
})

test("a mapping function fills what the command does not carry", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const slice = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created }, (c) => ({ extra: c.Create.name }))
    .actor(f.User)
    .service(f.Svc)
    .test("A list is created", {
      when: f.Create(list),
      then: Created({ ...list, extra: "Groceries" }),
    })
  const json = assembled({ ...f, Created }, [slice, view({ ...f, Created })])
  assert.deepEqual(json.chapters[0]?.slices[0]?.mapping, { Created: { extra: { from: "name" } } })
  assert.equal(json.chapters[0]?.slices[0]?.command, "Create(id, name)")
})

test("a mapping spreads a whole declaration and sets the rest from another", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), extra: z.string() })
  const slice = m
    .slice()
    .command({ Create: f.Create })
    .query({ Table: f.Table }, "id")
    .event({ Created }, (c) => ({ ...c.Create, extra: c.Table.name }))
    .actor(f.User)
    .service(f.Svc)
    .test("A list is renamed", {
      given: Created({ ...list, extra: "" }),
      when: f.Create({ ...list, name: "Errands" }),
      then: Created({ ...list, name: "Errands", extra: "Groceries" }),
    })
  const exports = { ...f, Created }
  const feed = feedOf([
    { ...exports, ...chapters({ Ch: [slice, view(exports)] }), default: m.model("x") },
  ])
  assert.deepEqual(feed.model.slices[0]?.mappings, {
    Created: { id: "id", name: "name", extra: "Table(id).name" },
  })
})

test("m.generate() records what a value is made from, and a specification gives it any value", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), name: z.string(), at: z.string() })
  const slice = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created }, (c) => ({ at: m.generate(c.Create.id, c.Create.name) }))
    .actor(f.User)
    .service(f.Svc)
    .test("Create", {
      when: f.Create({ id: "id-1", name: "Groceries" }),
      then: Created({ id: "id-1", name: "Groceries", at: "2026-01-01T00:00:00Z" }),
    })
  const exports = { ...f, Created }
  const story = chapters({ Ch: [slice, view(exports)] })
  const feed = feedOf([{ ...exports, ...story, default: m.model("x") }])
  assert.deepEqual(feed.model.slices[0]?.mappings, { Created: { at: "generate(id, name)" } })
  assert.deepEqual(drawn(feed).chapters[0]?.slices[0]?.mapping, {
    Created: { at: { generate: ["id", "name"] } },
  })
})

test("m.generate() in a specification is one value of its field's type wherever the test uses it, the same every run", () => {
  const f = fixture()
  const fields = {
    id: z.string(),
    gameId: z.uuid(),
    ply: z.number().int(),
    side: z.enum(["white", "black"]),
    at: z.iso.datetime(),
  }
  const Moved = m.event(fields)
  const Moves = m.view(fields).key("id")
  const model = () => {
    const shown = m
      .slice()
      .view({ Moves })
      .event({ Moved })
      .actor(f.User)
      .service(f.Svc, "Get")
      .test("agrees", () => {
        const move = {
          id: m.generate(),
          gameId: m.generate(),
          ply: m.generate(),
          side: m.generate(),
          at: m.generate(),
        }
        return { given: Moved(move), then: Moves(move) }
      })
      .test("disagrees", { given: Moved({ id: m.generate() }), then: Moves({ id: m.generate() }) })
    return { ...f, Moved, Moves, ...chapters({ Ch: [shown] }), default: m.model("x") }
  }
  const feed = feedOf([model()], { partial: true })
  drawn(feed)
  const said = (name: string) =>
    (feed.warnings ?? []).filter((w) => w.message.includes(`"${name}"`)).map((w) => w.message)
  assert.deepEqual(said("agrees"), [])
  assert.match(
    said("disagrees")[0] ?? "",
    /then has Moves \{"id":"[^"]+"\}, but given builds no such row\./,
  )
  const [agrees] = feed.model.slices[0]?.specifications ?? []
  const given = agrees?.given[0]?.examples?.[0]
  assert.deepEqual(given, agrees?.then[0]?.examples?.[0])
  assert.equal(z.object(fields).safeParse(given).success, true)
  assert.deepEqual(feedOf([model()], { partial: true }).model, feed.model)
})

test("m.generate() nested in a list is one value of its field's type, as at the top", () => {
  const f = fixture()
  const Item = z.object({ itemId: z.uuid(), price: z.number() })
  const Added = m.event({ id: z.string(), itemId: z.uuid(), price: z.number() })
  const Cart = m.view({ id: z.string(), items: z.array(Item) }).key("id")
  const shown = m
    .slice()
    .view({ Cart })
    .event({ Added }, (c) => ({ items: m.generate(c.Added) }))
    .actor(f.User)
    .test("lists", () => {
      const itemId = m.generate()
      return {
        given: Added({ id: "c-1", itemId, price: 2 }),
        then: Cart({ id: "c-1", items: [{ itemId, price: 2 }] }),
      }
    })
  const model = { ...f, Added, Cart, ...chapters({ Ch: [shown] }), default: m.model("x") }
  const feed = feedOf([model], { partial: true })
  assert.deepEqual(
    feed.warnings?.filter((w) => w.message.includes('"lists"')),
    [],
  )
  const [spec] = feed.model.slices[0]?.specifications ?? []
  const given = spec?.given[0]?.examples?.[0] as { itemId: string }
  const then = spec?.then[0]?.examples?.[0] as { items: { itemId: string }[] }
  assert.equal(then.items[0]?.itemId, given.itemId)
  assert.equal(z.uuid().safeParse(given.itemId).success, true)
})

test("an example Zod refuses is a to-do naming the spec and where in it, and the model still draws", () => {
  const f = fixture()
  const Item = z.object({ itemId: z.uuid() })
  const Cart = m.view({ id: z.string(), items: z.array(Item) }).key("id")
  const shown = m
    .slice()
    .view({ Cart })
    .event({ Created: f.Created })
    .actor(f.User)
    .test("lists", {
      given: f.Created(list),
      then: Cart({ id: "list-1", items: [{ itemId: 7 as never }] }),
    })
  const model = { ...f, Cart, ...chapters({ Ch: [shown] }), default: m.model("x") }
  const feed = feedOf([model], { partial: true })
  drawn(feed)
  assert.deepEqual(
    feed.warnings?.filter((w) => w.message.includes('"lists"')),
    [
      {
        message: `Ch › Cart › "lists": items[0].itemId: Invalid input: expected string, received number`,
        element: "Cart",
        slice: "Cart",
      },
    ],
  )
})

test("a command field no event records is left to do, and an error when strict; generating from it records it", () => {
  const f = fixture()
  const Created = m.event({ id: z.string(), slug: z.string() })
  const model = (recorded: boolean) => {
    const slice = m
      .slice()
      .command({ Create: f.Create })
      .event({ Created }, (c) => ({ slug: recorded ? m.generate(c.Create.name) : m.generate() }))
      .test("Create", { when: f.Create(list), then: Created({ id: "list-1", slug: "groceries" }) })
    return { ...f, Created, ...chapters({ Ch: [slice] }), default: m.model("x") }
  }
  const message =
    "Ch › Create: Create.name reaches no event. Record it in Created, or remove it from Create."
  const json = feedOf([model(false)], { partial: true })
  assert.ok(json.warnings?.some((w) => w.message === message))
  assert.throws(() => feedOf([model(false)]), { message: new RegExp(message) })
  const fixed = feedOf([model(true)], { partial: true })
  assert.ok(!fixed.warnings?.some((w) => w.message.includes("reaches no event")))
})

test("a call sends its command's fields out, so none is left unrecorded", () => {
  const f = fixture()
  const Remote = m.external()
  const Answered = m.event({ id: z.string() }).external(Remote)
  const Ask = m.command({ id: z.string(), note: z.string() })
  const ask = m.slice().command({ Ask }).event({ Answered }).actor(f.User).service(f.Svc)
  const model = { ...f, Remote, Answered, Ask, ...chapters({ Ch: [ask] }), default: m.model("x") }
  const json = feedOf([model], { partial: true })
  assert.ok(!json.warnings?.some((w) => w.message.includes("reaches no event")))
})

test("a command field that filters a query after the command is used", () => {
  const f = fixture()
  const Renamed = m.event({ id: z.string() })
  const rename = m
    .slice()
    .command({ Create: f.Create })
    .query({ Table: f.Table }, (c) => ({ id: c.Create.id, name: c.Create.name }))
    .event({ Renamed })
    .actor(f.User)
  const model = { ...f, Renamed, ...chapters({ Ch: [rename] }), default: m.model("x") }
  const json = feedOf([model], { partial: true })
  assert.ok(!json.warnings?.some((w) => w.message.includes("reaches no event")))
})

test("a mapping that returns a whole command records only the fields its event has", () => {
  const f = fixture()
  const Renamed = m.event({ id: z.string() })
  const rename = m
    .slice()
    .command({ Create: f.Create })
    .event({ Renamed }, (c) => c.Create)
    .actor(f.User)
  const model = { ...f, Renamed, ...chapters({ Ch: [rename] }), default: m.model("x") }
  const json = feedOf([model], { partial: true })
  assert.ok(
    json.warnings?.some(
      (w) =>
        w.message ===
        "Ch › Create: Create.name reaches no event. Record it in Renamed, or remove it from Create.",
    ),
  )
})

test("a mapping recognises a source field, a z.literal() and m.generate(); a schema it computes is left to do", () => {
  const f = fixture()
  const Create = m.command({ id: z.string(), name: z.string() })
  const Created = m.event({
    id: z.string(),
    name: z.string(),
    alias: z.string(),
    label: z.string(),
    size: z.number(),
  })
  const exports = { ...f, Create, Created }
  // An assembly takes the slices written since the last, so each is written afresh.
  const modules = () => {
    const slice = m
      .slice()
      .command({ Create })
      .event({ Created }, (c) => ({
        alias: c.Create.id,
        label: c.Create.name.toUpperCase(),
        size: z.literal(2),
      }))
      .test("Create", {
        when: Create(list),
        then: Created({ ...list, alias: "list-1", label: "x", size: 2 }),
      })
    const story = chapters({ Ch: [slice, view(exports)] })
    return [{ ...exports, ...story, default: m.model("x") }]
  }
  const label =
    "Ch › Create: Created.label is computed in the mapping. Set it to a source field, a z.literal() or m.generate() with what it is made from."
  const partial = feedOf(modules(), { partial: true })
  assert.deepEqual(
    partial.warnings?.filter((w) => w.slice === "Create").map((w) => w.message),
    [label],
  )
  assert.deepEqual(drawn(partial).chapters[0]?.slices[0]?.mapping, {
    Created: { alias: { from: "id" }, label: { generate: [] }, size: { value: 2 } },
  })
  assert.throws(() => feedOf(modules()), { message: label })
  // Two fields that share a schema are told apart.
  const Id = z.string()
  const Pair = m.command({ a: Id, b: Id })
  const Paired = m.event({ a: Id, b: Id })
  const swapped = m
    .slice()
    .command({ Pair })
    .event({ Paired }, (c) => ({ a: c.Pair.b, b: c.Pair.a }))
  assert.deepEqual(swapped[META].events[0]?.mapping, {
    a: { from: "b", decl: Pair[META] },
    b: { from: "a", decl: Pair[META] },
  })
  DRAFTS.delete(swapped[META])
})

test("a column no event writes", () => {
  const f = fixture()
  const Table = m.view({ id: z.string(), name: z.string(), count: z.number() }).key("id")
  assert.throws(
    () => assembled({ ...f, Table }, [create(f), view({ ...f, Table })]),
    /Ch › Table: Table\.count has no value\. Add \.event\(\) with an event that carries count, or set it in a mapping\./,
  )
})

test("an event that carries none of the view's key columns", () => {
  const f = fixture()
  const Rename = m.command({ name: z.string() })
  const Renamed = m.event({ name: z.string() })
  const rename = m
    .slice()
    .command({ Rename })
    .event({ Renamed })
    .actor(f.User)
    .service(f.Svc)
    .test("A list is renamed", {
      when: Rename({ name: "Chores" }),
      then: Renamed({ name: "Chores" }),
    })
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, [create(f), rename, view(f, { Renamed })]),
    /Ch › Table: Renamed doesn't say which Table row it changes\. Give it id, or set it in its mapping\./,
  )
})

test("an event that carries only some of the view's key columns", () => {
  const f = fixture()
  const Table = m.view({ id: z.string(), owner: z.string(), name: z.string() }).key("id", "owner")
  const Create = m.command({ id: z.string(), owner: z.string(), name: z.string() })
  const Created = m.event({ id: z.string(), owner: z.string(), name: z.string() })
  const Renamed = m.event({ id: z.string(), name: z.string() })
  const row = { ...list, owner: "u-1" }
  const create = m
    .slice()
    .command({ Create })
    .event({ Created })
    .event({ Renamed })
    .actor(f.User)
    .service(f.Svc)
    .test("A list is created", { when: Create(row), then: Created(row) })
    .test("A list is renamed", { when: Create(row), then: Renamed(list) })
  const shown = m
    .slice()
    .view({ Table })
    .event({ Created })
    .event({ Renamed })
    .actor(f.User)
    .test("A list is a row", { given: [Created(row), Renamed(list)], then: Table(row) })
  const g = { ...f, Table, Create, Created, Renamed }
  assert.throws(
    () => assembled(g, [create, shown]),
    /Ch › Table: Renamed doesn't say which Table row it changes\. Give it owner, or set it in its mapping\./,
  )
})

test("an event nothing consumes", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [create(f)]),
    /Ch › Create: nothing uses Created yet\. Add \.automation\(\{ Created \}\), or \.event\(\{ Created \}\) to a state view, where something reacts to it\./,
  )
})

test("an event no slice emits", () => {
  const f = fixture()
  assert.throws(
    () => assembled(f, [view(f)]),
    /Ch › Table: nothing emits Created yet\. Add \.event\(\{ Created \}\) to the slice that causes it\./,
  )
})

test("an event no slice emits is one line, at the slices that react to it", () => {
  const f = fixture()
  const created = f.Created({ id: "1", name: "n" })
  const Process = m.command({ id: z.string(), name: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .automation({ Created: f.Created })
    .command({ Process })
    .event({ Processed })
    .test("one", { given: created, when: Process({ id: "1" }), then: Processed({ id: "1" }) })
    .test("two", { given: created, when: Process({ id: "1" }), then: Processed({ id: "1" }) })
  const Rename = m.command({ id: z.string() })
  const Renamed = m.event({ id: z.string() })
  const assumes = m
    .slice()
    .command({ Rename })
    .event({ Renamed })
    .actor(f.User)
    .test("renames", { given: created, when: Rename({ id: "1" }), then: Renamed({ id: "1" }) })
  const json = assembleModules(
    [
      {
        ...f,
        Process,
        Processed,
        Rename,
        Renamed,
        ...chapters({ Ch: [processor, view(f)], Other: [assumes] }),
        default: m.model("x"),
      },
    ],
    { partial: true },
  )
  assert.deepEqual(
    json.warnings?.filter((w) => w.message.includes("nothing emits Created")),
    [
      {
        message:
          "Ch › Processor, Ch › Table: nothing emits Created yet. Add .event({ Created }) to the slice that causes it.",
        element: "Created",
        slice: "Processor",
      },
    ],
  )
})

test("a view nothing reads", () => {
  const f = fixture()
  const unseen = m
    .slice()
    .view({ Table: f.Table })
    .event({ Created: f.Created })
    .test("A new list is a row", { given: f.Created(list), then: f.Table(list) })
  assert.throws(
    () => assembled(f, [create(f), unseen]),
    /Ch › Table: nothing reads Table yet\. Add \.actor\(\) for who sees it, or \.query\(\{ Table \}, …\) or \.automation\(\{ Table \}\) where it's needed\./,
  )
})

test("a view nothing projects", () => {
  const f = fixture()
  const created = f.Created({ id: "1", name: "n" })
  const slice = m
    .slice()
    .command({ Create: f.Create })
    .query({ Table: f.Table }, "id")
    .event({ Created: f.Created }, (c) => ({ name: c.Create.name }))
    .actor(f.User)
    .service(f.Svc)
    .test("t", {
      given: created,
      when: f.Create({ id: "1", name: "n" }),
      then: created,
    })
  assert.throws(
    () => assembled(f, [slice]),
    /Ch › Create: nothing fills Table yet\. Add a state view, m\.slice\(\)\.view\(\{ Table \}\)\.event\(\{ Event \}\)\./,
  )
})

// A call to a system we do not own: our command, then the system's event with what it sent back.
function call() {
  const f = fixture()
  const Remote = m.external()
  const Answered = m
    .event({ id: z.string(), name: z.string(), detail: z.string() })
    .external(Remote)
  const Ask = m.command({ id: z.string() })
  const ask = m.slice().command({ Ask }).event({ Answered }).actor(f.User).service(f.Svc)
  return { f, Remote, Answered, Ask, ask }
}

/** `call()` with a specification that shows its answer. */
function specifiedCall() {
  const { ask, ...rest } = call()
  const specified = ask.test("The remote system answers", {
    when: rest.Ask({ id: "list-1" }),
    then: rest.Answered({ ...list, detail: "Two aisles over" }),
  })
  return { ...rest, specified }
}

test("a call ends in the external event, whose fields come from outside", () => {
  const { f, Remote, Answered, Ask, specified } = specifiedCall()
  const keep = m
    .slice()
    .translation({ Answered })
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .test("The answer is kept", {
      given: Answered({ ...list, detail: "Two aisles over" }),
      when: f.Create(list),
      then: f.Created(list),
    })
  const json = assembled({ ...f, Remote, Answered, Ask }, [specified, keep, view(f)])
  const [asked] = json.chapters[0]?.slices ?? []
  assert.deepEqual(asked?.calls, [{ actor: "remote", event: "Answered(id, name, detail)" }])
  assert.equal(asked?.events, undefined)
})

test("an event of ours that maps a field the command shares from the outside event is drawn from that event", () => {
  const f = fixture()
  const Remote = m.external()
  const Answered = m.event({ id: z.string() }).external(Remote)
  const Kept = m.event({ id: z.string() })
  const ask = m
    .slice()
    .command({ Create: f.Create })
    .event({ Answered })
    .event({ Kept }, (c) => ({ id: c.Answered.id }))
  const exports = { ...f, Remote, Answered, Kept, ...chapters({ Ch: [ask] }) }
  const feed = feedOf([{ ...exports, default: m.model("x") }], { partial: true })
  const kept = feed.model.slices[0]?.events.find((e) => e.title === "Kept")
  assert.deepEqual(
    kept?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "Create"],
      ["INBOUND", "Answered"],
    ],
  )
})

test("the outside event a call gets back fills an event of ours after it, in the same slice", () => {
  const f = fixture()
  const Remote = m.external()
  const Answered = m.event({ id: z.string(), detail: z.string() }).external(Remote)
  const Ask = m.command({ id: z.string(), name: z.string() })
  const Kept = m.event({ id: z.string(), name: z.string(), detail: z.string(), said: z.string() })
  const ask = m
    .slice()
    .command({ Ask })
    .event({ Answered })
    .event({ Kept }, (c) => ({ id: c.Ask.id, said: c.Answered.detail }))
    .actor(f.User)
    .service(f.Svc)
    .test("The answer is kept", {
      when: Ask(list),
      then: [
        Answered({ ...list, detail: "Two aisles over" }),
        Kept({ ...list, detail: "Two aisles over", said: "Two aisles over" }),
      ],
    })
  const model = { ...f, Remote, Answered, Ask, Kept, ...chapters({ Ch: [ask] }) }
  const feed = feedOf([{ ...model, default: m.model("x") }], { partial: true })
  assert.deepEqual(
    feed.warnings?.filter((w) => w.slice === "Ask").map((w) => w.message),
    [
      "Ch › Ask: nothing uses Kept yet. Add .automation({ Kept }), or .event({ Kept }) to a state view, where something reacts to it.",
    ],
  )
  const kept = feed.model.slices[0]?.events.find((e) => e.title === "Kept")
  assert.deepEqual(
    kept?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "Ask"],
      ["INBOUND", "Answered"],
    ],
  )
  assert.equal(feed.model.slices[0]?.mappings?.Kept?.said, "detail")
  const out = layout(drawn(feed))
  const from = out.boxes.find((b) => b.name === "Answered")
  const to = out.boxes.find((b) => b.name === "Kept" && b.column === 0)
  assert.ok(from && to && out.edges.some((e) => e.from === from.id && e.to === to.id))
})

test("a view refuses an external event, which isn't stored", () => {
  const { f, Remote, Answered, Ask, specified } = specifiedCall()
  const projected = m
    .slice()
    .view({ Table: f.Table })
    .event({ Answered }, (c) => ({ id: c.Answered.id }))
    .actor(f.User)
    .test("The answer is a row", {
      given: Answered({ ...list, detail: "Two aisles over" }),
      then: f.Table(list),
    })
  const { User, Svc, Table } = f
  const modules = () => [
    {
      User,
      Svc,
      Table,
      Remote,
      Answered,
      Ask,
      ...chapters({ Ch: [specified, projected] }),
      default: m.model("x"),
    },
  ]
  const message =
    "Ch › Table: Table is built from Answered, which is Remote's and isn't stored. Translate it into an event of ours first, then project that."
  assert.deepEqual(
    feedOf(modules(), { partial: true }).warnings?.map((w) => w.message),
    [message],
  )
  assert.throws(() => feedOf(modules()), { message })
})

test("an external event we produce is published, and needs no translation", () => {
  const { f, Remote, Answered, Ask, specified } = specifiedCall()
  const json = assembleModules(
    [
      {
        Remote,
        Answered,
        Ask,
        User: f.User,
        Svc: f.Svc,
        ...chapters({ Ch: [specified] }),
        default: m.model("x"),
      },
    ],
    { partial: true },
  )
  assert.equal(json.warnings, undefined)
})

test("an external event only a given has is still left to translate", () => {
  const f = fixture()
  const Remote = m.external()
  const Answered = m.event({ id: z.string(), detail: z.string() }).external(Remote)
  const after = create(f).test("A list is created after an answer", {
    given: Answered({ id: "list-1", detail: "Two aisles over" }),
    when: f.Create(list),
    then: f.Created(list),
  })
  const json = assembleModules(
    [{ ...f, Remote, Answered, ...chapters({ Ch: [after, view(f)] }), default: m.model("x") }],
    { partial: true },
  )
  assert.deepEqual(json.warnings, [
    {
      message:
        "Ch › Create: nothing translates Answered yet. Add .translation({ Answered }) to make it an event of ours.",
      element: "Answered",
      slice: "Create",
    },
  ])
})

// A command's events are alternatives; a specification says when each happens.
function outcomes() {
  const f = fixture()
  const Refused = m.event({ id: z.string() })
  const slice = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .event({ Refused })
    .actor(f.User)
    .service(f.Svc)
  const created = slice.test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const shown = unspecifiedView(f, { Refused }).test("A refused list stays as it was", {
    given: [f.Created(list), Refused({ id: "list-1" })],
    then: f.Table(list),
  })
  const model = (create: Slice) => ({
    ...f,
    Refused,
    ...chapters({ Ch: [create, shown] }),
    default: m.model("x"),
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
  assembleModules([model(refused)])
})

test("an event a view handles that no specification's given has is left to do, and an error when strict", () => {
  const f = fixture()
  const model = () => ({
    ...f,
    ...chapters({ Ch: [create(f), unspecifiedView(f).test(...nothing)] }),
    default: m.model("x"),
  })
  const message =
    "Ch › Table: no specification shows Created yet. Add a .test whose given has Created(...)."
  const json = assembleModules([model()], { partial: true })
  assert.deepEqual(json.warnings, [{ message, element: "Created", slice: "Table" }])
  assert.throws(() => assembleModules([model()]), { message })
})

test("a view with no specification is left to do, and an error when strict", () => {
  const f = fixture()
  const model = () => ({
    ...f,
    ...chapters({ Ch: [create(f), unspecifiedView(f)] }),
    default: m.model("x"),
  })
  const message =
    "Ch › Table: no specification shows this view yet. Add a .test whose then has the Table rows it shows."
  const json = assembleModules([model()], { partial: true })
  assert.deepEqual(json.warnings, [{ message, element: "Table", slice: "Table" }])
  assert.throws(() => assembleModules([model()]), { message })
})

const hardware = { id: "list-2", name: "Hardware" }

/** What is left to do in a model whose view is `view`. */
const viewed = (f: Fixture, view: Slice) =>
  feedOf([{ ...f, ...chapters({ Ch: [create(f), view] }), default: m.model("x") }], {
    partial: true,
  }).warnings?.map((w) => w.message)

test("a view's specification shows the rows given builds that its query asks for", () => {
  const f = fixture()
  const byName = unspecifiedView(f)
    .request({ name: z.string() })
    .test("Only Groceries shows", {
      given: [f.Created(list), f.Created(hardware)],
      when: { name: "Groceries" },
      then: f.Table(list),
    })
  const feed = feedOf([{ ...f, ...chapters({ Ch: [create(f), byName] }), default: m.model("x") }])
  assert.deepEqual(feed.model.slices[1]?.specifications[0]?.when, [
    {
      id: "table:spec:0:when:0",
      title: "Get",
      type: "SPEC_COMMAND",
      examples: [{ name: "Groceries" }],
    },
  ])
  assert.equal(feed.warnings, undefined)
})

test("a view's row given does not build, or with another value, is named", () => {
  const f = fixture()
  const wrong = unspecifiedView(f).test("Groceries shows", {
    given: f.Created(list),
    then: [f.Table({ ...list, name: "Hardware" }), f.Table({ id: "list-9", name: "Nails" })],
  })
  assert.deepEqual(viewed(f, wrong), [
    'Ch › Table › "Groceries shows": then has name "Hardware", but Created in given has "Groceries".',
    'Ch › Table › "Groceries shows": then has Table {"id":"list-9"}, but given builds no such row.',
  ])
})

test("a row given does not build is an error when strict", () => {
  const f = fixture()
  // A field an example leaves out is not compared, so the second row is the one given builds.
  const missing = () =>
    unspecifiedView(f).test("A new list is a row", {
      given: f.Created(list),
      then: [f.Table({ ...list, id: "missing" }), f.Table({ id: "list-1" })],
    })
  const model = () => ({
    ...f,
    ...chapters({ Ch: [create(f), missing()] }),
    default: m.model("x"),
  })
  const message =
    'Ch › Table › "A new list is a row": then has Table {"id":"missing"}, but given builds no such row.'
  assert.deepEqual(
    feedOf([model()], { partial: true }).warnings?.map((w) => w.message),
    [message],
  )
  assert.throws(() => feedOf([model()]), { message })
})

test("a view's row its query excludes is named", () => {
  const f = fixture()
  const byName = unspecifiedView(f)
    .request({ name: z.string() })
    .test("Only Hardware shows", {
      given: [f.Created(list), f.Created(hardware)],
      when: { name: "Hardware" },
      then: [f.Table(hardware), f.Table({ id: "list-1" })],
    })
  assert.deepEqual(viewed(f, byName), [
    'Ch › Table › "Only Hardware shows": then has Table {"id":"list-1"}, but when excludes it. Remove it from then.',
  ])
})

test("a row given builds that then leaves out is named, unless the query excludes it", () => {
  const f = fixture()
  const search = unspecifiedView(f)
    .request({ text: z.string() })
    .test("A search finds Groceries", {
      given: [f.Created(list), f.Created(hardware)],
      when: { text: "Groc" },
      then: f.Table(list),
    })
  assert.deepEqual(viewed(f, search), [
    'Ch › Table › "A search finds Groceries": given builds Table {"id":"list-2"}, but then leaves it out and when does not exclude it. Add it to then.',
  ])
})

test("a specification's given may hold events its slice does not handle", () => {
  const f = fixture()
  const Refused = m.event({ id: z.string() })
  const create = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .event({ Refused })
    .actor(f.User)
    .service(f.Svc)
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
    .test("A second list with the same name is refused", {
      given: f.Created(list),
      when: f.Create(list),
      then: Refused({ id: "list-1" }),
    })
  const history = [f.Created(list), Refused({ id: "list-1" })]
  const shown = unspecifiedView(f).test("The list shows after a refusal", {
    given: history,
    then: f.Table(list),
  })
  assembled({ ...f, Refused }, [create, shown])
})

test("an external event a call ends in is an outcome", () => {
  const { f, Remote, Answered, Ask, ask } = call()
  const json = assembleModules(
    [
      {
        Remote,
        Answered,
        Ask,
        User: f.User,
        Svc: f.Svc,
        ...chapters({ Ch: [ask] }),
        default: m.model("x"),
      },
    ],
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
    .command({ Rename })
    .event({ Renamed })
    .actor(f.User)
    .service(f.Svc, "Create")
    .test("A list is renamed", { when: Rename(list), then: Renamed(list) })
  const slices = [create(f), rename, view(f, { Renamed })]
  assert.throws(
    () => assembled({ ...f, Rename, Renamed }, slices),
    /Ch › Rename: Svc\/Create is already used by Ch › Create\. Name this one/,
  )
  const partial = feedOf(
    [{ ...f, Rename, Renamed, ...chapters({ Ch: slices }), default: m.model("x") }],
    {
      partial: true,
    },
  )
  assert.equal(drawn(partial).chapters[0]?.slices.length, 3)
  assert.deepEqual(
    partial.warnings?.filter((w) => w.slice === "Rename").map((w) => w.message),
    [
      'Ch › Rename: Svc/Create is already used by Ch › Create. Name this one with .service(Service, "Name").',
    ],
  )
})

test("slices without a service claim no method", () => {
  const f = fixture()
  const again = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .actor(f.User)
    .test("A list is created again", { when: f.Create(list), then: f.Created(list) })
  const json = assembled(f, [create(f), again, view(f)])
  assert.equal(json.chapters[0]?.slices[1]?.ui, "Create")
})

test("an automation's command field its trigger does not carry", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .automation({ Created: f.Created })
    // @ts-expect-error the compiler refuses it too; assembly holds for a model run unchecked
    .command({ Process })
    .event({ Processed })
  assert.throws(
    () => assembled({ ...f, Process, Processed }, [create(f), processor]),
    /Ch › Processor: Process\.label has no value\. Add label to a step before \.command\(\) or set it in the mapping\./,
  )
})

/** The table a created list is a row of, and stays one once processed. */
const processedView = (f: Fixture, Processed: EventDecl<{ id: z.ZodString }>) =>
  unspecifiedView(f, { Processed }).test("A processed list stays as it was", {
    given: [f.Created(list), Processed({ id: "list-1" })],
    then: f.Table(list),
  })

test("an automation's trigger no specification's given has is left to do, and an error when strict; one a view starts has none", () => {
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const model = () => {
    const triggered = m
      .slice("Processor")
      .automation({ Created: f.Created })
      .command({ Process })
      .event({ Processed })
      .test("A list is processed", {
        when: Process({ id: "list-1" }),
        then: Processed({ id: "list-1" }),
      })
    const Ch = [create(f), triggered, processedView(f, Processed)]
    return { ...f, Process, Processed, ...chapters({ Ch }), default: m.model("x") }
  }
  const message =
    "Ch › Processor: no specification shows Created yet. Add a .test whose given has Created(...)."
  const json = assembleModules([model()], { partial: true })
  assert.deepEqual(json.warnings, [{ message, element: "Created", slice: "Processor" }])
  assert.throws(() => assembleModules([model()]), { message })
})

test("an automation's mapping fills its command from the trigger", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string(), label: z.string().optional() })
  const processor = m
    .slice("Processor")
    .automation({ Created: f.Created })
    .command({ Process }, (c) => ({ label: c.Created.name }))
    .event({ Processed })
    .test("A created list is processed", {
      given: f.Created(list),
      when: Process({ id: "list-1", label: "Groceries" }),
      then: Processed({ id: "list-1" }),
    })
  const json = assembled({ ...f, Process, Processed }, [
    create(f),
    processor,
    processedView(f, Processed),
  ])
  assert.deepEqual(json.chapters[0]?.slices[1]?.mapping, { Process: { label: { from: "name" } } })
})

test("a generated value in an automation's command is left to do, and an error when strict", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string(), label: z.string().optional() })
  const model = () => {
    const processor = m
      .slice("Processor")
      .automation({ Created: f.Created })
      .command({ Process }, () => ({ label: m.generate() }))
      .event({ Processed })
      .test("A created list is processed", {
        given: f.Created(list),
        when: Process({ id: "list-1", label: "x" }),
        then: Processed({ id: "list-1" }),
      })
    const Ch = [create(f), processor, processedView(f, Processed)]
    return { ...f, Process, Processed, ...chapters({ Ch }), default: m.model("x") }
  }
  const message =
    "Ch › Processor: Process.label is generated, but an automation's command is filled from what is before it. Add label to Created or a view it queries, or generate it in an event Process records."
  const json = assembleModules([model()], { partial: true })
  assert.deepEqual(json.warnings, [{ message, element: "Process", slice: "Processor" }])
  assert.throws(() => assembleModules([model()]), { message })
})

test("the first system actor declared runs what names none, and .actor() names another", () => {
  const f = fixture()
  const Syncer = m.actor({ icon: "system" })
  const Mailer = m.actor({ icon: "system" })
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const Mail = m.command({ id: z.string() })
  const Mailed = m.event({ id: z.string() })
  const Remote = m.external()
  const Answered = m.event({ id: z.string() }).external(Remote)
  const Ch = [
    create(f),
    m
      .slice("Processor")
      .automation({ Created: f.Created })
      .command({ Process })
      .event({ Processed }),
    m
      .slice("Notifier")
      .automation({ Created: f.Created })
      .command({ Mail })
      .event({ Mailed })
      .actor(Mailer),
    m
      .slice("Translator")
      .translation({ Answered })
      .command({ Mail })
      .event({ Mailed })
      .actor(Mailer),
    m.slice().view({ Table: f.Table }).event({ Created: f.Created }),
  ]
  const feed = feedOf(
    [
      {
        ...f,
        Syncer,
        Mailer,
        Process,
        Processed,
        Mail,
        Mailed,
        Remote,
        Answered,
        ...chapters({ Ch }),
        default: m.model("x"),
      },
    ],
    { partial: true },
  )
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
    ["User (Actor)", "Syncer (System)", "Mailer (System)", "Remote (System)"],
  )
  const gears = drawing.boxes.filter((b) => b.kind === "automation")
  assert.deepEqual(
    gears.map((b) => lanes.find((r) => b.y >= r.y && b.y < r.y + r.h)?.id),
    ["actor:syncer", "actor:mailer", "actor:mailer"],
  )
})

test("a state view without a service is named by its view and has a screen", () => {
  const f = fixture()
  const unserved = m
    .slice()
    .view({ Table: f.Table })
    .event({ Created: f.Created })
    .actor(f.User)
    .test("A new list is a row", { given: f.Created(list), then: f.Table(list) })
  const json = assembled(f, [create(f), unserved])
  const slice = json.chapters[0]?.slices[1]
  assert.deepEqual([slice?.name, slice?.ui], ["Table", "Table"])
})

test("a slice with no actor has no screen", () => {
  const f = fixture()
  const create = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const unseen = m
    .slice()
    .view({ Table: f.Table })
    .event({ Created: f.Created })
    .service(f.Svc, "Get")
    .test("A new list is a row", { given: f.Created(list), then: f.Table(list) })
  const Ch = [create, unseen]
  const json = assembled({ Create: f.Create, Created: f.Created, Table: f.Table, Svc: f.Svc }, Ch)
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => s.ui),
    [undefined, undefined],
  )
  assert.deepEqual(json.warnings, undefined)
})

test("a slice with several actors draws a screen in each one's lane", () => {
  const f = fixture()
  const Admin = m.actor({ icon: "admin" })
  const both = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .actor(f.User, Admin)
    .service(f.Svc)
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const json = assembled({ ...f, Admin }, [both, view(f)])
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
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .automation({ Table: f.Table })
    .command({ Process })
    .event({ Processed })
    .test("A listed row is processed", {
      given: f.Created(list),
      when: Process({ id: "list-1" }),
      then: Processed({ id: "list-1" }),
    })
  const json = assembled({ ...f, Process, Processed }, [
    create(f),
    processor,
    processedView(f, Processed),
  ])
  const slice = json.chapters[0]?.slices[1]
  assert.equal(slice?.automation, "Processor")
  assert.equal(slice?.trigger, undefined)
  assert.equal(slice?.polls, "Table")
})

test("a polled command's when matches the row given builds", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string() })
  const Processed = m.event({ id: z.string(), label: z.string().optional() })
  const processor = (label: string) =>
    m
      .slice("Processor")
      .automation({ Table: f.Table })
      .command({ Process }, (c) => ({ label: c.Table.name }))
      .event({ Processed })
      .test("A listed row is processed", {
        given: f.Created(list),
        when: Process({ id: "list-1", label }),
        then: Processed({ id: "list-1" }),
      })
  const model = (label: string) =>
    assembled({ ...f, Process, Processed }, [
      create(f),
      processor(label),
      processedView(f, Processed),
    ])
  model("Groceries")
  assert.throws(() => model("Milk"), {
    message: `Ch › Processor › "A listed row is processed": when has label "Milk", but the Table row given builds has name "Groceries".`,
  })
})

test("a polled command's when whose row given builds none of, or several of, is a to-do", () => {
  const f = fixture()
  const Table = m.view({ id: z.string(), owner: z.string(), name: z.string() }).key("id", "owner")
  const Created = m.event({ id: z.string(), owner: z.string(), name: z.string() })
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const mine = { ...list, owner: "u-1" }
  const theirs = { ...list, owner: "u-2" }
  const processor = m
    .slice("Processor")
    .automation({ Table })
    .command({ Process })
    .event({ Processed })
    .test("none", {
      given: Created(mine),
      when: Process({ id: "list-2" }),
      then: Processed({ id: "list-2" }),
    })
    .test("several", {
      given: [Created(mine), Created(theirs)],
      when: Process({ id: "list-1" }),
      then: Processed({ id: "list-1" }),
    })
  const projection = m.slice().view({ Table }).event({ Created })
  assert.deepEqual(
    disagreements({ ...f, Table, Created, Process, Processed }, [processor, projection]),
    [
      'Ch › Processor › "none": when is for the Table row {"id":"list-2"}, but given builds no such row. Add the event that does.',
      'Ch › Processor › "several": when is for the Table row {"id":"list-1"}, but given builds 2 such rows. Copy every key column into Process.',
    ],
  )
})

test("same-named streams from two modules are one lane", () => {
  const f = fixture()
  const [Inventory, Stock] = [m.stream(), m.stream()]
  f.Created.stream(Inventory)
  const Recounted = m.event({ id: z.string() }).stream(Stock)
  const Ch = [create(f), view(f)]
  const json = assembleModules(
    [
      { ...f, ...chapters({ Ch }), default: m.model("x") },
      { Inventory },
      { Inventory: Stock, Recounted },
    ],
    { partial: true },
  )
  assert.deepEqual(json.aggregates, [{ id: "inventory", name: "Inventory" }])
  assert.equal(json.chapters[0]?.slices[0]?.aggregate, "inventory")
  assert.equal(json.loose?.[0]?.aggregate, "inventory")
})

test("a stream no event joins is an empty lane, left to do", () => {
  const f = fixture()
  const Inventory = m.stream()
  f.Created.stream(Inventory)
  const story = chapters({ Ch: [create(f), view(f)] })
  const exports = { ...f, Inventory, Returns: m.stream(), ...story, default: m.model("x") }
  const json = assembleModules([exports], { partial: true })
  assert.deepEqual(json.warnings, [{ message: "Returns has no events yet.", element: "Returns" }])
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
  const f = fixture()
  const Lock = m.screen()
  const json = assembled({ ...f, Lock }, [create(f).screen(Lock), view(f).screen(Lock)])
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

test("a screen no one sees, and one no slice names, are left to do", () => {
  const f = fixture()
  const [Lock, Home] = [m.screen(), m.screen()]
  const unseen = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .screen(Lock)
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
  const json = assembleModules(
    [
      {
        ...f,
        Lock,
        Home,
        ...chapters({ Ch: [unseen, view(f)] }),
        default: m.model("x"),
      },
    ],
    { partial: true },
  )
  assert.deepEqual(json.warnings, [
    {
      message: "Ch › Create: no one sees Lock yet. Add .actor() for who does.",
      element: "Lock",
      slice: "Create",
    },
    { message: "Home isn't in a slice yet.", element: "Home" },
  ])
})

test("every m.slice().view() of a view is one slice: its events in, its screen out, drawn where the first is", () => {
  const f = fixture()
  const Table = m.view({ id: z.string(), name: z.string(), status: z.string() }).key("id")
  const Archive = m.command({ id: z.string() })
  const Archived = m.event({ id: z.string() })
  const archive = m
    .slice()
    .command({ Archive })
    .event({ Archived })
    .actor(f.User)
    .service(f.Svc)
    .test("A list is archived", {
      when: Archive({ id: "list-1" }),
      then: Archived({ id: "list-1" }),
    })
  const story = chapters({
    Capture: [
      create(f),
      m
        .slice()
        .view({ Table })
        .event({ Created: f.Created }, () => ({ status: z.literal("open") }))
        .actor(f.User)
        .service(f.Svc, "Get")
        .test("A new list is open", {
          given: f.Created(list),
          then: Table({ ...list, status: "open" }),
        }),
    ],
    Tidy: [archive],
  })
  m.slice()
    .view({ Table })
    .event({ Archived }, () => ({ status: z.literal("archived") }))
    .actor(f.User)
    .service(f.Svc, "Get")
    .test("An archived list is archived", {
      given: [f.Created(list), Archived({ id: "list-1" })],
      then: Table({ ...list, status: "archived" }),
    })
  const feed = feedOf([
    { ...f, Table, Archive, Archived },
    { ...story, default: m.model("x") },
  ])
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

test("a later .view() that says where or how to draw the slice is a to-do", () => {
  const f = fixture()
  const Admin = m.actor({ icon: "admin" })
  const Lock = m.screen()
  const story = chapters({ Capture: [create(f), view(f)], Tidy: [] })
  m.slice("Other")
    .view({ Table: f.Table })
    .event({ Created: f.Created })
    .chapter(story.Tidy as Chapter)
    .request({ name: z.string() })
    .actor(Admin)
    .screen(Lock)
    .service(f.Svc, "List")
    .note("Rebuilt nightly.")
  const exports = { ...f, Admin, Lock, ...story, default: m.model("x") }
  const drawnAs = (rest: string) =>
    `Table: this .view() ${rest}, where it is first written. Remove it, or move the first.`
  const expected = [
    drawnAs("names chapter Tidy, but Table is drawn in Capture"),
    drawnAs('names the slice "Other", but Table is drawn as "Table"'),
    drawnAs("names actor Admin, but Table is seen by User"),
    drawnAs("names screen Lock, but Table is shown on no screen"),
    drawnAs("names method Svc/List, but Table is served by Svc/Get"),
    drawnAs("asks with name, but Table is asked with nothing"),
    drawnAs('has the note "Rebuilt nightly.", but Table is drawn with no note'),
    "Tidy has no slices yet.",
    "Admin isn't in a slice yet.",
    "Lock isn't in a slice yet.",
  ]
  assert.deepEqual(
    feedOf([exports], { partial: true }).warnings?.map((w) => w.message),
    expected,
  )
})

test("a column no m.slice().view() of the view writes is reported once", () => {
  const f = fixture()
  const Table = m.view({ id: z.string(), name: z.string(), status: z.string() }).key("id")
  const Ch = [create(f), view({ ...f, Table }), view({ ...f, Table })]
  const json = assembleModules([{ ...f, Table, ...chapters({ Ch }), default: m.model("x") }], {
    partial: true,
  })
  assert.deepEqual(
    json.warnings?.map((w) => w.message),
    [
      "Ch › Table: Table.status has no value. Add .event() with an event that carries status, or set it in a mapping.",
    ],
  )
})

test("a single file written top to bottom extends an earlier view in a later chapter", async () => {
  const json = await assemble(here("./fixtures/top-to-bottom.ts"))
  assert.equal(json.warnings, undefined)
  assert.equal(json.loose, undefined)
  assert.deepEqual(
    json.aggregates.map((a) => a.id),
    ["notes"],
  )
})

test("a view in given is named as one", () => {
  const f = fixture()
  const row = f.Table({ id: "1", name: "n" })
  // @ts-expect-error a view is not an event, in given
  const slice = create(f).test("t", {
    given: row,
    when: f.Create({ id: "1", name: "n" }),
    then: f.Created({ id: "1", name: "n" }),
  })
  assert.throws(
    () => assembled(f, [slice, view(f)]),
    /Ch › Create: Table in given is a view\. given lists events that already happened\./,
  )
})

test("a declaration in no slice is an error", () => {
  const f = fixture()
  const Loose = m.event({ id: z.string() })
  assert.throws(
    () => assembled({ ...f, Loose }, [create(f), view(f)]),
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
    [{ ...f, Ended, Started, Games, ...chapters({ Ch }), default: m.model("x") }],
    { partial: true },
  )
  assert.deepEqual(json.warnings, [
    {
      message:
        "Ch › Create: nothing uses Created yet. Add .automation({ Created }), or .event({ Created }) to a state view, where something reacts to it.",
      element: "Created",
      slice: "Create",
    },
    { message: "Started isn't in a slice yet.", element: "Started" },
    { message: "Ended isn't in a slice yet.", element: "Ended" },
    { message: "Table isn't in a slice yet.", element: "Table" },
    {
      message:
        "Created isn't in a stream yet. Add .stream() where it's declared, with the stream it belongs to.",
      element: "Created",
    },
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
  const json = assembleModules([{ ...f, Bartender, ...chapters({ Ch }), default: m.model("x") }], {
    partial: true,
  })
  assert.deepEqual(
    json.actors.map((a) => a.id),
    ["user", "bartender"],
  )
})

test("an external event is drawn in its system's lane", () => {
  const Calendar = m.external()
  const Authenticated = m.event({ accountId: z.string() }).external(Calendar)
  const TaskMoved = m.event({ taskId: z.string() }).external(Calendar)
  const Connect = m.command({ accountId: z.string() })
  const Connected = m.event({ accountId: z.string() })
  const Ch = [m.slice().translation({ Authenticated }).command({ Connect }).event({ Connected })]
  const json = assembleModules(
    [
      {
        Calendar,
        Authenticated,
        TaskMoved,
        Connect,
        Connected,
        ...chapters({ Ch }),
        default: m.model("x"),
      },
    ],
    { partial: true },
  )
  assert.equal(json.chapters[0]?.slices[0]?.external_event, "Authenticated(accountId)")
  assert.deepEqual(json.loose, [
    { kind: "external", element: "TaskMoved(taskId)", aggregate: "events", actor: "calendar" },
  ])
})

// --- Chapters -----------------------------------------------------------------

test("chapters come in the order declared, each with its slices in the order written", () => {
  const f = fixture()
  const Second = m.chapter()
  const First = m.chapter().note("Where it starts.")
  // The same chapter, declared again in another module, is one chapter.
  const Again = m.chapter()
  view(f).chapter(Again)
  create(f).chapter(Second)
  m.slice("Recreate")
    .command({ Create: f.Create })
    .event({ Created: f.Created })
    .test("A list is created", { when: f.Create(list), then: f.Created(list) })
    .chapter(First)
  const json = assembleModules([{ ...f, Second, First, default: m.model("x") }, { Second: Again }])
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.map((s) => s.name)]),
    [
      ["Second", ["Table", "Create"]],
      ["First", ["Recreate"]],
    ],
  )
  assert.equal(json.notes.First, "Where it starts.")
  assert.equal(layout(json).chapters[1]?.note, "Where it starts.")
})

test("a second .note() adds to the first, on a slice and on a declaration", () => {
  const f = fixture()
  f.Created.note("Recorded once.").note("Never edited.")
  const noted = create(f).note("The first note.").note("The second note.")
  const feed = feedOf([{ ...f, ...chapters({ Ch: [noted, view(f)] }), default: m.model("x") }])
  assert.deepEqual(feed.model.slices[0]?.storylines, [
    { id: "create:note", title: "The first note.\nThe second note.", elements: [] },
  ])
  const json = drawn(feed)
  assert.equal(json.chapters[0]?.slices[0]?.note, "The first note.\nThe second note.")
  assert.equal(json.notes.Created, "Recorded once.\nNever edited.")
})

test("a chapter no slice joins is drawn empty, as a to-do", () => {
  const f = fixture()
  const story = chapters({ Ch: [create(f), view(f)] })
  const Later = m.chapter()
  const json = assembleModules([{ ...f, ...story, Later, default: m.model("x") }], {
    partial: true,
  })
  assert.deepEqual(json.chapters.at(-1), { name: "Later", slices: [] })
  assert.deepEqual(json.warnings, [{ message: "Later has no slices yet.", element: "" }])
  assert.equal(layout(json).chapters.at(-1)?.title, "Later")
})

test("a slice joins one chapter", () => {
  const f = fixture()
  const [A, B] = [m.chapter(), m.chapter()]
  view(f).chapter(A)
  create(f).chapter(A).chapter(B)
  assert.throws(
    () => assembleModules([{ ...f, A, B, default: m.model("x") }]),
    /^Error: Create: this slice joins A and B\. Keep one \.chapter\(\)\.$/,
  )
})

test("a partial assembly draws a slice in two chapters in the first, and lists it", () => {
  const f = fixture()
  const [A, B] = [m.chapter(), m.chapter()]
  for (const s of [create(f), view(f)]) s.chapter(A)
  m.slice().command({ Create: f.Create }).event({ Created: f.Created }).chapter(A).chapter(B)
  const json = assembleModules([{ ...f, A, B, default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.chapters.map((c) => [c.name, c.slices.length]),
    [
      ["A", 3],
      ["B", 0],
    ],
  )
  assert.ok(
    json.warnings?.some(
      (w) => w.message === "Create: this slice joins A and B. Keep one .chapter().",
    ),
  )
})

test("a chapter a slice joins that no module exports", () => {
  const f = fixture()
  create(f).chapter(m.chapter())
  assert.throws(
    () => assembleModules([{ ...f, default: m.model("x") }]),
    /^Error: Create: this slice joins a chapter that isn't exported\. Export it to give it a name\.$/,
  )
})

// --- Slices in no chapter -----------------------------------------------------

test("a slice in no chapter is drawn after the story", () => {
  const f = fixture()
  const base = m.slice().command({ Create: f.Create }).event({ Created: f.Created })
  base.actor(f.User)
  base.service(f.Svc)
  m.slice().view({ Table: f.Table }).event({ Created: f.Created })
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

test("a state view's request written as it once was, as a query, is drawn without it", () => {
  const f = fixture()
  const { Table, Created } = f
  // @ts-expect-error .request() declares the request
  const shown = m.slice().view({ Table }).event({ Created }).query({ id: z.string() })
  const feed = feedOf([{ ...f, ...chapters({ Ch: [shown] }), default: m.model("x") }], {
    partial: true,
  })
  assert.deepEqual(
    drawn(feed).chapters[0]?.slices.map((s) => s.name),
    ["Table"],
  )
})

test("a slice missing part of its core is drawn with the rest and says what it lacks; strict assembly refuses it", () => {
  const f = fixture()
  const slices = [
    create(f),
    m.slice().command({ Create: f.Create }).actor(f.User),
    m.slice().automation({ Created: f.Created }),
    view(f),
  ]
  const json = assembleModules([{ ...f, ...chapters({ Ch: slices }), default: m.model("x") }], {
    partial: true,
  })
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
    json.warnings?.filter((w) => / no (event|command) yet\./.test(w.message)),
    [
      {
        message: "Ch › Create: no event yet. Add .event() after .command({ Create }).",
        element: "",
        slice: "Create",
      },
      {
        message: "Ch › Created: no command yet. Add .command() after .automation({ Created }).",
        element: "",
        slice: "Created",
      },
    ],
  )
  assert.ok(layout(json).boxes.length > 0)
  assert.throws(
    () => assembled(f, slices),
    /Ch › Create: no event yet\. Add \.event\(\) after \.command\(\{ Create \}\)\./,
  )
})

test("a mapping that throws is left to do, naming its slice, which is drawn whole", () => {
  const f = fixture()
  const throws = m
    .slice()
    .command({ Create: f.Create })
    .event({ Created: f.Created }, () => ({ id: m.generate("id") }))
  const json = assembleModules(
    [{ ...f, ...chapters({ Ch: [throws, view(f)] }), default: m.model("x") }],
    { partial: true },
  )
  assert.deepEqual(
    json.chapters[0]?.slices.map((s) => [s.name, s.command, s.events]),
    [
      ["Create", "Create(id, name)", ["Created(id, name)"]],
      ["Table", undefined, undefined],
    ],
  )
  assert.deepEqual(
    json.warnings?.filter((w) => w.slice === "Create").map((w) => w.message),
    [
      "Ch › Create: Created's mapping threw: m.generate() takes fields of the mapping's argument, such as m.generate(c.AddNote.title), not id.",
      "Ch › Create: no specification shows Created yet. Add a .test whose then has Created(...).",
    ],
  )
})

test("a slice in no chapter is an error", () => {
  const f = fixture()
  view(f)
  assert.throws(() => assembled(f, [create(f)]), /Table isn't in a chapter yet\./)
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

test("a name declared twice", () => {
  const f = fixture()
  const Created = m.event({ id: z.string() })
  assert.throws(
    () => assembleModules([{ ...f, default: m.model("x") }, { Created }]),
    /Created is declared twice\. Keep one and use it in both places\./,
  )
  const json = assembleModules([{ ...f, default: m.model("x") }, { Created }], { partial: true })
  assert.ok(json.warnings?.some((w) => w.message.startsWith("Created is declared twice.")))
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
  const f = fixture()
  const json = assembled({ ...f, Mail: m.external() }, [create(f), view(f)])
  assert.deepEqual(json.actors.at(-1), { id: "mail", name: "Mail", type: "external" })
  assert.ok(layout(json).rows.some((r) => r.id === "actor:mail"))
})

test("an event in a stream and an external system", () => {
  const f = fixture()
  const [Lists, Mail] = [m.stream(), m.external()]
  f.Created.stream(Lists).external(Mail)
  assert.throws(
    () => assembled({ ...f, Lists, Mail }, [create(f), view(f)]),
    /^Error: Created is in the Lists stream and the Mail system\. Keep one: \.stream\(\) for ours, \.external\(\) for theirs\.$/,
  )
})

test("a trigger nothing emits yet is drawn on its own", () => {
  const f = fixture()
  const Process = m.command({ id: z.string() })
  const Processed = m.event({ id: z.string() })
  const Ch = [
    m
      .slice("Processor")
      .automation({ Created: f.Created })
      .command({ Process })
      .event({ Processed }),
  ]
  const json = assembleModules(
    [{ ...f, Process, Processed, ...chapters({ Ch }), default: m.model("x") }],
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
    .command({ Order })
    .event({ Ordered })
    .actor(f.User)
    .service(f.Svc)
    .test("t", {
      when: Order({ id: "1", items: [{ name: "a" }, { name: "b" }] }),
      then: Ordered({ id: "1", items: [{ name: "a" }] }),
    })
  const json = assembleModules(
    [{ Order, Ordered, ...f, ...chapters({ Ch: [slice] }), default: m.model("x") }],
    { partial: true },
  )
  const t = json.chapters[0]?.slices[0]?.tests[0]
  assert.deepEqual(
    [t?.when, t?.then],
    ["Order(id=1, items=[{name=a}, {name=b}])", ["Ordered(id=1, items=[{name=a}])"]],
  )
})

// --- A specification agrees with what flows into it. ---------------------------

/** What a partial assembly says about the specifications of `slices`. */
function disagreements(exports: Record<string, unknown>, slices: readonly Slice[]): string[] {
  const json = assembleModules(
    [{ ...exports, ...chapters({ Ch: slices }), default: m.model("x") }],
    {
      partial: true,
    },
  )
  return (json.warnings ?? []).map((w) => w.message).filter((w) => w.includes('› "'))
}

test("a state change's then has what its command sends and its mapping sets", () => {
  const f = fixture()
  const tags = z.array(z.object({ name: z.string() }))
  const Add = m.command({ id: z.string(), text: z.string(), tags })
  const Added = m.event({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    at: z.string(),
    tags,
  })
  const slice = m
    .slice()
    .command({ Add })
    .event({ Added }, (c) => ({ title: c.Add.text, status: z.literal("open"), at: m.generate() }))
    .test("agrees", {
      when: Add({ id: "a-1", text: "buy milk", tags: [{ name: "food" }] }),
      then: Added({
        id: "a-1",
        title: "buy milk",
        status: "open",
        at: "any",
        tags: [{ name: "food" }],
      }),
    })
  const exports = { ...f, Add, Added }
  assert.deepEqual(disagreements(exports, [slice]), [])
  const wrong = slice.test("disagrees", {
    when: Add({ id: "a-1", text: "buy milk", tags: [{ name: "food" }] }),
    then: Added({
      id: "a-2",
      title: "buy bread",
      status: "done",
      at: "any",
      tags: [{ name: "drink" }],
    }),
  })
  assert.deepEqual(disagreements(exports, [wrong]), [
    'Ch › Add › "disagrees": then has id "a-2", but when sends "a-1".',
    'Ch › Add › "disagrees": then has title "buy bread", but when sends text "buy milk".',
    `Ch › Add › "disagrees": then has status "done", but Added's mapping sets "open".`,
    'Ch › Add › "disagrees": then has tags [{"name":"drink"}], but when sends [{"name":"food"}].',
  ])
  const json = assembleModules(
    [{ ...exports, ...chapters({ Ch: [wrong] }), default: m.model("x") }],
    {
      partial: true,
    },
  )
  assert.ok(json.warnings?.some((w) => w.element === "Added" && w.slice === "Add"))
  assert.throws(
    () => assembleModules([{ ...exports, ...chapters({ Ch: [wrong] }), default: m.model("x") }]),
    // Every problem, not just the first.
    /^Error: Ch › Add › "disagrees": then has id "a-2", but when sends "a-1"\.\nCh › Add › "disagrees": then has title /,
  )
})

test("an external event's fields come from outside, so its then may have anything", () => {
  const f = fixture()
  const Remote = m.external()
  const Answered = m.event({ id: z.string(), name: z.string() }).external(Remote)
  const ask = m
    .slice()
    .command({ Create: f.Create })
    .event({ Answered })
    .test("answered", {
      when: f.Create(list),
      then: Answered({ id: "other", name: "other" }),
    })
  assert.deepEqual(disagreements({ ...f, Remote, Answered }, [ask]), [])
})

test("an automation's when has what its trigger in given carries and its mapping sets", () => {
  const f = fixture()
  const Process = m.command({ id: z.string(), label: z.string(), by: z.string() })
  const Processed = m.event({ id: z.string() })
  const processor = m
    .slice("Processor")
    .automation({ Created: f.Created })
    .command({ Process }, (c) => ({ label: c.Created.name, by: z.literal("processor") }))
    .event({ Processed })
    .test("agrees", {
      given: f.Created(list),
      when: Process({ id: "list-1", label: "Groceries", by: "processor" }),
      then: Processed({ id: "list-1" }),
    })
    .test("no trigger given", {
      when: Process({ id: "list-9", label: "Anything", by: "processor" }),
      then: Processed({ id: "list-9" }),
    })
  const exports = { ...f, Process, Processed }
  assert.deepEqual(disagreements(exports, [processor]), [])
  const wrong = processor.test("disagrees", {
    given: f.Created(list),
    when: Process({ id: "list-2", label: "Chores", by: "someone" }),
    then: Processed({ id: "list-3" }),
  })
  assert.deepEqual(disagreements(exports, [wrong]), [
    'Ch › Processor › "disagrees": when has id "list-2", but Created in given has "list-1".',
    'Ch › Processor › "disagrees": when has label "Chores", but Created in given has name "Groceries".',
    `Ch › Processor › "disagrees": when has by "someone", but Process's mapping sets "processor".`,
    'Ch › Processor › "disagrees": then has id "list-3", but when sends "list-2".',
  ])
})

test("a view's rows have what given builds, matched by key", () => {
  const Lists = m
    .view({
      userId: z.string(),
      listId: z.string(),
      name: z.string(),
      title: z.string(),
      items: z.number().int(),
      status: z.string(),
    })
    .key("userId", "listId")
  const ListCreated = m.event({ userId: z.string(), listId: z.string(), name: z.string() })
  const ItemAdded = m.event({ userId: z.string(), listId: z.string() })
  const ListClosed = m.event({ userId: z.string(), listId: z.string() })
  const groceries = { userId: "u-1", listId: "l-1" }
  const chores = { userId: "u-1", listId: "l-2" }
  const projection = m
    .slice()
    .view({ Lists })
    .event({ ListCreated }, (c) => ({
      title: c.ListCreated.name,
      items: z.literal(0),
      status: z.literal("open"),
    }))
    .event({ ItemAdded }, (c) => ({ items: m.generate(c.ItemAdded) }))
    .event({ ListClosed }, () => ({ status: z.literal("closed") }))
  const given = [
    ListCreated({ ...groceries, name: "Groceries" }),
    ListCreated({ ...chores, name: "Chores" }),
    ItemAdded(groceries),
    ItemAdded(groceries),
    ListClosed(chores),
  ]
  const exports = { Lists, ListCreated, ItemAdded, ListClosed }
  const agrees = projection.test("agrees", {
    given,
    then: [
      Lists({ ...groceries, name: "Groceries", title: "Groceries", items: 2, status: "open" }),
      Lists({ ...chores, name: "Chores", title: "Chores", items: 0, status: "closed" }),
    ],
  })
  assert.deepEqual(disagreements(exports, [agrees]), [])
  const wrong = projection.test("disagrees", {
    given,
    then: [
      Lists({ ...groceries, name: "Chores", title: "Chores", items: 1, status: "closed" }),
      Lists({ ...chores, status: "open" }),
    ],
  })
  assert.deepEqual(disagreements(exports, [wrong]), [
    'Ch › Lists › "disagrees": then has name "Chores", but ListCreated in given has "Groceries".',
    'Ch › Lists › "disagrees": then has title "Chores", but ListCreated in given has name "Groceries".',
    `Ch › Lists › "disagrees": then has status "closed", but ListCreated's mapping sets "open".`,
    `Ch › Lists › "disagrees": then has status "open", but ListClosed's mapping sets "closed".`,
  ])
})

// --- A query: the rows a filter picks from what given builds. -----------------

/** The eventsourcing book's cart: a price change archives the item in every cart that holds it. */
function cart() {
  const CreateCart = m.command({ aggregateId: z.uuid() })
  const CartCreated = m.event({ aggregateId: z.uuid() })
  const AddItem = m.command({
    aggregateId: z.uuid(),
    itemId: z.uuid(),
    productId: z.uuid(),
    price: z.number(),
  })
  const ItemAdded = m.event({
    aggregateId: z.uuid(),
    itemId: z.uuid(),
    productId: z.uuid(),
    price: z.number(),
  })
  const ChangePrice = m.command({ productId: z.uuid(), oldPrice: z.number(), newPrice: z.number() })
  const PriceChanged = m.event({ productId: z.uuid(), oldPrice: z.number(), newPrice: z.number() })
  const CartsWithProducts = m
    .view({ aggregateId: z.uuid(), productId: z.uuid(), itemId: z.uuid() })
    .key("aggregateId", "productId")
  const ArchiveItem = m.command({ aggregateId: z.uuid(), productId: z.uuid() })
  const ItemArchived = m.event({ aggregateId: z.uuid(), itemId: z.uuid() })
  const ArchivedItems = m.view({ aggregateId: z.uuid(), itemId: z.uuid() }).key("itemId")
  const User = m.actor()
  return {
    CreateCart,
    CartCreated,
    AddItem,
    ItemAdded,
    ChangePrice,
    PriceChanged,
    CartsWithProducts,
    ArchiveItem,
    ItemArchived,
    ArchivedItems,
    User,
  }
}

const cartId = "11111111-1111-4111-8111-111111111111"
const otherCart = "22222222-2222-4222-8222-222222222222"
const productId = "33333333-3333-4333-8333-333333333333"
const itemId = "44444444-4444-4444-8444-444444444444"

type Cart = ReturnType<typeof cart>

/**
 * The book's ArchiveItem slice: the processor finds the carts that hold the product, and the
 * handler reads the one row its command is for.
 */
const archiveItem = ({ PriceChanged, CartsWithProducts, ArchiveItem, ItemArchived }: Cart) =>
  m
    .slice("ArchiveItemScheduler")
    .automation({ PriceChanged })
    .query({ CartsWithProducts }, "productId")
    .command({ ArchiveItem })
    .query({ CartsWithProducts }, (c) => ({
      aggregateId: c.ArchiveItem.aggregateId,
      productId: c.ArchiveItem.productId,
    }))
    .event({ ItemArchived })

test("the book's ArchiveItem slice: a price change archives the item in the cart that holds it", () => {
  const c = cart()
  const added = c.ItemAdded({ aggregateId: cartId, itemId, productId, price: 10 })
  const story = [
    m
      .slice()
      .command({ CreateCart: c.CreateCart })
      .event({ CartCreated: c.CartCreated })
      .actor(c.User)
      .test("A cart is created", {
        when: c.CreateCart({ aggregateId: cartId }),
        then: c.CartCreated({ aggregateId: cartId }),
      }),
    m
      .slice()
      .command({ AddItem: c.AddItem })
      .event({ ItemAdded: c.ItemAdded })
      .actor(c.User)
      .test("An item is added", {
        when: c.AddItem({ aggregateId: cartId, itemId, productId, price: 10 }),
        then: added,
      }),
    m
      .slice()
      .command({ ChangePrice: c.ChangePrice })
      .event({ PriceChanged: c.PriceChanged })
      .actor(c.User)
      .test("A price changes", {
        when: c.ChangePrice({ productId, oldPrice: 10, newPrice: 12 }),
        then: c.PriceChanged({ productId, oldPrice: 10, newPrice: 12 }),
      }),
    m
      .slice()
      .view({ CartsWithProducts: c.CartsWithProducts })
      .event({ ItemAdded: c.ItemAdded })
      .test("An added item is in its cart", {
        given: added,
        then: c.CartsWithProducts({ aggregateId: cartId, productId, itemId }),
      }),
    archiveItem(c).test("A price change archives the item", {
      given: [
        c.CartCreated({ aggregateId: cartId }),
        added,
        c.PriceChanged({ productId, oldPrice: 10, newPrice: 12 }),
      ],
      when: c.ArchiveItem({ aggregateId: cartId, productId }),
      then: c.ItemArchived({ aggregateId: cartId, itemId }),
    }),
    m
      .slice()
      .view({ ArchivedItems: c.ArchivedItems })
      .event({ ItemArchived: c.ItemArchived })
      .actor(c.User)
      .test("An archived item is listed", {
        given: c.ItemArchived({ aggregateId: cartId, itemId }),
        then: c.ArchivedItems({ aggregateId: cartId, itemId }),
      }),
  ]
  const feed = feedOf([{ ...c, ...chapters({ Ch: story }), default: m.model("x") }])
  assert.equal(feed.warnings, undefined)
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
const cartsView = (c: Cart) =>
  m.slice().view({ CartsWithProducts: c.CartsWithProducts }).event({ ItemAdded: c.ItemAdded })

test("an automation's when is for one of the rows its query picks", () => {
  const c = cart()
  const inCart = (aggregateId: string) => c.ItemAdded({ aggregateId, itemId, productId, price: 10 })
  const given = [inCart(cartId), inCart(otherCart), c.PriceChanged({ productId, newPrice: 12 })]
  const slice = archiveItem(c)
    .test("agrees", {
      given,
      when: c.ArchiveItem({ aggregateId: otherCart, productId }),
      then: c.ItemArchived({ aggregateId: otherCart }),
    })
    .test("disagrees", {
      given,
      when: c.ArchiveItem({ aggregateId: "55555555-5555-4555-8555-555555555555", productId }),
      then: c.ItemArchived({ aggregateId: "55555555-5555-4555-8555-555555555555" }),
    })
  assert.deepEqual(disagreements(c, [slice, cartsView(c)]), [
    `Ch › ArchiveItemScheduler › "disagrees": when is for none of the 2 CartsWithProducts rows with {"productId":"${productId}"} that given builds.`,
  ])
})

test("a query that picks no row: an automation issues nothing, and a command is refused", () => {
  const c = cart()
  const issues = archiveItem(c).test("no cart holds the product", {
    given: c.PriceChanged({ productId, newPrice: 12 }),
    when: c.ArchiveItem({ aggregateId: cartId, productId }),
    then: c.ItemArchived({ aggregateId: cartId }),
  })
  assert.deepEqual(disagreements(c, [issues, cartsView(c)]), [
    `Ch › ArchiveItemScheduler › "no cart holds the product": given builds no CartsWithProducts row with {"productId":"${productId}"}, so the automation issues no ArchiveItem. Add the event that builds it.`,
  ])
  const archive = m
    .slice()
    .command({ ArchiveItem: c.ArchiveItem })
    .query({ CartsWithProducts: c.CartsWithProducts }, (x) => ({
      aggregateId: x.ArchiveItem.aggregateId,
      productId: x.ArchiveItem.productId,
    }))
    .event({ ItemArchived: c.ItemArchived }, (x) => ({
      itemId: m.generate(x.ArchiveItem.productId),
    }))
    .test("archived", {
      when: c.ArchiveItem({ aggregateId: cartId, productId }),
      then: c.ItemArchived({ aggregateId: cartId }),
    })
    .test("refused", {
      when: c.ArchiveItem({ aggregateId: cartId, productId }),
      reject: "the cart does not hold the product",
    })
  assert.deepEqual(disagreements(c, [archive, cartsView(c)]), [
    `Ch › ArchiveItem › "archived": given builds no CartsWithProducts row with {"aggregateId":"${cartId}","productId":"${productId}"}, so ArchiveItem is refused. Add the event that builds it, or reject.`,
  ])
})

test("a translation whose query picks no row is called a translation", () => {
  const Provider = m.external()
  const Authorized = m.event({ state: z.string() }).external(Provider)
  const Pending = m.view({ state: z.string() }).key("state")
  const Requested = m.event({ state: z.string() })
  const Complete = m.command({ state: z.string() })
  const Completed = m.event({ state: z.string() })
  const exports = { Provider, Authorized, Pending, Requested, Complete, Completed }
  const forged = m
    .slice()
    .translation({ Authorized })
    .query({ Pending }, "state")
    .command({ Complete })
    .event({ Completed })
    .test("forged", {
      given: Authorized({ state: "s-1" }),
      when: Complete({ state: "s-1" }),
      then: Completed({ state: "s-1" }),
    })
  assert.deepEqual(
    disagreements(exports, [forged, m.slice().view({ Pending }).event({ Requested })]),
    [
      `Ch › Complete › "forged": given builds no Pending row with {"state":"s-1"}, so the translation issues no Complete. Add the event that builds it.`,
    ],
  )
})

test("an event nothing uses is one line, naming every slice that records it", () => {
  const f = fixture()
  const Recreate = m.command({ id: z.string(), name: z.string() })
  const again = m.slice().command({ Recreate }).event({ Created: f.Created })
  const story = chapters({ Ch: [unspecified(f), again] })
  const json = feedOf([{ ...f, Recreate, ...story, default: m.model("x") }], { partial: true })
  assert.deepEqual(
    json.warnings?.flatMap((w) => (w.message.includes("nothing uses") ? [w.message] : [])),
    [
      "Ch › Create, Ch › Recreate: nothing uses Created yet. Add .automation({ Created }), or .event({ Created }) to a state view, where something reacts to it.",
    ],
  )
})

test("z.literal([]) sets the empty list, a constant", () => {
  const User = m.actor()
  const Plan = m.command({ weekOf: z.string() })
  const Planned = m.event({ weekOf: z.string() })
  const Groceries = m.view({ weekOf: z.string(), added: z.array(z.string()) }).key("weekOf")
  const week = { weekOf: "2026-11-23" }
  const story = chapters({
    Ch: [
      m
        .slice()
        .command({ Plan })
        .event({ Planned })
        .actor(User)
        .test("A week is planned", { when: Plan(week), then: Planned(week) }),
      m
        .slice()
        .view({ Groceries })
        .event({ Planned }, () => ({ added: z.literal([]) }))
        .actor(User)
        .test("A new week has nothing added", {
          given: Planned(week),
          then: Groceries({ ...week, added: [] }),
        }),
    ],
  })
  const feed = feedOf([{ User, Plan, Planned, Groceries, ...story, default: m.model("x") }])
  const groceries = feed.model.slices.find((s) => s.title === "Groceries")
  assert.deepEqual(groceries?.mappings, { Planned: { added: "= []" } })
})
