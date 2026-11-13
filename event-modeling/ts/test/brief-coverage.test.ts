// Does the model answer the brief? That is the one thing left that no type
// system can decide, so it is the one thing these tests assert. Each test is
// one numbered requirement of fixtures/todo_app_brief.md, checked on the
// spec JSON the model emits.
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { assemble } from "../src/assemble.ts"
import type { SpecElement } from "../src/spec.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const { slices } = (await assemble(here("../examples/todo-app"))).model

const fields = (el: SpecElement | undefined) => (el?.fields ?? []).map((f) => f.name)
const served = (el: SpecElement | undefined) => el && `${el.service}/${el.apiEndpoint}`

/** The state-change slice whose command is `command`, or fails. */
function stateChange(command: string) {
  const slice = slices.find(
    (s) => s.sliceType === "STATE_CHANGE" && s.commands[0]?.title === command,
  )
  assert.ok(slice, `no slice issues ${command}`)
  assert.ok(slice.commands[0]?.apiEndpoint, `${command} has no service method`)
  assert.ok(slice.events.length, `${command} emits nothing`)
  return slice
}

/** The state view slice on `method`, with the view it shows. */
function view(method: string) {
  const slice = slices.find((s) => s.readmodels[0]?.apiEndpoint === method)
  assert.ok(slice, `no view on ${method}`)
  return { slice, columns: fields(slice.readmodels[0]) }
}

const rejections = slices
  .flatMap((s) => s.specifications)
  .flatMap((t) => t.then)
  .filter((step) => step.type === "SPEC_ERROR")
  .map((step) => step.title)

test("1. create a named list; names are unique per user", () => {
  assert.ok(fields(stateChange("CreateList").commands[0]).includes("name"))
  assert.ok(
    rejections.some((r) => /already exists/.test(r)),
    "no rejection for a duplicate name",
  )
})

test("2. add an item with a title; at most 3 per list", () => {
  const slice = stateChange("AddItem")
  assert.ok(fields(slice.events[0]).includes("title"))
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
  assert.deepEqual(fields(slice.screens[0]), ["listId"])
  for (const column of ["title", "done"]) assert.ok(columns.includes(column), `no ${column}`)
})

test("8. a list completes on its own when every item is done", () => {
  const slice = slices.find(
    (s) => s.sliceType === "AUTOMATION" && s.commands[0]?.title === "CompleteList",
  )
  assert.ok(slice, "no automation issues CompleteList")
  const trigger = slice.events.find((e) =>
    e.dependencies.some((d) => d.elementType === "AUTOMATION"),
  )
  assert.equal(trigger?.title, "ItemCompleted")
  assert.ok(slice.events.some((e) => e.title === "ListCompleted"))
})

test("9. the calendar pushes scheduled tasks in as items", () => {
  const slice = slices.find((s) => s.sliceType === "TRANSLATION")
  assert.ok(slice, "no slice receives an external event")
  assert.equal(slice.events.find((e) => e.context === "EXTERNAL")?.service, "Calendar")
  assert.equal(slice.commands[0]?.title, "AddItem")
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
      slices.some((s) => [s.commands[0], s.readmodels[0]].some((el) => served(el) === method)),
      `no slice exposes ${method}`,
    )
  })
}
