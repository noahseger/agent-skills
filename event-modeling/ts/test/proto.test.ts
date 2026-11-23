import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { m, type Slice, t, type Viewing } from "#em"

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
const TestService = m.service("t.v1")
/** What builds each state view's view; the generator never reads it. */
const Created = m.event({ id: t.string() })
/** What a state change records; the generator never reads it. */
const Done = m.event({})

type Slices = Slice[]

type Chapters = Pick<Assembled, "chapters" | "unchaptered" | "unfinished">

/** A one-service model of `slices`; `exports` are named as a module would name them. */
function modelOf(exports: Record<string, { readonly [META]: Named }>, ...slices: Slices): Chapters {
  for (const [name, decl] of Object.entries({ TestService, ...exports })) decl[META].name = name
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
  m.slice().command({ Create }).event({ Done }).actor(User).service(TestService)

test("field numbers follow declaration order", () => {
  const Create = m.command({ userId: t.string(), listId: t.string(), name: t.string() })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /message CreateRequest \{\n {2}string user_id = 1;\n {2}string list_id = 2;\n {2}string name = 3;\n\}/,
  )
})

test("every field t builds maps as the table says, and buf lint passes it", () => {
  const Create = m.command({
    text: t.string(),
    id: t.uuid(),
    email: t.email(),
    site: t.url(),
    day: t.date(),
    at: t.datetime(),
    takes: t.duration(),
    kind: t.enum(["a", "b"]),
    only: t.literal("x"),
    fractional: t.number(),
    whole: t.int(),
    flag: t.boolean(),
    many: t.array(t.string()),
    rows: t.array({ sku: t.string() }),
    owner: t.object({ id: t.string(), nick: t.string().optional() }),
    maybe: t.string().optional(),
    labels: t.record(t.string()),
    counts: t.record(t.int()).optional(),
    outcome: t.oneOf({ win: t.enum(["white", "black"]), draw: t.object({ reason: t.string() }) }),
    since: t.datetime().optional(),
  })
  const proto = source(modelOf({ Create }, stateChange(Create)))
  assert.equal(
    proto,
    [
      'syntax = "proto3";',
      "",
      "package t.v1;",
      "",
      'import "google/protobuf/timestamp.proto";',
      'import "google/protobuf/duration.proto";',
      "",
      "service TestService {",
      "  rpc Create(CreateRequest) returns (CreateResponse);",
      "}",
      "",
      "message CreateRequest {",
      "  message Rows {",
      "    string sku = 1;",
      "  }",
      "  message Owner {",
      "    string id = 1;",
      "    optional string nick = 2;",
      "  }",
      "  message Draw {",
      "    string reason = 1;",
      "  }",
      "  string text = 1;",
      "  string id = 2;",
      "  string email = 3;",
      "  string site = 4;",
      "  string day = 5;",
      "  google.protobuf.Timestamp at = 6;",
      "  google.protobuf.Duration takes = 7;",
      "  string kind = 8;",
      "  string only = 9;",
      "  double fractional = 10;",
      "  int32 whole = 11;",
      "  bool flag = 12;",
      "  repeated string many = 13;",
      "  repeated Rows rows = 14;",
      "  Owner owner = 15;",
      "  optional string maybe = 16;",
      "  map<string, string> labels = 17;",
      "  map<string, int32> counts = 18;",
      "  oneof outcome {",
      "    string win = 19;",
      "    Draw draw = 20;",
      "  }",
      "  optional google.protobuf.Timestamp since = 21;",
      "}",
      "",
      "message CreateResponse {}",
      "",
    ].join("\n"),
  )
  const dir = mkdtempSync(join(tmpdir(), "em-buf-"))
  try {
    cpSync(here("../examples/proto/buf.yaml"), join(dir, "buf.yaml"))
    mkdirSync(join(dir, "t", "v1"), { recursive: true })
    writeFileSync(join(dir, "t", "v1", "svc.proto"), proto)
    const lint = spawnSync(here("../node_modules/.bin/buf"), ["lint", dir], { encoding: "utf8" })
    assert.equal(lint.status, 0, lint.stdout + lint.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a field's description is the comment above it", () => {
  const Create = m.command({ id: t.string(), pageId: t.string().describe("Set once synced") })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /message CreateRequest \{\n {2}string id = 1;\n {2}\/\/ Set once synced\n {2}string page_id = 2;\n\}/,
  )
})

test("a field protobuf has no form for stops its service, naming the declaration and the field", () => {
  const Create = m.command({ id: t.string(), tags: t.array(t.record(t.string())) })
  assert.match(
    source(modelOf({ Create }, stateChange(Create))),
    /^Create\.tags can't become protobuf: a list of records\./,
  )
  const Table = m.view({ id: t.string().key(), end: t.oneOf({ moves: t.array(t.string()) }) })
  assert.match(
    source(
      modelOf(
        { Table },
        m.slice().view({ Table }).event({ Created }).actor(User).service(TestService, "Get"),
      ),
    ),
    /^Table\.end\.moves can't become protobuf: a oneOf case that is a list or a record\./,
  )
})

test("a view with no .context() has an empty request", () => {
  const Table = m.view({ id: t.string().key() })
  const proto = source(
    modelOf(
      { Table },
      m.slice().view({ Table }).event({ Created }).actor(User).service(TestService, "Get"),
    ),
  )
  assert.match(proto, /rpc Get\(GetRequest\) returns \(GetResponse\);/)
  assert.match(
    proto,
    /message GetRequest \{\}\n\nmessage Table \{\n {2}string id = 1;\n\}\n\nmessage GetResponse \{\n {2}repeated Table table = 1;\n\}\n$/,
  )
})

test("a service with no procedures produces no file", () => {
  const Table = m.view({ id: t.string().key() })
  assert.deepEqual(
    generateProto(modelOf({ Table }, m.slice().view({ Table }).event({ Created }))),
    [],
  )
})

test("a slice without a service has no procedure", () => {
  const Table = m.view({ id: t.string().key() })
  const Create = m.command({ id: t.string() })
  const slices = [
    m.slice().view({ Table }).event({ Created }).actor(User),
    m.slice().command({ Create }).event({ Done }),
  ]
  assert.deepEqual(generateProto(modelOf({ Table, Create }, ...slices)), [])
})

test("two state views on one screen are two methods, each returning its own view", () => {
  const Lists = m.view({ id: t.string().key() })
  const Items = m.view({ id: t.string().key(), listId: t.string() })
  const Board = m.screen()
  const view = (shown: Viewing<typeof Lists.__fields>, method: string) =>
    shown
      .event({ Created })
      .context({ listId: t.string() })
      .actor(User)
      .screen(Board)
      .service(TestService, method)
  const proto = source(
    modelOf(
      { Lists, Items },
      view(m.slice().view({ Lists }), "Get"),
      view(m.slice().view({ Items }), "GetItems"),
    ),
  )
  assert.match(
    proto,
    /message Lists \{[\s\S]*message GetResponse \{\n {2}repeated Lists lists = 1;\n\}/,
  )
  assert.match(
    proto,
    /message Items \{[\s\S]*message GetItemsResponse \{\n {2}repeated Items items = 1;\n\}/,
  )
})

test("a context that names every key column returns one row, not a list", () => {
  const fields = { userId: t.string().key(), id: t.string().key(), name: t.string() }
  const [Table, Rows] = [m.view(fields), m.view(fields)]
  const one = m
    .slice()
    .view({ Table })
    .event({ Created })
    .context({ userId: t.string(), id: t.string() })
    .actor(User)
    .service(TestService, "Get")
  const many = m
    .slice()
    .view({ Rows })
    .event({ Created })
    .context({ userId: t.string() })
    .actor(User)
    .service(TestService, "List")
  const proto = source(modelOf({ Table, Rows }, one, many))
  assert.match(proto, /message GetResponse \{\n {2}Table table = 1;\n\}/)
  assert.match(proto, /message ListResponse \{\n {2}repeated Rows rows = 1;\n\}/)
})

test("a list view's response is a list, whatever its context names; a view with no key column's, its one row", () => {
  const Notes = m.view(t.array({ id: t.string().key(), what: t.string() }))
  const Revenue = m.view({ total: t.int() })
  const list = m
    .slice()
    .view({ Notes })
    .event({ Created })
    .context({ id: t.string() })
    .actor(User)
    .service(TestService, "ListNotes")
  const one = m.slice().view({ Revenue }).event({ Created }).actor(User).service(TestService, "Get")
  const proto = source(modelOf({ Notes, Revenue }, list, one))
  assert.match(proto, /message ListNotesResponse \{\n {2}repeated Notes notes = 1;\n\}/)
  assert.match(proto, /message GetResponse \{\n {2}Revenue revenue = 1;\n\}/)
})
