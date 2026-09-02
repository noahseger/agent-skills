import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { m } from "#em"
import { z } from "zod"

import { load } from "../src/assemble.ts"
import { generateProto } from "../src/proto.ts"
import { META, type ModelData, type Named } from "../src/types.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

test("the checked-in proto is what the model generates", async () => {
  const { model } = await load(here("../examples/todo-app"))
  const files = generateProto(model)
  assert.equal(files.length, 1)
  assert.equal(files[0]?.path, "todo/v1/todo_service.proto")
  assert.equal(files[0]?.source, readFileSync(here("../examples/proto/todo/v1/todo_service.proto"), "utf8"))
})

// --- The generator reads the named model. Assembly's checks are another test's
// business, so these fixtures name their exports by hand and skip them. -------

const User = m.actor()
const Svc = m.service("t.v1")

type Slices = Parameters<typeof m.chapter>[0]

/** A one-service model of `slices`; `exports` are named as a module would name them. */
function modelOf(exports: Record<string, { readonly [META]: Named }>, ...slices: Slices): ModelData {
  for (const [name, decl] of Object.entries({ Svc, ...exports })) decl[META].name = name
  return m.model("x", { chapters: [m.chapter(slices)] })[META]
}

const source = (model: ModelData) => generateProto(model)[0]?.source ?? ""

const stateChange = (Create: ReturnType<typeof m.command>) =>
  m.slice().actor(User).service(Svc).command(Create).emits(m.event({}))

test("field numbers follow declaration order", () => {
  const Create = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /message CreateRequest \{\n  string user_id = 1;\n  string list_id = 2;\n  string name = 3;\n\}/,
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
  assert.throws(() => source(modelOf({ Create }, stateChange(Create))), /Create\.when has no protobuf type/)
  const Table = m.readModel({ id: m.key(z.string()), amount: z.bigint() })
  assert.throws(
    () => source(modelOf({ Table }, m.slice().actor(User).reads(Table).service(Svc, "Get"))),
    /Table\.amount has no protobuf type/,
  )
})

test("a view with no .query() has an empty request", () => {
  const Table = m.readModel({ id: m.key(z.string()) })
  const proto = source(modelOf({ Table }, m.slice().actor(User).reads(Table).service(Svc, "Get")))
  assert.match(proto, /rpc Get\(GetRequest\) returns \(GetResponse\);/)
  assert.match(proto, /message GetRequest \{\}\n\nmessage Table \{\n  string id = 1;\n\}\n\nmessage GetResponse \{\n  repeated Table table = 1;\n\}\n$/)
})

test("a service with no procedures produces no file", () => {
  const Table = m.readModel({ id: m.key(z.string()) })
  const Created = m.event({ id: z.string() })
  assert.deepEqual(generateProto(modelOf({ Table, Created }, m.slice().projects(Table).on(Created))), [])
})

test("two read models read by one view both appear in the response", () => {
  const Lists = m.readModel({ id: m.key(z.string()) })
  const Items = m.readModel({ id: m.key(z.string()), listId: z.string() })
  const view = m.slice().actor(User).query({ listId: z.string() }).reads(Lists).reads(Items).service(Svc, "Get")
  const again = m.slice().actor(User).reads(Items).service(Svc, "GetItems")
  const proto = source(modelOf({ Lists, Items }, view, again))
  assert.match(proto, /message GetResponse \{\n  repeated Lists lists = 1;\n  repeated Items items = 2;\n\}/)
  assert.equal(proto.match(/^message Items \{/gm)?.length, 1, "a read model prints once")
  assert.match(proto, /message Items \{[^]*message GetResponse/, "before the response that repeats it")
})

test("a query that names every key column returns one row, not a list", () => {
  const Table = m.readModel({ userId: m.key(z.string()), id: m.key(z.string()), name: z.string() })
  const one = m.slice().actor(User).query({ userId: z.string(), id: z.string() }).reads(Table).service(Svc, "Get")
  const many = m.slice().actor(User).query({ userId: z.string() }).reads(Table).service(Svc, "List")
  const proto = source(modelOf({ Table }, one, many))
  assert.match(proto, /message GetResponse \{\n  Table table = 1;\n\}/)
  assert.match(proto, /message ListResponse \{\n  repeated Table table = 1;\n\}/)
})
