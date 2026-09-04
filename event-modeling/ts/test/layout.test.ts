// The layout over the example model: every slice is a column, every card lands
// in its lane, nothing overlaps, and every edge joins two cards that exist.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import type { ModelJson } from "../src/json.ts"
import {
  type Box,
  fitColumns,
  layout,
  parse,
  parseClause,
  path,
  polyline,
  words,
  wrap,
} from "../viewer/src/layout.ts"

const model: ModelJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("./todo-app.json", import.meta.url)), "utf8"),
)
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
  assert.deepEqual(parseClause("Error: maximum 3 items per list"), {
    name: "Rejected",
    lines: ["maximum 3 items per list"],
    error: true,
  })
  assert.deepEqual(wrap("Adding a fourth item is rejected", 20), [
    "Adding a fourth item",
    "is rejected",
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

test("no two cards overlap, specifications included", () => {
  const all = [...out.boxes, ...out.specs]
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      assert.ok(
        apart,
        `${"name" in a ? a.name : "spec"} and ${"name" in b ? b.name : "spec"} overlap`,
      )
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

test("an automation is in its actor's lane, and reads are drawn back from the read model", () => {
  const column = out.columns.find((c) => c.slice.automation)
  assert.ok(column)
  const gear = out.boxes.find((b) => b.column === column.index && b.kind === "automation")
  const command = out.boxes.find((b) => b.column === column.index && b.kind === "command")
  assert.ok(gear && command)
  assert.equal(rowOf(gear)?.id, "actor:system")
  assert.equal(
    out.boxes.filter((b) => b.column === column.index && b.compact).length,
    0,
    "no reference card when the read model is drawn in full",
  )
  const search = out.boxes.find(
    (b) => b.name === "ItemSearch" && b.kind === "readModel" && !b.compact,
  )
  assert.ok(search)
  const reads = out.edges.find((e) => e.from === search.id && e.to === gear.id)
  assert.ok(
    reads?.dashed && reads.points,
    "a dashed, routed edge from the read model to the automation",
  )
  const start = reads.points[0]
  assert.ok(start && start[0] > search.x + search.w / 2, "leaves the read model right of centre")
  assert.equal(start?.[1], search.y + search.h)
  const end = reads.points.at(-1)
  assert.ok(end && end[0] === gear.x && end[1] > gear.y && end[1] < gear.y + gear.h)
  const trigger = out.edges.find((e) => e.to === gear.id && e.points)
  assert.ok(trigger?.points)
  const into = trigger.points.at(-1)
  assert.ok(into && into[0] === gear.x && into[1] > gear.y && into[1] < gear.y + gear.h)
})

test("a read model nothing draws in full still gets a reference card", () => {
  const copy: ModelJson = JSON.parse(JSON.stringify(model))
  for (const c of copy.chapters)
    c.slices = c.slices.filter((s) => !s.read_models?.some((r) => r.startsWith("ItemSearch")))
  const ref = layout(copy).boxes.find((b) => b.name === "ItemSearch")
  assert.ok(ref?.compact && ref.canonical === undefined)
})

test("lanes say what they are, and the system lane is the automations", () => {
  const labels = out.rows.filter((r) => r.sub).map((r) => `${r.label} (${r.sub})`)
  assert.deepEqual(labels, [
    "User (Actor)",
    "Automations (System)",
    "Calendar (System)",
    "Items (Stream)",
    "Lists (Stream)",
  ])
})

test("a screen is a wireframe of its command or its read model", () => {
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

test("a table shows the columns that fit and counts the rest", () => {
  const { columns, more } = fitColumns(["userId", "listId", "name", "itemCount", "status"], 144)
  assert.ok(columns.length >= 2 && columns.length < 5)
  assert.equal(more, 5 - columns.length)
  const last = columns.at(-1)
  assert.ok(last && last.x + last.w <= 144 - 26, "room is left for the +n")
  assert.deepEqual(fitColumns(["a"], 144), { columns: [{ name: "a", x: 0, w: 5.2 + 12 }], more: 0 })
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
  const todoLists = out.boxes.filter((b) => b.name === "TodoList")
  assert.ok(todoLists.length > 1)
  const [full, ...later] = todoLists
  assert.ok(full && !full.compact && full.canonical === undefined)
  for (const b of later) {
    assert.ok(b.compact)
    assert.equal(b.canonical, full.id)
  }
  const added = out.boxes.filter((b) => b.name === "ItemAdded" && b.kind === "event")
  assert.equal(added.length, 2)
  assert.equal(added[1]?.canonical, added[0]?.id)
})

test("a note marks the card and the slice", () => {
  const created = out.boxes.find((b) => b.name === "ListCreated")
  assert.ok(created?.noted)
  assert.ok(!out.boxes.find((b) => b.name === "ItemAdded")?.noted)
})

test("specifications sit under their slice, one card per clause with a line per field", () => {
  const column = out.columns.find((c) => c.label === "AddItem")
  assert.ok(column)
  const specs = out.specs.filter((s) => s.column === column.index)
  assert.equal(specs.length, column.slice.tests.length)
  for (const s of specs) {
    assert.equal(rowOf(s)?.id, "specs")
    assert.ok(s.x >= column.x && s.x + s.w <= column.x + column.w)
  }
  const rejected = specs[1]
  assert.ok(rejected)
  const then = rejected.steps.find((st) => st.word === "then")
  assert.equal(then?.cards[0]?.kind, "error")
  const given = rejected.steps.find((st) => st.word === "given")
  assert.equal(given?.cards.length, 3)
  assert.equal(given?.cards[0]?.kind, "event")
  assert.equal(given?.cards[0]?.lines.length, 4)
})

test("the picture shows names as words", () => {
  assert.equal(words("DrawsAndResignation"), "Draws and Resignation")
  assert.equal(words("ItemAdded"), "Item Added")
  assert.equal(words("FIDEGame"), "FIDE Game")
  assert.equal(words("TodoService"), "Todo Service")
  assert.equal(out.chapters[0]?.title, "List Management")
  assert.equal(out.columns.find((c) => c.label === "ListTodoLists")?.title, "List Todo Lists")
})

test("a translation gets an automation of ours between the outside event and the command", () => {
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

test("a long value wraps inside its specification card", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  const copy: ModelJson = JSON.parse(JSON.stringify(model))
  const slice = copy.chapters[0]?.slices[0]
  assert.ok(slice?.tests[0])
  slice.tests[0].then = [`ListCreated(listId=list-1, fen=${fen})`]
  const spec = layout(copy).specs.find((s) => s.column === 0)
  const card = spec?.steps.find((st) => st.word === "then")?.cards[0]
  assert.ok(card && card.lines.length >= 3)
  for (const line of card.lines) assert.ok(line.length <= 24, line)
  assert.ok(card.lines[1]?.startsWith("fen = rnbq"), "the value starts on the field's own line")
  for (const line of card.lines.slice(2)) assert.ok(line.startsWith("  "), "overflow is indented")
  assert.equal(card.lines.slice(1).join("").replace(/\s/g, ""), `fen=${fen}`.replace(/\s/g, ""))
  assert.equal(wrap("abcdefghijklmnopqrstuvwxyz", 10).join("|"), "abcdefghij|klmnopqrst|uvwxyz")
  assert.deepEqual(wrap("Duplicate list name rejected", 26), ["Duplicate list name", "rejected"])
  assert.deepEqual(wrap("a bbbbbbbbbb", 8, 2), ["a bbbbbb", "  bbbb"])
})

test("a loose declaration is a column after the story, its card in its lane", () => {
  const storm = layout({
    ...model,
    loose: [
      { kind: "event", element: "Started(id)", aggregate: "lists" },
      { kind: "command", element: "Start(id)", aggregate: "lists" },
    ],
  })
  const last = storm.chapters.length - 1
  assert.equal(storm.chapters[last]?.title, "Not yet in a slice")
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
})
