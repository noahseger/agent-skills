import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { t } from "#em"

import { load, loadModules } from "../src/assemble.ts"
import { generateProto } from "../src/proto.ts"
import type { Assembled } from "../src/types.ts"
import { d, m } from "./loose.ts"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

test("the checked-in proto is what the model generates", async () => {
  assert.deepEqual(generateProto(await load(here("../examples/todo-app"))), [
    {
      path: "todo/v1/todo_service.proto",
      service: "TodoService",
      source: readFileSync(here("../examples/proto/todo/v1/todo_service.proto"), "utf8"),
    },
  ])
})

// --- The generator reads the named model. Assembly's checks are another test's
// business, so these fixtures assemble partially and pass on no dead end. -----

type Chapters = Pick<Assembled, "chapters" | "unchaptered" | "errors">

/** A one-service model of what the test declared and wrote, with the names every test shares. */
function modelOf(): Chapters {
  m.actor("User")
  m.service("TestService", "t.v1")
  // What builds each state view's view; the generator never reads it.
  m.event("Created", { id: t.string() })
  // What a state change records; the generator never reads it.
  m.event("Done", {})
  const { chapters, unchaptered } = loadModules([{ default: m.model("x") }], { partial: true })
  return { chapters, unchaptered, errors: new Map() }
}

/** The first file's source, or else what stopped it. */
function source(model: Chapters): string {
  const file = generateProto(model)[0]
  return file === undefined ? "" : "source" in file ? file.source : file.errors.join("\n")
}

const stateChange = () =>
  m.slice().command(d.Create).event(d.Done).actor(d.User).service(d.TestService)

test("field numbers follow declaration order", () => {
  m.command("Create", { userId: t.string(), listId: t.string(), name: t.string() })
  stateChange()
  assert.match(
    source(modelOf()),
    /message CreateRequest \{\n {2}string user_id = 1;\n {2}string list_id = 2;\n {2}string name = 3;\n\}/,
  )
})

test("every field t builds maps as the table says, and buf lint passes it", () => {
  m.command("Create", {
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
  stateChange()
  const proto = source(modelOf())
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
  m.command("Create", { id: t.string(), pageId: t.string().describe("Set once synced") })
  stateChange()
  assert.match(
    source(modelOf()),
    /message CreateRequest \{\n {2}string id = 1;\n {2}\/\/ Set once synced\n {2}string page_id = 2;\n\}/,
  )
})

test("a field protobuf has no form for stops its service, naming the declaration and the field", () => {
  m.command("Create", { id: t.string(), tags: t.array(t.record(t.string())) })
  stateChange()
  assert.match(source(modelOf()), /^Create\.tags: no protobuf type for a list of records\./)
  m.view("Table", { id: t.string().key(), end: t.oneOf({ moves: t.array(t.string()) }) })
  m.slice().view(d.Table).event(d.Created).actor(d.User).service(d.TestService, "Get")
  assert.match(
    source(modelOf()),
    /^Table\.end\.moves: no protobuf type for a oneOf case that is a list or a record\./,
  )
})

test("a view with no .context() has an empty request", () => {
  m.view("Table", { id: t.string().key() })
  m.slice().view(d.Table).event(d.Created).actor(d.User).service(d.TestService, "Get")
  const proto = source(modelOf())
  assert.match(proto, /rpc Get\(GetRequest\) returns \(GetResponse\);/)
  assert.match(
    proto,
    /message GetRequest \{\}\n\nmessage Table \{\n {2}string id = 1;\n\}\n\nmessage GetResponse \{\n {2}repeated Table table = 1;\n\}\n$/,
  )
})

test("a service with no procedures produces no file", () => {
  m.view("Table", { id: t.string().key() })
  m.slice().view(d.Table).event(d.Created)
  assert.deepEqual(generateProto(modelOf()), [])
})

test("a slice without a service has no procedure", () => {
  m.view("Table", { id: t.string().key() })
  m.command("Create", { id: t.string() })
  m.slice().view(d.Table).event(d.Created).actor(d.User)
  m.slice().command(d.Create).event(d.Done)
  assert.deepEqual(generateProto(modelOf()), [])
})

test("two state views on one screen are two methods, each returning its own view", () => {
  m.view("Lists", { id: t.string().key() })
  m.view("Items", { id: t.string().key(), listId: t.string() })
  m.screen("Board")
  const view = (shown: ReturnType<typeof m.slice>, method: string) =>
    shown
      .event(d.Created)
      .context({ listId: t.string() })
      .actor(d.User)
      .screen(d.Board)
      .service(d.TestService, method)
  view(m.slice().view(d.Lists), "Get")
  view(m.slice().view(d.Items), "GetItems")
  const proto = source(modelOf())
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
  m.view("Table", fields)
  m.view("Rows", fields)
  m.slice()
    .view(d.Table)
    .event(d.Created)
    .context({ userId: t.string(), id: t.string() })
    .actor(d.User)
    .service(d.TestService, "Get")
  m.slice()
    .view(d.Rows)
    .event(d.Created)
    .context({ userId: t.string() })
    .actor(d.User)
    .service(d.TestService, "List")
  const proto = source(modelOf())
  assert.match(proto, /message GetResponse \{\n {2}Table table = 1;\n\}/)
  assert.match(proto, /message ListResponse \{\n {2}repeated Rows rows = 1;\n\}/)
})

test("a list view's response is a list, whatever its context names; a view with no key column's, its one row", () => {
  m.view("Notes", t.array({ id: t.string().key(), what: t.string() }))
  m.view("Revenue", { total: t.int() })
  m.slice()
    .view(d.Notes)
    .event(d.Created)
    .context({ id: t.string() })
    .actor(d.User)
    .service(d.TestService, "ListNotes")
  m.slice().view(d.Revenue).event(d.Created).actor(d.User).service(d.TestService, "Get")
  const proto = source(modelOf())
  assert.match(proto, /message ListNotesResponse \{\n {2}repeated Notes notes = 1;\n\}/)
  assert.match(proto, /message GetResponse \{\n {2}Revenue revenue = 1;\n\}/)
})
