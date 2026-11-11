import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { m, type Slice } from "#em"

import { load } from "../src/assemble.ts"
import { generateProto } from "../src/proto.ts"
import { type Assembled, META, type Named } from "../src/types.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

test("the checked-in proto is what the model generates", async () => {
  assert.deepEqual(generateProto(await load(here("../examples/todo-app"))), [
    {
      path: "todo/v1/todo_service.proto",
      source: readFileSync(here("../examples/proto/todo/v1/todo_service.proto"), "utf8"),
    },
  ])
})

// --- The generator reads the named model. Assembly's checks are another test's
// business, so these fixtures name their exports by hand and skip them. -------

const User = m.actor()
const Svc = m.service("t.v1")
/** What builds each view's read model; the generator never reads it. */
const Created = m.event({ id: z.string() })

type Slices = Slice[]

type Chapters = Pick<Assembled, "chapters" | "unchaptered" | "unfinished">

/** A one-service model of `slices`; `exports` are named as a module would name them. */
function modelOf(exports: Record<string, { readonly [META]: Named }>, ...slices: Slices): Chapters {
  for (const [name, decl] of Object.entries({ Svc, ...exports })) decl[META].name = name
  return {
    chapters: [{ name: "Ch", slices: slices.map((s) => s[META]) }],
    unchaptered: [],
    unfinished: new Map(),
  }
}

/** The first file's source, or else what stopped it. */
function source(model: Chapters): string {
  const file = generateProto(model)[0]
  return file === undefined ? "" : "source" in file ? file.source : file.problems.join("\n")
}

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
    labels: z.record(z.string(), z.string()),
    counts: z.record(z.string(), z.number().int()).optional(),
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
      "  map<string, string> labels = 9;",
      "  map<string, int32> counts = 10;",
      "}",
      "",
      "message CreateResponse {}",
      "",
    ].join("\n"),
  )
})

test("a type outside the table stops its service, naming the declaration and the field", () => {
  const Create = m.command({ id: z.string(), when: z.date() })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /^Create\.when can't become protobuf/,
  )
  const Table = m.readModel({ id: z.string(), amount: z.bigint() }).key("id")
  assert.match(
    source(modelOf({ Table }, m.slice().view(Table, Created).actor(User).service(Svc, "Get"))),
    /^Table\.amount can't become protobuf/,
  )
})

test("a view with no .query() has an empty request", () => {
  const Table = m.readModel({ id: z.string() }).key("id")
  const proto = source(
    modelOf({ Table }, m.slice().view(Table, Created).actor(User).service(Svc, "Get")),
  )
  assert.match(proto, /rpc Get\(GetRequest\) returns \(GetResponse\);/)
  assert.match(
    proto,
    /message GetRequest \{\}\n\nmessage Table \{\n {2}string id = 1;\n\}\n\nmessage GetResponse \{\n {2}repeated Table table = 1;\n\}\n$/,
  )
})

test("a service with no procedures produces no file", () => {
  const Table = m.readModel({ id: z.string() }).key("id")
  assert.deepEqual(generateProto(modelOf({ Table }, m.slice().view(Table, Created))), [])
})

test("a slice without a service has no procedure", () => {
  const Table = m.readModel({ id: z.string() }).key("id")
  const Create = m.command({ id: z.string() })
  const slices = [
    m.slice().view(Table, Created).actor(User),
    m.slice().command(Create, m.event({})),
  ]
  assert.deepEqual(generateProto(modelOf({ Table, Create }, ...slices)), [])
})

test("two views on one screen are two methods, each returning its own read model", () => {
  const Lists = m.readModel({ id: z.string() }).key("id")
  const Items = m.readModel({ id: z.string(), listId: z.string() }).key("id")
  const Board = m.screen()
  const view = (readModel: typeof Lists, method: string) =>
    m
      .slice()
      .view(readModel, Created)
      .query({ listId: z.string() })
      .actor(User)
      .screen(Board)
      .service(Svc, method)
  const proto = source(modelOf({ Lists, Items }, view(Lists, "Get"), view(Items, "GetItems")))
  assert.match(
    proto,
    /message Lists \{[\s\S]*message GetResponse \{\n {2}repeated Lists lists = 1;\n\}/,
  )
  assert.match(
    proto,
    /message Items \{[\s\S]*message GetItemsResponse \{\n {2}repeated Items items = 1;\n\}/,
  )
})

test("a query that names every key column returns one row, not a list", () => {
  const fields = { userId: z.string(), id: z.string(), name: z.string() }
  const [Table, Rows] = [
    m.readModel(fields).key("userId", "id"),
    m.readModel(fields).key("userId", "id"),
  ]
  const one = m
    .slice()
    .view(Table, Created)
    .query({ userId: z.string(), id: z.string() })
    .actor(User)
    .service(Svc, "Get")
  const many = m
    .slice()
    .view(Rows, Created)
    .query({ userId: z.string() })
    .actor(User)
    .service(Svc, "List")
  const proto = source(modelOf({ Table, Rows }, one, many))
  assert.match(proto, /message GetResponse \{\n {2}Table table = 1;\n\}/)
  assert.match(proto, /message ListResponse \{\n {2}repeated Rows rows = 1;\n\}/)
})
