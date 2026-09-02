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
    if (b.kind === "ui" || b.kind === "external" || b.kind === "automation")
      assert.equal(row.id, `actor:${slice.actor}`)
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
  const reads = out.edges.find((e) => e.from === search.id && e.to === command.id)
  assert.ok(
    reads?.dashed && reads.points,
    "a dashed, routed edge from the read model to the command",
  )
  assert.deepEqual(reads.points[0], [search.x + search.w / 2, search.y + search.h])
  const end = reads.points.at(-1)
  assert.ok(end && end[0] === command.x && end[1] > command.y && end[1] < command.y + command.h)
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

test("edges that share an end fan out there", () => {
  const target = out.boxes.find(
    (b) => b.kind === "readModel" && b.name === "TodoList" && !b.compact,
  )
  assert.ok(target)
  const ends = out.edges
    .filter((e) => e.to === target.id && e.points)
    .map((e) => e.points?.at(-1)?.[0])
  assert.equal(new Set(ends).size, ends.length, "each edge into TodoList has its own x")
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
