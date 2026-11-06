import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { m, type Slice } from "#em"

import { load } from "../src/assemble.ts"
import { generateProto } from "../src/proto.ts"
import { META, type ModelData, type Named } from "../src/types.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

test("the checked-in proto is what the model generates", async () => {
  const { model } = await load(here("../examples/todo-app"))
  const files = generateProto(model)
  assert.equal(files.length, 1)
  assert.equal(files[0]?.path, "todo/v1/todo_service.proto")
  assert.equal(
    files[0]?.source,
    readFileSync(here("../examples/proto/todo/v1/todo_service.proto"), "utf8"),
  )
})

// --- The generator reads the named model. Assembly's checks are another test's
// business, so these fixtures name their exports by hand and skip them. -------

const User = m.actor()
const Svc = m.service("t.v1")

type Slices = Slice[]

/** A one-service model of `slices`; `exports` are named as a module would name them. */
function modelOf(
  exports: Record<string, { readonly [META]: Named }>,
  ...slices: Slices
): ModelData {
  for (const [name, decl] of Object.entries({ Svc, ...exports })) decl[META].name = name
  return m.model("x", { chapters: { Ch: slices } })[META]
}

const source = (model: ModelData) => generateProto(model)[0]?.source ?? ""

const stateChange = (Create: ReturnType<typeof m.command>) =>
  m.slice().command(Create, m.event({})).actor(User).service(Svc)

test("field numbers follow declaration order", () => {
  const Create = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /message CreateRequest \{\n {2}string user_id = 1;\n {2}string list_id = 2;\n {2}string name = 3;\n\}/,
  )
})

test("every Zod type in the table maps as documented", () => {
  const Create = m.command({
    text: z.string(),
    kind: z.enum(["a", "b"]),
    fractional: z.number(),
    whole: z.number().int(),
    flag: z.boolean(),
    many: z.array(z.string()),
    owner: z.object({ id: z.string(), nick: z.string().optional() }),
    maybe: z.string().optional(),
  })
  assert.equal(
    source(modelOf({ Create }, stateChange(Create))),
    [
      'syntax = "proto3";',
      "",
      "package t.v1;",
      "",
      "service Svc {",
      "  rpc Create(CreateRequest) returns (CreateResponse);",
      "}",
      "",
      "message CreateRequest {",
      "  message Owner {",
      "    string id = 1;",
      "    optional string nick = 2;",
      "  }",
      "  string text = 1;",
      "  string kind = 2;",
      "  double fractional = 3;",
      "  int32 whole = 4;",
      "  bool flag = 5;",
      "  repeated string many = 6;",
      "  Owner owner = 7;",
      "  optional string maybe = 8;",
      "}",
      "",
      "message CreateResponse {}",
      "",
    ].join("\n"),
  )
})

test("a type outside the table is an error naming the declaration and the field", () => {
  const Create = m.command({ id: z.string(), when: z.date() })
  assert.throws(
    () => source(modelOf({ Create }, stateChange(Create))),
    /Create\.when can't become protobuf/,
  )
  const Table = m.readModel({ id: m.key(z.string()), amount: z.bigint() })
  assert.throws(
    () => source(modelOf({ Table }, m.slice().view(Table).actor(User).service(Svc, "Get"))),
    /Table\.amount can't become protobuf/,
  )
})

test("a view with no .query() has an empty request", () => {
  const Table = m.readModel({ id: m.key(z.string()) })
  const proto = source(modelOf({ Table }, m.slice().view(Table).actor(User).service(Svc, "Get")))
  assert.match(proto, /rpc Get\(GetRequest\) returns \(GetResponse\);/)
  assert.match(
    proto,
    /message GetRequest \{\}\n\nmessage Table \{\n {2}string id = 1;\n\}\n\nmessage GetResponse \{\n {2}repeated Table table = 1;\n\}\n$/,
  )
})

test("a service with no procedures produces no file", () => {
  const Table = m.readModel({ id: m.key(z.string()) })
  const Created = m.event({ id: z.string() })
  assert.deepEqual(
    generateProto(modelOf({ Table, Created }, m.slice().projection(Table, Created))),
    [],
  )
})

test("a slice without a service has no procedure", () => {
  const Table = m.readModel({ id: m.key(z.string()) })
  const Create = m.command({ id: z.string() })
  const slices = [m.slice().view(Table).actor(User), m.slice().command(Create, m.event({}))]
  assert.deepEqual(generateProto(modelOf({ Table, Create }, ...slices)), [])
})

test("two read models read by one view both appear in the response", () => {
  const Lists = m.readModel({ id: m.key(z.string()) })
  const Items = m.readModel({ id: m.key(z.string()), listId: z.string() })
  const view = m
    .slice()
    .view(Lists, Items)
    .query({ listId: z.string() })
    .actor(User)
    .service(Svc, "Get")
  const again = m.slice().view(Items).actor(User).service(Svc, "GetItems")
  const proto = source(modelOf({ Lists, Items }, view, again))
  assert.match(
    proto,
    /message GetResponse \{\n {2}repeated Lists lists = 1;\n {2}repeated Items items = 2;\n\}/,
  )
  assert.equal(proto.match(/^message Items \{/gm)?.length, 1, "a read model prints once")
  assert.match(
    proto,
    /message Items \{[\s\S]*message GetResponse/,
    "before the response that repeats it",
  )
})

test("a query that names every key column returns one row, not a list", () => {
  const Table = m.readModel({ userId: m.key(z.string()), id: m.key(z.string()), name: z.string() })
  const one = m
    .slice()
    .view(Table)
    .query({ userId: z.string(), id: z.string() })
    .actor(User)
    .service(Svc, "Get")
  const many = m.slice().view(Table).query({ userId: z.string() }).actor(User).service(Svc, "List")
  const proto = source(modelOf({ Table }, one, many))
  assert.match(proto, /message GetResponse \{\n {2}Table table = 1;\n\}/)
  assert.match(proto, /message ListResponse \{\n {2}repeated Table table = 1;\n\}/)
})
