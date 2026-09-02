// The layout over the example model: every slice is a column, every card lands
// in its lane, nothing overlaps, and every edge joins two cards that exist.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import type { ModelJson } from "../src/json.ts"
import { type Box, layout, parse, path } from "../viewer/src/layout.ts"

const model: ModelJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("./todo-app.json", import.meta.url)), "utf8"),
)
const out = layout(model)
const byId = new Map(out.boxes.map((b) => [b.id, b]))
const rowOf = (b: Box) => out.rows.find((r) => b.y >= r.y && b.y + b.h <= r.y + r.h)

test("parse reads a name, its fields, and the key columns", () => {
  assert.deepEqual(parse("TodoList(*userId, *listId, name)"), {
    name: "TodoList",
    fields: ["userId", "listId", "name"],
    keys: ["userId", "listId"],
  })
  assert.deepEqual(parse("ListCompleter"), { name: "ListCompleter", fields: [], keys: [] })
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
      if (a.id >= b.id) continue
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
    if (b.kind === "event") assert.equal(row.id, `stream:${slice.aggregate}`)
    if (b.kind === "command" || b.kind === "readModel" || b.kind === "automation")
      assert.equal(row.id, "middle")
  }
  const user = out.rows.find((r) => r.id === "actor:user")
  const calendar = out.rows.find((r) => r.id === "actor:calendar")
  assert.ok(user && calendar && user.y < calendar.y, "actor lanes follow the model's actor order")
})

test("every edge joins two cards, and a projection is fed by each of its events", () => {
  for (const e of out.edges) assert.ok(byId.has(e.from) && byId.has(e.to))
  const projection = out.columns.find((c) => Array.isArray(c.slice.trigger))
  assert.ok(projection)
  const target = out.boxes.find((b) => b.column === projection.index && b.kind === "readModel")
  assert.ok(target)
  const sources = out.edges
    .filter((e) => e.to === target.id)
    .map((e) => byId.get(e.from))
    .filter((b): b is Box => b !== undefined)
  assert.deepEqual(
    sources.map((b) => b.name).sort(),
    (projection.slice.trigger as string[]).map((t) => parse(t).name).sort(),
  )
  for (const s of sources) assert.equal(s.kind, "event")
})

test("a reference to a read model is compact and reads dashed into its consumer", () => {
  const automation = out.columns.find((c) => c.slice.automation)
  assert.ok(automation)
  const ref = out.boxes.find((b) => b.column === automation.index && b.compact)
  const gear = out.boxes.find((b) => b.column === automation.index && b.kind === "automation")
  assert.ok(ref && gear)
  assert.equal(ref.name, "ItemSearch")
  assert.ok(out.edges.some((e) => e.from === ref.id && e.to === gear.id && e.dashed))
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
})
