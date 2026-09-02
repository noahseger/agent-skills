// Does the model answer the brief? That is the one thing left that no type
// system can decide, so it is the one thing these tests assert. Each test is
// one numbered requirement of tests/fixtures/todo_app_brief.md, checked on the
// assembled JSON.
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { assemble, type ModelJson } from "../src/assemble.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const model: ModelJson = await assemble(here("../examples/todo-app"))
const slices = model.chapters.flatMap((c) => c.slices)

const name = (element: string) => element.split("(")[0] ?? element
const fields = (element: string) =>
  element
    .slice(element.indexOf("(") + 1, -1)
    .split(",")
    .map((f) => f.trim().replace(/^\*/, ""))

/** The state-change slice whose command is `command`, or fails. */
function stateChange(command: string) {
  const slice = slices.find((s) => s.command !== undefined && name(s.command) === command)
  assert.ok(slice, `no slice issues ${command}`)
  assert.ok(slice.ui, `${command} has no service method`)
  assert.ok(slice.events?.length, `${command} emits nothing`)
  return slice
}

/** The view slice on `method`, with the read model it shows. */
function view(method: string) {
  const slice = slices.find((s) => s.ui?.endsWith(`/${method}`) && s.read_models?.length)
  assert.ok(slice, `no view on ${method}`)
  return { slice, columns: fields(slice.read_models?.[0] ?? "") }
}

const rejections = slices
  .flatMap((s) => s.tests)
  .flatMap((t) => t.then)
  .filter((clause) => clause.startsWith("Error:"))

test("1. create a named list; names are unique per user", () => {
  assert.ok(fields(stateChange("CreateList").command ?? "").includes("name"))
  assert.ok(
    rejections.some((r) => /already exists/.test(r)),
    "no rejection for a duplicate name",
  )
})

test("2. add an item with a title; at most 3 per list", () => {
  const slice = stateChange("AddItem")
  assert.ok(fields(slice.events?.[0] ?? "").includes("title"))
  assert.ok(
    rejections.some((r) => /maximum 3 items/.test(r)),
    "no rejection for a fourth item",
  )
})

test("3. mark an item done", () => {
  stateChange("CompleteItem")
})

test("4. delete an item", () => {
  stateChange("DeleteItem")
})

test("5. delete a list", () => {
  stateChange("DeleteList")
})

test("6. view all lists with name and item count", () => {
  const { columns } = view("ListTodoLists")
  for (const column of ["name", "itemCount"]) assert.ok(columns.includes(column), `no ${column}`)
})

test("7. view one list with its items and their done status", () => {
  const { slice, columns } = view("GetList")
  assert.deepEqual(slice.query, ["listId"])
  for (const column of ["title", "done"]) assert.ok(columns.includes(column), `no ${column}`)
})

test("8. a list completes on its own when every item is done", () => {
  const slice = slices.find((s) => s.automation && s.command && name(s.command) === "CompleteList")
  assert.ok(slice, "no automation issues CompleteList")
  assert.equal(name(slice.trigger as string), "ItemCompleted")
  assert.ok(slice.events?.some((e) => name(e) === "ListCompleted"))
})

test("9. the calendar pushes scheduled tasks in as items", () => {
  const slice = slices.find((s) => s.external_event)
  assert.ok(slice, "no slice receives an external event")
  assert.equal(model.actors.find((a) => a.id === slice.actor)?.name, "Calendar")
  assert.equal(name(slice.command ?? ""), "AddItem")
})

// The brief lists REST paths. The model is an RPC service, so each one has to
// land on a method rather than on a path.
const ENDPOINTS: [string, string][] = [
  ["POST /v1/lists", "TodoService/CreateList"],
  ["POST /v1/lists/{listId}/items", "TodoService/AddItem"],
  ["PATCH /v1/lists/{listId}/items/{itemId}", "TodoService/CompleteItem"],
  ["DELETE /v1/lists/{listId}/items/{itemId}", "TodoService/DeleteItem"],
  ["DELETE /v1/lists/{listId}", "TodoService/DeleteList"],
  ["GET /v1/lists", "TodoService/ListTodoLists"],
  ["GET /v1/lists/{listId}", "TodoService/GetList"],
]

for (const [endpoint, method] of ENDPOINTS) {
  test(`API: ${endpoint}`, () => {
    assert.ok(
      slices.some((s) => s.ui === method),
      `no slice exposes ${method}`,
    )
  })
}
