// The layout over the example model: every slice is a column, every card lands
// in its lane, nothing overlaps, and every edge joins two cards that exist.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import type { Message, Source } from "../src/types.ts"
import { words } from "../src/types.ts"
import type { Board } from "../viewer/src/board.ts"
import {
  actorOf,
  type Box,
  CARD_W,
  fitColumns,
  grouped,
  LANE_PAD,
  NOTE_GAP,
  NOTE_W,
  nextError,
  outside,
  parse,
  parseClause,
  path,
  polyline,
  STICKY_GAP,
  STICKY_HEAD_LINE,
  STICKY_LINES,
  served,
  source,
  stickies,
  TITLE_LINE,
  titled,
  valueLines,
  wording,
  wrap,
} from "../viewer/src/layout.ts"
import { read } from "../viewer/src/read.ts"
import { layout, measure } from "./measure.ts"

// A model read from its spec JSON alone, as a hand-written one is.
const model = read({
  name: "Todo List Application",
  model: JSON.parse(
    readFileSync(fileURLToPath(new URL("./todo-app.json", import.meta.url)), "utf8"),
  ),
})
const out = layout(model)
const byId = new Map(out.boxes.map((b) => [b.id, b]))
const rowOf = (b: { y: number; h: number }) =>
  out.rows.find((r) => b.y >= r.y && b.y + b.h <= r.y + r.h)

test("parse reads a name, its fields, and the key columns", () => {
  assert.deepEqual(parse("TodoList(*userId, *listId, name)"), {
    name: "TodoList",
    fields: ["userId", "listId", "name"],
    keys: ["userId", "listId"],
  })
  assert.deepEqual(parse("ListCompleter"), { name: "ListCompleter", fields: [], keys: [] })
})

test("parseClause gives one line per field, and a rejection its message", () => {
  assert.deepEqual(parseClause("ItemAdded(listId=list-1, tags=[a, b])"), {
    name: "ItemAdded",
    lines: ["listId = list-1", "tags = [a, b]"],
    error: false,
  })
  assert.deepEqual(parseClause("Ordered(items=[{name: a, qty: 2}], to={city: b, zip: c})").lines, [
    "items = [{name: a, qty: 2}]",
    "to = {city: b, zip: c}",
  ])
  assert.deepEqual(valueLines("[{name: a, qty: 2}, {name: b, qty: 1}]"), [
    "[{name: a, qty: 2},",
    " {name: b, qty: 1}]",
  ])
  assert.deepEqual(valueLines("[a, b]"), ["[a, b]"])
  assert.deepEqual(valueLines("{city: b, zip: c}"), ["{city: b, zip: c}"])
  assert.deepEqual(parseClause("Error: maximum 3 items per list"), {
    name: "Rejected",
    lines: ["maximum 3 items per list"],
    error: true,
  })
  assert.deepEqual(parseClause("Described: The list is gone"), {
    name: "Described",
    lines: ["The list is gone"],
    error: false,
    described: true,
  })
})

test("a mapped field shows where its value came from", () => {
  const sources: Source[] = [
    { from: "text" },
    { generate: [] },
    { generate: ["pageId", "Pages"] },
    { value: 0 },
  ]
  assert.deepEqual(sources.map(source), [
    "← text",
    "generated",
    "generated from pageId, Pages",
    "= 0",
  ])
})

test("one column per slice, in chapter order, inside its chapter", () => {
  const slices = model.chapters.flatMap((c) => c.slices)
  assert.equal(out.columns.length, slices.length)
  for (const col of out.columns) {
    const chapter = out.chapters[col.chapter]
    assert.ok(chapter && col.x >= chapter.x && col.x + col.w <= chapter.x + chapter.w)
  }
  const xs = out.columns.map((c) => c.x)
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b),
  )
  assert.deepEqual(out.columns.map((c) => c.label).slice(0, 6), [
    "CreateList",
    "AddItem",
    "CompleteItem",
    "DeleteItem",
    "DeleteList",
    "TodoList",
  ])
})

test("every card sits inside its column and inside one row", () => {
  for (const b of out.boxes) {
    const col = out.columns[b.column]
    assert.ok(col && b.x >= col.x && b.x + b.w <= col.x + col.w, `${b.name} is in its column`)
    assert.ok(rowOf(b), `${b.name} is inside a row`)
  }
})

test("no two cards overlap", () => {
  for (const a of out.boxes) {
    for (const b of out.boxes) {
      if (a === b) continue
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      assert.ok(apart, `${a.name} and ${b.name} overlap`)
    }
  }
})

test("cards land in the lanes the canvas gives them", () => {
  for (const b of out.boxes) {
    const row = rowOf(b)
    const slice = out.columns[b.column]?.slice
    assert.ok(row && slice)
    if (b.kind === "ui" || b.kind === "external") assert.equal(row.id, `actor:${slice.actor}`)
    if (b.kind === "automation")
      assert.equal(row.id, slice.external_event ? "actor:system" : `actor:${slice.actor}`)
    if (b.kind === "event") assert.equal(row.id, `stream:${slice.aggregate}`)
    if (b.kind === "command" || b.kind === "readModel") assert.equal(row.id, "middle")
  }
  const ids = out.rows.map((r) => r.id)
  assert.ok(
    ids.indexOf("actor:user") < ids.indexOf("actor:system") &&
      ids.indexOf("actor:system") < ids.indexOf("actor:calendar"),
    "actor lanes follow the model's actor order",
  )
})

test("every edge joins two cards, and a projection is fed by each of its events", () => {
  for (const e of out.edges) assert.ok(byId.has(e.from) && byId.has(e.to))
  const projection = out.columns.find((c) => Array.isArray(c.slice.trigger))
  assert.ok(projection)
  const target = out.boxes.find((b) => b.column === projection.index && b.kind === "readModel")
  assert.ok(target)
  const feeding = out.edges.filter((e) => e.to === target.id)
  const sources = feeding.map((e) => byId.get(e.from)).filter((b): b is Box => b !== undefined)
  assert.deepEqual(
    sources.map((b) => b.name).sort(),
    (projection.slice.trigger as string[]).map((t) => parse(t).name).sort(),
  )
  for (const s of sources) assert.equal(s.kind, "event")
  for (const e of feeding) {
    assert.ok(e.points && e.points.length >= 4, "a crossing edge is routed corner by corner")
    for (const [x, y] of e.points) assert.ok(x >= 0 && x <= out.width && y >= 0 && y <= out.height)
  }
})

test("an automation is in its actor's lane, and reads are drawn back from the view", () => {
  const column = out.columns.find((c) => c.slice.automation)
  assert.ok(column)
  const gear = out.boxes.find((b) => b.column === column.index && b.kind === "automation")
  const command = out.boxes.find((b) => b.column === column.index && b.kind === "command")
  assert.ok(gear && command)
  assert.equal(rowOf(gear)?.id, "actor:system")
  assert.equal(
    out.boxes.filter((b) => b.column === column.index && b.compact).length,
    0,
    "no reference card when the view is drawn in full",
  )
  const search = out.boxes.find(
    (b) => b.name === "TodoList" && b.kind === "readModel" && !b.compact,
  )
  assert.ok(search)
  const reads = out.edges.find((e) => e.from === search.id && e.to === gear.id)
  assert.ok(reads?.dashed && reads.points, "a dashed, routed edge from the view to the automation")
  const start = reads.points[0]
  assert.ok(start && start[0] > search.x + search.w / 2, "leaves the view right of centre")
  assert.equal(start?.[1], search.y + search.h)
  const end = reads.points.at(-1)
  assert.ok(end && end[0] === gear.x && end[1] > gear.y && end[1] < gear.y + gear.h)
  const trigger = out.edges.find((e) => e.to === gear.id && e.points)
  assert.ok(trigger?.points)
  const into = trigger.points.at(-1)
  assert.ok(into && into[0] === gear.x && into[1] > gear.y && into[1] < gear.y + gear.h)
})

test("a view nothing draws in full still gets a reference card", () => {
  const copy: Board = JSON.parse(JSON.stringify(model))
  for (const c of copy.chapters)
    c.slices = c.slices.filter((s) => !s.read_models?.some((r) => r.startsWith("TodoList")))
  const ref = layout(copy).boxes.find((b) => b.name === "TodoList")
  assert.ok(ref?.compact && ref.canonical === undefined)
})

test("lanes say what they are: the system lane is the automations, and an External System's is External", () => {
  const labels = out.rows.filter((r) => r.sub).map((r) => `${r.label} (${r.sub})`)
  assert.deepEqual(labels, [
    "User (Actor)",
    "Automations (System)",
    // From the JSON alone, lanes come in the order the slices first name them.
    "Lists (Stream)",
    "Items (Stream)",
    "Calendar (External)",
  ])
})

test("a screen is a wireframe of its command or its view", () => {
  const create = out.boxes.find((b) => b.kind === "ui" && b.name === "CreateList")
  assert.deepEqual(create?.form, ["userId", "listId", "name"])
  assert.equal(create?.button, "CreateList")
  assert.equal(create?.table, undefined)
  const list = out.boxes.find((b) => b.kind === "ui" && b.name === "ListTodoLists")
  assert.deepEqual(list?.form, ["userId"])
  assert.deepEqual(list?.table, ["userId", "listId", "name", "itemCount", "status"])
  assert.equal(list?.button, undefined)
  assert.ok(list?.tableColumns && list.tableColumns.length < 5 && list.tableMore)
})

test("a screen's table shows one row for a view with no key column, and two for any other", () => {
  const revenue = layout({
    ...model,
    chapters: [
      {
        name: "Sales",
        slices: [
          {
            name: "Revenue",
            actor: "user",
            aggregate: "lists",
            ui: "Revenue",
            read_models: ["Revenue(total)"],
            trigger: ["ItemAdded(listId)"],
            tests: [],
          },
        ],
      },
    ],
  })
  const ui = (board: ReturnType<typeof layout>, name: string) =>
    board.boxes.find((b) => b.kind === "ui" && b.name === name)
  assert.equal(ui(revenue, "Revenue")?.tableRows, 1)
  assert.equal(ui(out, "ListTodoLists")?.tableRows, undefined)
})

test("a table shows the columns that fit and counts the rest", () => {
  const { columns, more } = fitColumns(
    ["userId", "listId", "name", "itemCount", "status"],
    144,
    measure,
  )
  assert.ok(columns.length >= 2 && columns.length < 5)
  assert.equal(more, 5 - columns.length)
  const last = columns.at(-1)
  assert.ok(last && last.x + last.w <= 144 - 26, "room is left for the +n")
  assert.deepEqual(fitColumns(["a"], 144, measure), {
    columns: [{ name: "a", x: 0, w: 5.2 + 12 }],
    more: 0,
  })
})

test("an edge leaving an element sits right of centre, an edge entering sits left", () => {
  const created = out.boxes.find((b) => b.kind === "event" && b.name === "ListCreated")
  const target = out.boxes.find(
    (b) => b.kind === "readModel" && b.name === "TodoList" && !b.compact,
  )
  assert.ok(created && target)
  for (const e of out.edges.filter((e) => e.from === created.id && e.points)) {
    assert.ok((e.points?.[0]?.[0] ?? 0) > created.x + created.w / 2, "leaves right of centre")
  }
  const ends = out.edges
    .filter((e) => e.to === target.id && e.points)
    .map((e) => e.points?.at(-1)?.[0] ?? 0)
  for (const x of ends) assert.ok(x < target.x + target.w / 2, "enters left of centre")
  assert.equal(new Set(ends).size, ends.length, "each edge into TodoList has its own x")
})

test("a path starts at one box's edge and ends at the other's", () => {
  const a: Box = {
    id: "a",
    kind: "command",
    name: "",
    title: [""],
    fields: [],
    keys: [],
    column: 0,
    x: 0,
    y: 0,
    w: 100,
    h: 40,
  }
  const b: Box = { ...a, id: "b", y: 100 }
  assert.equal(path(a, b), "M50 40 L50 100")
  assert.match(path(b, { ...a, x: 300 }), /^M50 100 C.* 350 40$/)
  assert.equal(
    polyline([
      [0, 0],
      [0, 100],
      [50, 100],
    ]),
    "M0 0 L0 88 Q0 100 12 100 L50 100",
  )
})

test("a later appearance of an element is collapsed and points at the first", () => {
  const [full, ...later] = out.boxes.filter((b) => b.name === "ItemAdded" && b.kind === "event")
  assert.equal(later.length, 1)
  assert.ok(full && !full.compact && full.canonical === undefined)
  for (const b of later) {
    assert.ok(b.compact)
    assert.equal(b.canonical, full.id)
  }
})

test("an element's notes stand in a rail beside its slice, level with its first card, which keeps its height", () => {
  const copy: Board = JSON.parse(JSON.stringify(model))
  copy.notes.ItemAdded = [
    { text: "Titles are trimmed.", kind: "info" },
    {
      text: "What if two devices add the same item at once, both offline, and sync it later on?",
      kind: "question",
    },
  ]
  copy.notes.CreateList = [{ text: "Rate limited.", kind: "critical" }]
  const drawn = layout(copy)
  const [full, ...later] = drawn.boxes.filter((b) => b.name === "ItemAdded")
  const plain = out.boxes.find((b) => b.id === full?.id)
  assert.ok(full && plain)
  assert.equal(full.h, plain.h, "notes take width, not height")
  const col = drawn.columns[full.column]
  const [info, question] = col?.notes ?? []
  assert.ok(col && info && question)
  assert.deepEqual([info.kind, question.kind], ["info", "question"])
  assert.deepEqual(info.head, ["Item Added"])
  assert.equal(info.y, full.y)
  assert.equal(question.y, info.y + info.h + STICKY_GAP)
  assert.equal(col.railX, col.x + (out.columns[full.column]?.w ?? 0))
  assert.ok((col.railX ?? 0) >= full.x + full.w, "the rail is right of the card")
  assert.equal(col.w, (out.columns[full.column]?.w ?? 0) + NOTE_W + NOTE_GAP)
  assert.equal(question.lines.length, STICKY_LINES)
  assert.ok(question.lines.at(-1)?.endsWith("…"), "a long note is cut; the detail has it whole")
  for (const b of later) assert.equal(b.notes, undefined)
  const [ui, command] = drawn.boxes.filter((b) => b.name === "CreateList")
  assert.deepEqual([ui?.kind, ui?.notes], ["ui", undefined], "a screen named by its method")
  assert.equal(command?.notes?.[0]?.kind, "critical")
})

test("a long name wraps inside its card, which grows to hold it, and so does a note's header", () => {
  assert.deepEqual(titled({ name: "CompleteVendorConnection" }, CARD_W, false, measure), [
    "Complete Vendor",
    "Connection",
  ])
  const copy: Board = JSON.parse(JSON.stringify(model))
  const slice = copy.chapters[0]?.slices[0]
  assert.ok(slice?.command)
  slice.command = slice.command.replace("CreateList(", "CreateListFromEveryHousehold(")
  const long = layout(copy).boxes.find((b) => b.name === "CreateListFromEveryHousehold")
  const short = out.boxes.find((b) => b.name === "CreateList" && b.kind === "command")
  assert.ok(long && short)
  assert.deepEqual(long.title, ["Create List From", "Every Household"])
  for (const line of long.title) assert.ok(measure(line, "title") <= long.w - 24, line)
  assert.equal(long.h, short.h + TITLE_LINE)
  const note = { text: "Rate limited.", kind: "critical" } as const
  const [wide] = stickies([note], 0, "Complete Vendor Connection", measure)
  const [narrow] = stickies([note], 0, "Create List", measure)
  assert.deepEqual(wide?.head, ["Critical · Complete Vendor", "Connection"])
  assert.equal(wide?.h, (narrow?.h ?? 0) + STICKY_HEAD_LINE)
})

test("a slice's note lines up with its first card and names the slice; the lanes stay and later columns move right", () => {
  const copy: Board = JSON.parse(JSON.stringify(model))
  const slice = copy.chapters[0]?.slices[2]
  assert.ok(slice)
  slice.notes = [{ text: "Can a completed item be reopened?", kind: "question" }]
  const drawn = layout(copy)
  const [sticky] = drawn.columns[2]?.notes ?? []
  assert.ok(sticky)
  const top = Math.min(...drawn.boxes.filter((b) => b.column === 2).map((b) => b.y))
  assert.equal(sticky.y, top)
  assert.deepEqual(sticky.head, [`Question · ${drawn.columns[2]?.title}`])
  assert.equal(drawn.rows[0]?.y, out.rows[0]?.y)
  assert.equal(drawn.columns[3]?.x, (out.columns[3]?.x ?? 0) + NOTE_W + NOTE_GAP)
  assert.equal(drawn.width, out.width + NOTE_W + NOTE_GAP)
})

test("specifications are off the canvas, which ends at its last lane; each is its slice's, a card per clause with a line per field", () => {
  const lanes = out.boxes.map((b) => rowOf(b) ?? { y: 0, h: 0 })
  assert.equal(out.height, Math.max(...lanes.map((r) => r.y + r.h)) + LANE_PAD)
  const column = out.columns.find((c) => c.label === "AddItem")
  assert.ok(column)
  const specs = out.specs.filter((s) => s.column === column.index)
  assert.deepEqual(
    specs.map((s) => s.title),
    column.slice.tests.map((t) => t.name),
  )
  const rejected = specs[1]
  assert.ok(rejected)
  const then = rejected.steps.find((st) => st.word === "then")
  assert.equal(then?.cards[0]?.kind, "error")
  const given = rejected.steps.find((st) => st.word === "given")
  assert.equal(given?.cards.length, 3)
  assert.equal(given?.cards[0]?.kind, "event")
  assert.equal(given?.cards[0]?.lines.length, 4)
})

test("a view's specification asks its screen in when, and shows rows in then", () => {
  const column = out.columns.find((c) => c.label === "TodoList")
  const spec = out.specs.filter((s) => s.column === column?.index).at(-1)
  const kinds = spec?.steps.map((st) => [st.word, st.cards.map((c) => c.kind)])
  assert.deepEqual(kinds, [
    ["given", ["event", "event"]],
    ["when", ["ui"]],
    ["then", ["readModel"]],
  ])
  assert.deepEqual(spec?.steps[1]?.cards[0]?.lines, ["userId = u-1"])
})

test("a view's specification whose then is empty shows no rows", () => {
  const copy: Board = JSON.parse(JSON.stringify(model))
  const slice = copy.chapters.flatMap((c) => c.slices).find((s) => s.name === "TodoList")
  const test = slice?.tests.at(-1)
  assert.ok(test)
  test.then = []
  const drawn = layout(copy)
  const column = drawn.columns.find((c) => c.label === "TodoList")
  const spec = drawn.specs.filter((s) => s.column === column?.index).at(-1)
  assert.deepEqual(spec?.steps.at(-1), {
    word: "then",
    cards: [{ kind: "description", name: "TodoList", lines: ["no rows"] }],
  })
})

test("an automation's specification with no when and an empty then shows that nothing happens", () => {
  const copy: Board = JSON.parse(JSON.stringify(model))
  const test = copy.chapters.flatMap((c) => c.slices).find((s) => s.name === "ListCompleter")
    ?.tests[0]
  assert.ok(test)
  const then = () => {
    const drawn = layout(copy)
    const column = drawn.columns.find((c) => c.label === "ListCompleter")
    const spec = drawn.specs.find((s) => s.column === column?.index)
    return spec?.steps.find((st) => st.word === "then")
  }
  test.then = []
  assert.equal(then(), undefined, "with a when, the command is issued and records nothing")
  test.when = ""
  assert.deepEqual(then(), {
    word: "then",
    cards: [{ kind: "description", name: "ListCompleter", lines: ["nothing happens"] }],
  })
})

test("focusing a chapter dims the edges that come from or go to another chapter, and only those", () => {
  const chapterOf = (id: string) => out.columns[byId.get(id)?.column ?? -1]?.chapter
  const views = out.chapters.findIndex((c) => c.name === "Views")
  const dimmed = outside(out, views)
  const crossing = out.edges.filter((e) => chapterOf(e.from) !== chapterOf(e.to))
  assert.ok(crossing.length > 0 && dimmed.size < out.edges.length)
  out.edges.forEach((e, i) => {
    const within = chapterOf(e.from) === views && chapterOf(e.to) === views
    assert.equal(dimmed.has(i), !within, `${byId.get(e.from)?.name} → ${byId.get(e.to)?.name}`)
  })
})

test("the picture shows names as words", () => {
  assert.equal(words("DrawsAndResignation"), "Draws and Resignation")
  assert.equal(words("ItemAdded"), "Item Added")
  assert.equal(words("FIDEGame"), "FIDE Game")
  assert.equal(words("ConnectOAuthCallback"), "Connect OAuth Callback")
  assert.equal(words("TodoService"), "Todo Service")
  assert.equal(out.chapters[0]?.title, "List Management")
  assert.equal(out.columns.find((c) => c.label === "ListItems")?.title, "List Items")
})

test("a translation gets an automation of ours between the external event and the command", () => {
  const column = out.columns.find((c) => c.slice.external_event)
  assert.ok(column)
  const external = out.boxes.find((b) => b.column === column.index && b.kind === "external")
  const gear = out.boxes.find((b) => b.column === column.index && b.kind === "automation")
  const command = out.boxes.find((b) => b.column === column.index && b.kind === "command")
  assert.ok(external && gear && command)
  assert.equal(rowOf(gear)?.id, "actor:system")
  assert.ok(out.edges.some((e) => e.from === external.id && e.to === gear.id))
  assert.ok(out.edges.some((e) => e.from === gear.id && e.to === command.id))
  assert.ok(!out.edges.some((e) => e.from === external.id && e.to === command.id))
})

test("a translation is run by a machine of ours, from its External System; a slice names a service only once it has one", () => {
  const column = out.columns.find((c) => c.slice.external_event)
  assert.ok(column)
  assert.deepEqual(actorOf(model, column.slice), { actor: "System", from: "Calendar" })
  const worker = { id: "list-worker", name: "ListWorker", type: "system" as const }
  const run = { ...column.slice, runner: worker.id }
  assert.deepEqual(actorOf({ ...model, actors: [...model.actors, worker] }, run), {
    actor: "List Worker",
    from: "Calendar",
  })
  const create = out.columns.find((c) => c.label === "CreateList")?.slice
  assert.ok(create)
  assert.deepEqual(actorOf(model, create), { actor: "User" })
  assert.equal(served(create), "TodoService/CreateList")
  assert.equal(served({ ...create, ui: "CreateList" }), undefined)
})

test("a call's external event is drawn in the system's lane, and a later trigger links to it", () => {
  const called = layout({
    name: "x",
    description: "",
    actors: [
      { id: "user", name: "User", type: "user" },
      { id: "remote", name: "Remote", type: "external" },
    ],
    aggregates: [{ id: "events", name: "Events" }],
    chapters: [
      {
        name: "Ch",
        slices: [
          {
            name: "Ask",
            actor: "user",
            aggregate: "events",
            ui: "Ask",
            command: "Ask(id)",
            calls: [{ actor: "remote", event: "Answered(id, detail)" }],
            tests: [],
          },
          {
            name: "Keep",
            actor: "remote",
            aggregate: "events",
            external_event: "Answered(id, detail)",
            command: "Keep(id, detail)",
            events: ["Kept(id, detail)"],
            tests: [],
          },
        ],
      },
    ],
    notes: {},
  })
  const [first, ...later] = called.boxes.filter((b) => b.name === "Answered")
  const command = called.boxes.find((b) => b.name === "Ask" && b.kind === "command")
  const gear = called.boxes.find((b) => b.name === "Keep" && b.kind === "automation")
  assert.ok(first && command && gear)
  assert.equal(first.kind, "external")
  assert.equal(first.column, 0)
  assert.ok(!first.compact)
  const lane = called.rows.find((r) => first.y >= r.y && first.y + first.h <= r.y + r.h)
  assert.equal(lane?.id, "actor:remote")
  assert.deepEqual(
    called.rows.map((r) => r.id),
    ["actor:user", "actor:system", "middle", "stream:events", "actor:remote"],
    "an outside system's lane is beneath our streams",
  )
  assert.ok(called.edges.some((e) => e.from === command.id && e.to === first.id))
  assert.deepEqual(later, [])
  assert.ok(called.edges.some((e) => e.from === first.id && e.to === gear.id))
})

test("a call's arrow goes around the event of ours that keeps what it got back, so each arrow shows", () => {
  const out = layout({
    name: "x",
    description: "",
    actors: [
      { id: "user", name: "User", type: "user" },
      { id: "remote", name: "Remote", type: "external" },
    ],
    aggregates: [{ id: "events", name: "Events" }],
    chapters: [
      {
        name: "Ch",
        slices: [
          {
            name: "Ask",
            actor: "user",
            aggregate: "events",
            ui: "Ask",
            command: "Ask(id)",
            events: ["Kept(id, detail)"],
            calls: [{ actor: "remote", event: "Answered(id, detail)", kept: ["Kept"] }],
            tests: [],
          },
        ],
      },
    ],
    notes: {},
  })
  const box = (name: string) => out.boxes.find((b) => b.name === name && b.kind !== "ui")
  const [command, kept, answered] = [box("Ask"), box("Kept"), box("Answered")]
  assert.ok(command && kept && answered)
  const edge = (from: string, to: string) => out.edges.find((e) => e.from === from && e.to === to)
  assert.ok(edge(command.id, kept.id))
  assert.ok(edge(answered.id, kept.id))
  const call = edge(command.id, answered.id)
  assert.ok(call?.points?.every(([x]) => x >= kept.x + kept.w))
})

test("a command's outcomes stand side by side in their lane, each joined to the command", () => {
  const both = layout({
    name: "x",
    description: "",
    actors: [{ id: "user", name: "User", type: "user" }],
    aggregates: [{ id: "notes", name: "Notes" }],
    chapters: [
      {
        name: "Ch",
        slices: [
          {
            name: "SyncNote",
            actor: "user",
            aggregate: "notes",
            command: "SyncNote(noteId)",
            events: ["NoteSynced(noteId)", "SyncFailed(noteId, reason)"],
            tests: [],
          },
        ],
      },
    ],
    notes: {},
  })
  const [synced, failed] = both.boxes.filter((b) => b.kind === "event")
  const command = both.boxes.find((b) => b.kind === "command")
  const column = both.columns[0]
  assert.ok(synced && failed && command && column)
  assert.equal(synced.y, failed.y)
  assert.ok(synced.x + synced.w < failed.x, "apart, left to right")
  assert.ok(synced.x >= column.x && failed.x + failed.w <= column.x + column.w)
  assert.equal(command.x + command.w / 2, column.x + column.w / 2, "the command is centred above")
  for (const outcome of [synced, failed])
    assert.ok(both.edges.some((e) => e.from === command.id && e.to === outcome.id))
})

test("wrap breaks at words, and splits only a word wider than a line", () => {
  const chars = (s: string) => s.length
  assert.deepEqual(wrap("Adding a fourth item is rejected", 20, chars), [
    "Adding a fourth item",
    "is rejected",
  ])
  assert.equal(
    wrap("abcdefghijklmnopqrstuvwxyz", 10, chars).join("|"),
    "abcdefghij|klmnopqrst|uvwxyz",
  )
  assert.deepEqual(wrap("Duplicate list name rejected", 26, chars), [
    "Duplicate list name",
    "rejected",
  ])
})

test("a title wraps by the width its font draws it, and a table header is cut to fit", () => {
  // Wider than a guess of 6.6px a character: the browser draws "Move Member Workspace" 157.5px wide.
  const wide = (text: string) => text.length * 7.5
  for (const name of [
    "LockScreenNotification",
    "MoveMemberWorkspace",
    "Supercalifragilisticexpialidocious",
  ]) {
    const title = titled({ name }, CARD_W, false, wide)
    for (const line of title) assert.ok(wide(line) <= CARD_W - 24, line)
    assert.equal(title.join("").replaceAll(" ", ""), name)
  }
  const [only] = fitColumns(["aVeryLongColumnNameThatCannotFit"], 60, measure).columns
  assert.ok(only && only.w <= 60 && only.name.endsWith("…"))
})

test("a loose declaration is a column after the story, with no heading, its card in its lane", () => {
  const storm = layout({
    ...model,
    loose: [
      { kind: "event", element: "Started(id)", aggregate: "lists" },
      { kind: "command", element: "Start(id)", aggregate: "lists" },
    ],
    messages: [
      { kind: "warning", message: "Started: nothing records it.", element: "Started" },
      {
        kind: "warning",
        message: "ListCreated (CreateList): unused.",
        element: "ListCreated",
        slice: "create-list",
      },
    ],
  })
  const last = storm.chapters.length - 1
  assert.equal(storm.chapters[last]?.title, "")
  const cols = storm.columns.filter((c) => c.chapter === last)
  assert.deepEqual(
    cols.map((c) => c.title),
    ["Started", "Start"],
  )
  assert.ok(cols.every((c) => c.x >= (storm.chapters[last - 1]?.x ?? 0)))
  const rows = new Map(storm.rows.map((r) => [r.id, r]))
  const inRow = (b: Box, id: string) => {
    const r = rows.get(id)
    return r !== undefined && b.y >= r.y && b.y + b.h <= r.y + r.h
  }
  const started = storm.boxes.find((b) => b.name === "Started")
  const start = storm.boxes.find((b) => b.name === "Start")
  assert.ok(started && start)
  assert.ok(inRow(started, "stream:lists"))
  assert.ok(inRow(start, "middle"))
  // A warning marks its element's card and its slice's column; a loose one's is its own column.
  assert.equal(started.mark, "warning")
  assert.equal(start.mark, undefined)
  assert.equal(cols[0]?.mark, "warning")
  assert.equal(cols[1]?.mark, undefined)
  assert.equal(storm.columns[0]?.mark, "warning")
  assert.equal(storm.boxes.find((b) => b.name === "ListCreated")?.mark, "warning")
  assert.equal(storm.model.mark, undefined)
})

// A message as the feed carries it, about an element in a slice.
const said = (kind: Message["kind"], element: string, slice?: string, ui?: string): Message => ({
  kind,
  message: `${element}: ${kind}`,
  element,
  ...(slice !== undefined && { slice }),
  ...(ui !== undefined && { ui }),
})

test("the strongest message marks its slice, and its card in that slice only; one in no slice is the model's", () => {
  const marked = layout({
    ...model,
    messages: [
      said("error", "ItemCompleted", "complete-item"),
      said("warning", "ListScreen", "complete-item"),
      said("warning", "ListDeleted", "delete-list"),
      said("warning", "Lists"),
    ],
  })
  const column = (name: string) => marked.columns.find((c) => c.slice.name === name)
  assert.equal(column("CompleteItem")?.mark, "error", "an error over a warning")
  assert.equal(column("DeleteList")?.mark, "warning")
  assert.equal(column("CreateList")?.mark, undefined)
  const screens = marked.boxes.filter((b) => b.name === "ListScreen")
  assert.ok(screens.length > 1)
  assert.deepEqual(
    screens.map((b) => b.mark),
    screens.map((b) => (b.column === column("CompleteItem")?.index ? "warning" : undefined)),
  )
  assert.deepEqual(
    marked.model.messages.map((m) => m.element),
    ["Lists"],
  )
  assert.equal(marked.model.mark, "warning")
})

test("a slice's messages group under their element with its kind, errors first", () => {
  const screen = said("warning", "ListScreen", "complete-item")
  const unsourced = said("error", "ItemCompleted", "complete-item")
  const unspecified = said("warning", "ItemCompleted", "complete-item")
  assert.deepEqual(grouped([screen, unspecified, unsourced], out.boxes), [
    { element: "ItemCompleted", kind: "event", messages: [unsourced, unspecified] },
    { element: "ListScreen", kind: "ui", messages: [screen] },
  ])
  // An automation is named after its slice; a command of that name is what is meant.
  assert.equal(grouped([said("error", "AddItem", "add-item")], out.boxes)[0]?.kind, "command")
  assert.deepEqual(grouped([said("warning", "Lists"), said("error", "")], out.boxes), [
    { element: "", messages: [said("error", "")] },
    { element: "Lists", messages: [said("warning", "Lists")] },
  ])
})

test("a message reads without the name its group shows, its fields cut out", () => {
  const unsourced = {
    ...said("error", "ItemCompleted", "complete-item", "Item Completed: userId has no source"),
    fields: ["userId"],
  }
  assert.deepEqual(wording(unsourced), [
    { text: "userId", field: true },
    { text: " has no source" },
  ])
  assert.deepEqual(
    wording(said("warning", "ListDeleted", "delete-list", "List Deleted: missing specification")),
    [{ text: "missing specification" }],
  )
  assert.deepEqual(wording(said("error", "", undefined, "A slice is empty")), [
    { text: "A slice is empty" },
  ])
  // A feed from before the viewer's wording has only the terminal's.
  const old = {
    message: "Started: nothing records it.",
    element: "Started",
    kind: "warning" as const,
  }
  assert.deepEqual(wording(old), [{ text: "nothing records it." }])
})

test("E visits the model's errors, then each slice with an error in order, and wraps; Shift-E goes back", () => {
  const errors = layout({
    ...model,
    messages: [
      said("error", "TodoList", "todo-list"),
      said("error", "ItemCompleted", "complete-item"),
      said("error", "ItemCompleted", "complete-item"),
      said("warning", "ListDeleted", "delete-list"),
      said("error", ""),
    ],
  })
  const walk = (delta: 1 | -1) => {
    const seen: (number | "model" | undefined)[] = []
    let at: number | "model" | null = null
    for (let i = 0; i < 4; i++) {
      const next = nextError(errors, at, delta)
      seen.push(next)
      at = next ?? null
    }
    return seen
  }
  assert.deepEqual(walk(1), ["model", 2, 5, "model"])
  assert.deepEqual(walk(-1), [5, 2, "model", 5])
  assert.equal(nextError(errors, 3, 1), 5, "from a slice with none, the next one with one")
  assert.equal(nextError(out, null, 1), undefined, "nowhere to go")
})

test("a feed with only a warnings list, from before errors were split out, marks them as warnings", () => {
  const old = read({
    name: "x",
    model: { slices: [] },
    warnings: [{ message: "Started: nothing records it.", element: "Started" } as Message],
  })
  assert.deepEqual(
    old.messages?.map((m) => m.kind),
    ["warning"],
  )
  assert.equal(layout(old).model.mark, "warning")
})

test("the slices in no chapter are the nameless chapter, with no heading", () => {
  const slice = model.chapters[0]?.slices[0]
  assert.ok(slice)
  const storm = layout({ ...model, chapters: [...model.chapters, { name: "", slices: [slice] }] })
  assert.equal(storm.chapters.at(-1)?.title, "")
  assert.equal(storm.columns.at(-1)?.chapter, storm.chapters.length - 1)
})

test("every actor gets a lane, and cards in one lane share a top edge", () => {
  const withIdle = layout({
    ...model,
    actors: [...model.actors, { id: "bartender", name: "Bartender", type: "user" }],
  })
  assert.ok(withIdle.rows.some((r) => r.id === "actor:bartender" && r.label === "Bartender"))
  for (const row of out.rows) {
    const tops = new Set(out.boxes.filter((b) => rowOf(b)?.id === row.id).map((b) => b.y))
    assert.ok(tops.size <= (row.kind === "middle" ? 2 : 1), `${row.id} has ${tops.size} top edges`)
  }
})
