# event-modeling

An [event model](https://eventmodeling.org/posts/what-is-event-modeling/) written in TypeScript,
and the `em` command that works on it. You get:

- a typed way to write the model, so a wrong slice does not compile;
- a live diagram in the browser that redraws on every save;
- a check of the whole model, where each error names the slice it found the problem in;
- one `.proto` file per service the model describes.

It runs wherever node 22 or later runs.

```ts
import { m, z } from "@noahseger/event-modeling"
```

## Vocabulary

| | | below |
|---|---|---|
| **event** | something that happened, in the past tense | `ListCreated` |
| **command** | something an actor wants to happen | `CreateList` |
| **read model** | a table built from events | `TodoList` |
| **actor** | who acts: a person, a role, or a machine of ours | `User` |
| **external** | a system we do not own, whose events we translate and never store | `Calendar` |
| **service** | the API that exposes a slice's procedure | `TodoService` |
| **stream** | the events and commands drawn in one lane | `Inventory` |
| **slice** | one column of the diagram | the "Create List" column |
| **chapter** | a run of slices under one heading | `ListManagement` |

## Naming

`m.` names what you declare, with nouns: `m.event`, `m.command`, `m.readModel`, ... A chain step
that fills a slot is a noun too (`.actor()`, `.command()`); one that connects is a verb (`.emits`,
`.reads`, `.projects`). A mapping's helpers are verbs (`count`, `generate`).

Your own names follow the practice: events in the past tense (`NoteCreated`), commands in the
imperative (`CreateNote`), read models as nouns (`Inbox`). A declaration is named by its export, or
by its key where it is grouped: a chapter in `m.model`, an event in `m.external`.

## How it fits together

**Names come from exports.** Export a declaration and the CLI uses the binding's name:
`export const ListCreated = m.event(...)` is the event `ListCreated`. A command or event can
instead be declared where a slice uses it, named by a string. Names are CamelCase, and the diagram
shows them as words. Any declaration accepts `.note("...")`.

**Fields are [Zod](https://zod.dev) schemas.** Events, commands and read models declare their fields
the same way. Zod types the example data in specifications and the generated messages.

**Slices connect declarations.** A slice is a chain of calls in the order the work happens. Nouns
fill a slot: `.actor()`, `.service()`, `.command()`, `.query()`. Verbs connect: `.reads()`,
`.emits()`, `.on()`, `.polls()`, `.projects()`. When a slice connects two declarations, fields with
the same name flow from one to the other. When the names differ, or a value has to be computed, pass
a function. The editor offers only the calls that can come next.

## The four slice patterns

| Pattern | Chain | Meaning |
|---|---|---|
| state change | `.actor().reads?().service().command().emits()` | An actor issues a command and events are recorded. |
| view | `.actor().query?().reads().service()` | An actor reads a read model through a service method. |
| automation | `.on().reads?().command().emits()` or `.polls().command().emits()` | An event, or a list of work, causes a command. No actor is involved. |
| state view | `.projects().on()...` | Events build a read model. |

`?` marks an optional call. A chain that stops before its last call is not a slice, and a chapter
rejects it.

## Quickstart

The model is a directory of TypeScript modules. Write it top to bottom as the story of the system,
declaring each thing where the story first needs it.

### 1. Set up

You need node 22 or later. The package is on GitHub Packages, not npmjs, so npm has to be told
where `@noahseger` packages live and how to sign in. Once per project, put this in `.npmrc` next
to your `package.json`:

```ini
@noahseger:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then put a GitHub personal access token (classic) with the `read:packages` scope in the
`GITHUB_TOKEN` environment variable. The file names the variable, so it is safe to commit. Now
install and scaffold:

```bash
npm install @noahseger/event-modeling
npx em init model
```

`init` writes `model/index.ts`, a `tsconfig.json` that lets node run the model with no build step,
and a `package.json` that marks the directory as ES modules. Start the diagram in a second
terminal and leave it running:

```bash
npx em view model
```

It opens the browser and redraws on every save, until you stop it with Ctrl-C. If `npm install`
answers `401` or `404`, the token is missing or lacks `read:packages`.

### 2. Actors and the service

```ts
export const User        = m.actor()
export const TodoService = m.service("todo.v1")
```

`m.actor()` is a person. Pass `{ icon: "admin" }` for one with authority, like an arbiter, and
`{ icon: "system" }` for a machine of ours. `m.service()` takes the
protobuf package; the service itself is named after the export.

### 3. The first slices

```ts
// A user creates a named list.
export const CreateList  = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
export const ListCreated = m.event({ listId: z.string(), userId: z.string(), name: z.string() })
  .note("Names are unique per user.")

// A user adds an item to a list.
export const AddItem   = m.command({ listId: z.string(), itemId: z.string(), text: z.string() })
export const ItemAdded = m.event({ listId: z.string(), itemId: z.string(), title: z.string() })

export const ListManagement = [
  m.slice()
    .actor(User)
    .service(TodoService)
    .command(CreateList)
    .emits(ListCreated),

  m.slice()
    .actor(User)
    .service(TodoService)
    .command(AddItem)
    .emits(ItemAdded, c => ({ title: c.text })),
]
```

A chapter is an array of slices. Step 9 names it and puts it in order.

In the first slice, every field of `ListCreated` has a namesake in `CreateList`, so nothing more is
needed. In the second, the command says `text` and the event says `title`, so a function supplies the
field that does not match. Fields that do match still flow on their own.

A value the handler assigns itself, such as an id or a clock, has no source. Mark it with `generate()`,
which the function gets as its second argument; a specification may give it any value:

```ts
.emits(NoteAdded, (c, { generate }) => ({ noteId: generate(), capturedAt: generate() }))
```

A command or event can also be declared in the slice that uses it. The string is its name; it is
drawn and checked like an exported one. A model can start from its commands this way:

```ts
m.slice()
  .actor(User)
  .service(TodoService)
  .command("RenameList", { listId: z.string(), name: z.string() })
  .emits("ListRenamed", { listId: z.string(), name: z.string() })
```

Export it once a specification needs an example of it. Two declarations with one name are an error.

A slice does not need a chapter to be drawn. Written on its own, as above, it is drawn after the
story under "Not in a chapter yet" until a chapter lists it.

A slice's column is headed by its command; by its read model when it projects one; by its service
method when it is a view. Pass a name, `m.slice("StartList")`, only when that heading would say the
wrong thing. The service method
is also named after the command, so the first slice becomes `rpc CreateList`; to use another method
name, pass it: `.service(TodoService, "StartList")`.

### 4. Read models

A read model is a table. `m.key` marks the columns that identify a row. A projection is a state view
slice: it names the read model, then says for each event what that event writes.

```ts
// A user's lists, one row per list.
export const TodoList = m.readModel({
  userId:    m.key(z.string()),
  listId:    m.key(z.string()),
  name:      z.string(),
  itemCount: z.number().int(),
  status:    z.enum(["open", "completed", "deleted"]),
})

export const Views = [
  m.slice()
    .projects(TodoList)
    .on(ListCreated, () => ({ itemCount: 0, status: "open" }))
    .on(ItemAdded, (e, { count }) => ({ itemCount: count(e) }))
    .on(ListCompleted, () => ({ status: "completed" }))
    .on(ListDeleted, () => ({ status: "deleted" })),

  m.slice()
    .actor(User)
    .query({ userId: z.string() })
    .reads(TodoList)
    .service(TodoService, "ListTodoLists"),
]
```

`ListCreated` carries `userId`, `listId` and `name`, so those columns fill themselves. The function
sets the two it does not carry. `count(e)`, from the function's second argument, is the number of `ItemAdded` events seen for the row.

An event finds its row by the key columns it carries. `ItemAdded` carries `listId` and not `userId`,
so this projection fails at assembly. Add `userId` to the event, or make `listId` the only key.

A view slice reads a read model through a service method. `.query()` declares the request fields;
without it the request is empty. A view names its method, because it has no command to take a name
from.

The same events can build a second table for a different question:

```ts
// Every item in every list, searchable by title.
export const ItemSearch = m.readModel({
  itemId: m.key(z.string()),
  listId: z.string(),
  title:  z.string(),
  done:   z.boolean(),
})

m.slice()
  .projects(ItemSearch)
  .on(ItemAdded, () => ({ done: false }))
  .on(ItemCompleted, () => ({ done: true })),

m.slice()
  .actor(User)
  .query({ text: z.string() })
  .reads(ItemSearch)
  .service(TodoService, "SearchItems"),
```

### 5. Specifications

A specification is a Given, When, Then example attached to a slice with `.test()`.

```ts
m.slice()
  .actor(User).service(TodoService).command(CreateList).emits(ListCreated)
  .test("User creates a new list", {
    when: CreateList({ userId: "u-1", listId: "list-1", name: "Groceries" }),
    then: ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" }),
  })
  .test("Duplicate list name rejected", {
    given:  ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" }),
    when:   CreateList({ userId: "u-1", listId: "list-2", name: "Groceries" }),
    reject: "list name already exists",
  }),
```

Calling a declaration builds an example of it from its fields, and Zod checks the values. `given`
and `then` accept one example or a list. A specification has `then`, the events recorded, or
`reject`, why the command is refused; never both.

A projection is specified the same way, without `when` or `reject`, because a read model cannot
reject an event:

```ts
m.slice()
  .projects(TodoList).on(ListCreated, () => ({ itemCount: 0, status: "open" }))
  .test("A new list shows with no items", {
    given: ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" }),
    then:  TodoList({ userId: "u-1", listId: "list-1", name: "Groceries", itemCount: 0, status: "open" }),
  }),
```

### 6. Automations

An automation issues a command with no actor. It has two forms.

```ts
// When the last item is done, the list completes.
export const CompleteList  = m.command({ listId: z.string() })
export const ListCompleted = m.event({ listId: z.string() })

export const Automations = [
  m.slice("ListCompleter")
    .on(ItemCompleted)
    .reads(ItemSearch)
    .command(CompleteList)
    .emits(ListCompleted),
]
```

`.on()` starts the slice when the event occurs, and `listId` flows from the event into the command.
`.reads()` names what the decision looks at, once per read model. An automation has no command heading its column but a
gear, so it is the one slice that usually takes a name. Name it for what it does.

The second form works through a list. From a hotel model:

```ts
m.slice("PaymentProcessor")
  .polls(PaymentsToProcess)
  .command(ProcessPayment)
  .emits(PaymentSucceeded),
```

`.polls()` runs on the processor's own schedule. No event and no service method starts it. The
projection that builds `PaymentsToProcess` marks the row done when it sees `PaymentSucceeded`.

### 7. Events from outside

```ts
// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external({
  TaskScheduled: m.event({ listId: z.string(), itemId: z.string(), text: z.string() }),
})

export const Integrations = [
  m.slice().on(Calendar.TaskScheduled).command(AddItem).emits(ItemAdded, c => ({ title: c.text })),
]
```

Declare the events of a system you do not own inside `m.external()`; each is named by its key.
They are drawn in the system's lane, `.on()` can receive them, and no slice can emit them. We
translate them and never store them.

### 8. Streams

A stream is a lane in the diagram. The todo app keeps lists and items apart:

```ts
// At the end of list-management.ts
export const Lists = m.stream({ CreateList, ListCreated, DeleteList, ListDeleted })
export const Items = m.stream({ AddItem, ItemAdded, CompleteItem, ItemCompleted, DeleteItem, ItemDeleted })

// At the end of views.ts
export const Lists = m.stream({ CompleteList, ListCompleted })
```

Two modules may export a stream under the same name; the CLI merges them into one lane, so each
chapter can group the events it declared. An event may belong to more than one stream and is drawn
in each lane, which is what a [dynamic consistency boundary](https://dcb.events) needs from the
picture. A model that declares no stream has one lane, called Events.

### 9. Assembly

```ts
// index.ts
import { ListManagement } from "./list-management.ts"
import { Views, Automations, Integrations } from "./views.ts"

export default m.model("Todo List Application", {
  description: "Users manage personal todo lists.",
  chapters: { ListManagement, Views, Automations, Integrations },
})
```

Each key names a chapter, and key order is the timeline. A chapter can also be written in place:
`chapters: { Onboarding: [m.slice()...] }`. Nothing else is listed. The CLI finds every other
declaration, and every slice, by walking the directory. The worked example is `examples/todo-app/`.

### 10. Look at it

The diagram from step 1 has followed every save. Click a card for its notes and specifications.
Now generate the API:

```bash
npx em proto model -o proto
```

`proto` writes one `.proto` file per service. `export` writes the viewer and the model into one HTML
file to share. `render` writes a still SVG; it needs python 3 with `pydantic`.

You do not have to finish first. `view` draws a model as far as it goes: an event in no slice yet
stands on its own in its lane, a slice in no chapter yet is drawn after the story, and what is left
to do is listed above the picture. So the first thing to write is the events, in a stream, and look.

## Validation

`tsc` checks each slice as you type. The CLI checks the whole model when it assembles, which every
command does first.

The compiler catches:

| Where | What |
|---|---|
| any reference | An unknown actor, event, command, read model or service cannot be written, because references are values, not strings. |
| the chain | Only a legal chain compiles. A chapter given an unfinished slice says what finishes it, such as `.emits(Event)`. |
| a function | Its argument is the source's fields. Its result must be fields of the target, with matching types. Its second argument holds only the helpers that apply: `generate` in `.emits()`, `count` in a projection. |
| `.emits()` | Every event field the command lacks must be set by the mapping, or marked `generate()`. The error names the fields. |
| `.service()` | A view must name its method. |
| `.test()` | `when` is the slice's command. `then` is its events or its read model; `reject` replaces `then`, and a projection has none. Zod checks the values. |

Assembly catches the rest, and each error names the slice it found the problem in:

| What | Why the compiler cannot |
|---|---|
| A declaration used in a slice that no module exports, or one exported under two names | It has no name until it is exported. |
| Two declarations with one name, such as `.emits("ListCreated", ...)` and an exported `ListCreated` | A name written in place is a string. |
| A column no `.on()` writes | The columns are filled across several `.on()` calls. |
| An event that carries none of the read model's key columns | Declarations are anonymous, so two events with the same fields are one type. |
| An event nothing consumes: no `.on()`, no `given` | Same. |
| An event no slice emits; a read model nothing reads or projects | Same. |
| A slice that emits an external event | The group decides, and the group is a runtime value. |
| Two slices claiming one service method | A union of literal types dedupes rather than counts. |
| A declaration in no slice, or a slice in no chapter | Whether a value is used is not a type. |

`event_model.py` then checks the emitted JSON for what neither can: event names in the past tense,
command names in the imperative, and example values that are not placeholders.

## Protobuf

`proto` writes one `.proto` file per service, at the path its package implies, ready for
`buf generate` with your own `buf.gen.yaml`. The output passes `buf lint` under `STANDARD`.

| Slice | Generates |
|---|---|
| state change | `rpc Command(CommandRequest) returns (CommandResponse)`. The request is the command's fields. The response is empty, because events are internal. |
| view | `rpc Method(MethodRequest) returns (MethodResponse)`. The request is the `.query()` fields. The response repeats the read model. |
| automation, state view | Nothing. They have no service method. |

Every command and read model becomes a `message`. Field numbers follow declaration order, so
appending a field is compatible and reordering one is not; `buf breaking` reports which you did.

The quickstart produces:

```proto
syntax = "proto3";

package todo.v1;

service TodoService {
  rpc CreateList(CreateListRequest) returns (CreateListResponse);
  rpc AddItem(AddItemRequest) returns (AddItemResponse);
  rpc ListTodoLists(ListTodoListsRequest) returns (ListTodoListsResponse);
  rpc SearchItems(SearchItemsRequest) returns (SearchItemsResponse);
}

message CreateListRequest {
  string user_id = 1;
  string list_id = 2;
  string name = 3;
}

message CreateListResponse {}

message ListTodoListsRequest {
  string user_id = 1;
}

message TodoList {
  string user_id = 1;
  string list_id = 2;
  string name = 3;
  int32 item_count = 4;
  string status = 5;
}

message ListTodoListsResponse {
  repeated TodoList todo_list = 1;
}
```

| Zod | proto |
|---|---|
| `z.string()`, `z.enum([...])` | `string` |
| `z.number()` | `double` |
| `z.number().int()` | `int32` |
| `z.boolean()` | `bool` |
| `z.array(T)` | `repeated T` |
| `z.object({...})` | a nested message |
| `.optional()` | `optional` |

Any other Zod type is an error that names the declaration and the field. The example's output is
`examples/proto`.

## CLI

```bash
npx em init   model/                 # scaffold a model directory
npx em view   model/                 # live diagram; runs until Ctrl-C
npx em export model/ -o model.html   # one self-contained page, for sharing
npx em json   model/                 # the JSON the viewer and the renderer read
npx em json   model/ --partial       # the same for an unfinished model, with what is left to do
npx em render model/ -o out.svg      # still picture
npx em proto  model/ -o proto        # one .proto per service
```

Every command also accepts a single self-contained file. `json` assembles the model and stops at
the first error. With `--partial` it goes on past dead ends and lists them in the JSON as
`warnings`, with the declarations in no slice as `loose`; `view` and `export` assemble that way.
`view` also type-checks the model on every save, with the `tsconfig.json` that `init` wrote, and
logs each compiler error as `file:line` with what assembly left to do, in the terminal and above the
picture. Node runs the TypeScript directly with `--experimental-strip-types`. The package carries
`zod` and exports it as `z`, so the model and the package read schemas with one copy. It carries
`typescript` too, so the model needs no other dependency; `render` also needs python 3 with
`pydantic`.

## Developing

```bash
git clone https://github.com/noahseger/agent-skills.git
cd agent-skills/event-modeling/ts
npm ci
npm test
```

`npm test` type-checks, lints, builds the viewer and the package, runs the node tests, and lints the
generated proto. It needs python 3 with `pydantic` for the renderer, the same as CI.

To model against the checkout, with nothing published, build it once and install it into a new
repository by path. npm links the directory, so a rebuild of the checkout is picked up on the next
save.

```bash
cd agent-skills/event-modeling/ts && npm ci && npm run build
```

```bash
mkdir ~/beer-model && cd ~/beer-model && git init
npm install ../agent-skills/event-modeling/ts
npx em init model
```

From there the quickstart applies unchanged: `npx em view model` in a second terminal, then write
`model/index.ts`. `npm pack` writes the tarball a release publishes, and the tests install it.

To release, raise `version` in `package.json`, commit, and push a tag with the same number:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The `publish` workflow builds the package and publishes it to GitHub Packages with the
repository's own token. It refuses a tag that does not match `package.json`.
