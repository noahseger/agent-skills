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
| **stream** | a lane of events in the diagram | `Lists` |
| **slice** | one column of the diagram | the "Create List" column |
| **chapter** | a run of slices under one heading | `ListManagement` |

## Naming

A slice starts with what starts it. `m.` names what you declare, and every call of a slice's chain
names the elements it takes, so both are nouns: `m.command`, `.command()`, `.event()`,
`.readModel()`, `.actor()`. Only a mapping's helpers are verbs, because they do something:
`count`, `generate`.

Your own names follow the practice: events in the past tense (`NoteCreated`), commands in the
imperative (`CreateNote`), read models as nouns (`Inbox`). A declaration is named by its export; a
chapter, by its key in `m.model`.

## How it fits together

**Names come from exports.** Export a declaration and the CLI uses the binding's name:
`export const ListCreated = m.event(...)` is the event `ListCreated`. Names are CamelCase, and the
diagram shows them as words. Any declaration accepts `.note("...")`.

**Fields are [Zod](https://zod.dev) schemas.** Events, commands and read models declare their fields
the same way. Zod types the example data in specifications and the generated messages.

**Slices connect declarations.** A slice is a chain of calls. The first takes the slice's whole
pattern, starting with what starts it, so an incomplete slice does not compile; the rest add to it. When a slice connects two declarations, fields with the same name
flow from one to the other. When the names differ, or a value has to be computed, call the
declaration with a function: `ItemAdded((c) => ({ title: c.text }))`. The function's argument is the
slice's source, so the editor knows its fields. The editor offers only the calls that can come next.

## The slice patterns

| Pattern | Starts with | Chain | Meaning |
|---|---|---|---|
| state change | the command | `.command(Command, Event)` | An actor issues a command and events are recorded. |
| view | the read model | `.view(ReadModel)` | An actor reads a read model. |
| automation | the trigger event, or a to-do list | `.trigger(Event, Command, Event)` or `.todoList(ReadModel, Command, Event)` | An event, or a list of work, causes a command. No actor is involved. |
| state view | the read model | `.projection(ReadModel, Event)` | Events build a read model. |

The first call is the whole pattern, and leaving out any of its arguments is an error where the slice
is written. Every later step is optional: `.event()` adds another event, `.readModel()` names what
the handler reads, once per read model, `.query()` gives a view its request fields, and `.test()`
adds a specification. A state change or a view also takes `.actor()` and `.service()`, and needs
neither.

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
    .command(CreateList, ListCreated)
    .actor(User)
    .service(TodoService),

  m.slice()
    .command(AddItem, ItemAdded(c => ({ title: c.text })))
    .actor(User)
    .service(TodoService),
]
```

A chapter is an array of slices. Step 9 names it and puts it in order.

In the first slice, every field of `ListCreated` has a namesake in `CreateList`, so nothing more is
needed. In the second, the command says `text` and the event says `title`, so the event is called
with a function that supplies the field that does not match. Its argument is the command. Fields that
do match still flow on their own.

A value the handler assigns itself, such as an id or a clock, has no source. Mark it with `generate()`,
which the function gets as its second argument; a specification may give it any value:

```ts
.command(AddNote, NoteAdded((c, { generate }) => ({ noteId: generate(), capturedAt: generate() })))
```

`.actor()` takes any number of actors, and each is drawn with a screen. Without one the slice has
no screen; without `.service()` it has no service method. When the handler reads a read model to
decide, name it: `.command(FileNote, NoteFiled).readModel(Inbox)`.

A slice does not need a chapter to be drawn. Written on its own, `m.slice().command(...)` with no
array around it, it is drawn after the story under "Not in a chapter yet" until a chapter lists it.

A slice's column is headed by its command; by its read model when it projects one; by its service
method when it is a view, or its read model when the view has no service. Pass a name,
`m.slice("StartList")`, only when that heading would say the wrong thing. The service method is also
named after the command, so the first slice becomes `rpc CreateList`; to use another method name,
pass it: `.service(TodoService, "StartList")`.

### 4. Read models

A read model is a table. `m.key` marks the columns that identify a row. A projection is a state view
slice: it starts with the read model, then names each event that writes it.

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
    .projection(TodoList, ListCreated(() => ({ itemCount: 0, status: "open" })))
    .event(ItemAdded((e, { count }) => ({ itemCount: count(e) })))
    .event(ListCompleted(() => ({ status: "completed" })))
    .event(ListDeleted(() => ({ status: "deleted" }))),

  m.slice()
    .view(TodoList)
    .query({ userId: z.string() })
    .actor(User)
    .service(TodoService, "ListTodoLists"),
]
```

`ListCreated` carries `userId`, `listId` and `name`, so those columns fill themselves. The function
sets the two it does not carry; in a projection its argument is the event. `count(e)`, from the
function's second argument, is the number of `ItemAdded` events seen for the row.

An event finds its row by the key columns it carries. `ItemAdded` carries `listId` and not `userId`,
so this projection fails at assembly. Add `userId` to the event, or make `listId` the only key.

A view slice starts with the read models it shows, `.view(TodoList)`, or several:
`.view(GameState, MoveList)`. `.query()` declares the request fields; without it the request is
empty. A view given a service names its method, because it has no command to take a name from.

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
  .projection(ItemSearch, ItemAdded(() => ({ done: false })))
  .event(ItemCompleted(() => ({ done: true }))),

m.slice()
  .view(ItemSearch)
  .query({ text: z.string() })
  .actor(User)
  .service(TodoService, "SearchItems"),
```

Every `.projection()` of a read model adds to it, so a later chapter extends a table next to the
event that changes it. Each is its own column, where it happens in the story; a column one of them
fills is filled.

```ts
// chapter Capture
m.slice().projection(Inbox, NoteCreated(() => ({ status: "inbox" }))),
// chapter Filing, further down the file
m.slice().projection(Inbox, NoteFiled(() => ({ status: "filed" }))),
```

### 5. Specifications

A specification is a Given, When, Then example attached to a slice with `.test()`.

```ts
m.slice()
  .command(CreateList, ListCreated).actor(User).service(TodoService)
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
`reject`, why the command is refused; never both. Called with data, a declaration is an example;
called with a function, it is a use in a slice.

The events a command lists, `.command(AddItem, ItemAdded).event(ListFull)`, are what it can
produce, not a sequence; the diagram draws them side by side. A specification says which happens:
its `then` lists the events recorded in that case, one, or several when the command records them
together. Until a specification's `then` shows each of them, external events included, the model is
unfinished.

A projection is specified the same way, without `when` or `reject`, because a read model cannot
reject an event:

```ts
m.slice()
  .projection(TodoList, ListCreated(() => ({ itemCount: 0, status: "open" })))
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
    .trigger(ItemCompleted, CompleteList, ListCompleted)
    .readModel(ItemSearch),
]
```

`.trigger()` starts the slice when the event occurs, and `listId` flows from the event into the
command. A command field the event does not carry is set by calling the command with a function,
whose argument is the event: `.trigger(NoteCreated, ClassifyNote((e) => ({ noteId: e.id })), NoteClassified)`.
`.readModel()` names what the handler looks at, once per read model. An automation's column is
headed by a gear as well as its command, so it is the one slice that usually takes a name. Name it
for what it does.

The second form works through a list. From a hotel model:

```ts
m.slice("PaymentProcessor")
  .todoList(PaymentsToProcess, ProcessPayment, PaymentSucceeded),
```

`.todoList()` runs on the processor's own schedule, and the command's fields come from the row. No event and no service method starts it. The
projection that builds `PaymentsToProcess` marks the row done when it sees `PaymentSucceeded`.

### 7. Events from outside

```ts
// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external()

export const TaskScheduled = m
  .event({ listId: z.string(), itemId: z.string(), text: z.string() })
  .external(Calendar)

export const Integrations = [
  m.slice()
    .trigger(TaskScheduled, AddItem, ItemAdded(c => ({ title: c.text }))),
]
```

A system you do not own is a lane, declared once with `m.external()` and named by its export, like
a stream. An event joins it where the event is declared, with `.external()`. We translate its events
and never store them, so an event is in a stream or a system, not both. A system no event has joined
yet is drawn empty, and two modules may export one under the same name.

The model says that data arrives, not how. A call to such a system is our command followed by the
event that brings its data back, and that event's fields come from outside, so the command need
not carry them:

```ts
export const Shop = m.external()
export const CartUpdated = m.event({ added: z.array(Item), unavailable: z.array(Item) }).external(Shop)

m.slice().todoList(GroceriesToOrder, AddGroceriesToCart, CartUpdated)   // the call
m.slice().trigger(CartUpdated, RecordOrder, OrderUpdated)               // we keep what came back
```

### 8. Streams

A stream is a lane in the diagram, named by its export. An event joins it where it is declared. The
todo app keeps items and lists apart:

```ts
export const Items = m.stream()
export const Lists = m.stream()

export const ItemCompleted = m.event({ listId: z.string(), itemId: z.string() }).stream(Items)
export const ListDeleted = m.event({ listId: z.string() }).stream(Lists)
```

`.stream()` takes the stream, not its name, so a typo does not compile. A slice is drawn in the lane
of the events it records, and its command with them. Lanes come in the order the streams are
declared; one no event has joined yet is drawn empty. Two modules may export a stream under the same
name; the CLI merges them into one lane. A model that declares no stream has one lane, called
Events.

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
to do is listed above the picture. So the first thing to write is the events, each in its stream, and look.

## Validation

`tsc` checks each slice as you type. The CLI checks the whole model when it assembles, which every
command does first.

The compiler catches:

| Where | What |
|---|---|
| any reference | An unknown actor, event, command, read model or service cannot be written, because references are values, not strings. |
| the chain | Only a legal chain compiles; each start offers only its own steps. A slice missing part of its pattern is an error where it is written: `Expected 2 arguments, but got 1`, beside which the editor names the missing argument, such as `event`. |
| a function | Its argument is the slice's source: the command for a handler's event, the trigger event or the to-do row for an automation's command, the event in a projection. Its result must be fields of the target, with matching types. Its second argument holds only the helpers that apply: `generate` where a handler records an event, `count` in a projection. |
| a command's event | Every event field the command lacks must be set by the function, or marked `generate()`. The error names the fields. |
| an automation's command | Every command field the trigger, or the to-do row, lacks must be set by the function. The error names the fields. |
| `.service()` on a view | It names the method. |
| `.test()` | `when` is the slice's command. `then` is its events or its read model; `reject` replaces `then`, and a projection has none. Zod checks the values. |

Assembly catches the rest, and each error names the slice it found the problem in:

| What | Why the compiler cannot |
|---|---|
| A declaration used in a slice that no module exports, or one exported under two names | It has no name until it is exported. |
| Two modules exporting one name, such as `ListCreated` | Each module is compiled on its own. |
| A column no event of the read model's projections writes | The columns are filled across several events, in several slices. |
| An event that carries none of the read model's key columns | Declarations are anonymous, so two events with the same fields are one type. |
| An event nothing consumes: no `.trigger()`, no projection, no `given` | Same. |
| An event no slice records; a read model nothing reads or projects | Same. |
| A field with no value, in a model the compiler did not check | `em json` runs the model without `tsc`. |
| Two slices claiming one service method; a slice without a service claims none | A union of literal types dedupes rather than counts. |
| A declaration in no slice, or a slice in no chapter | Whether a value is used is not a type. |
| An event in both a stream and an external system | `.stream()` and `.external()` can be called on it in separate statements. |
| An event a command lists that no specification's `then` shows | Each `.test()` is checked on its own, not against the slice's other specifications. |

`event_model.py` then checks the emitted JSON for what neither can: event names in the past tense,
command names in the imperative, and example values that are not placeholders.

## Protobuf

`proto` writes one `.proto` file per service, at the path its package implies, ready for
`buf generate` with your own `buf.gen.yaml`. The output passes `buf lint` under `STANDARD`.

| Slice | Generates |
|---|---|
| state change | `rpc Command(CommandRequest) returns (CommandResponse)`. The request is the command's fields. The response is empty, because events are internal. |
| view | `rpc Method(MethodRequest) returns (MethodResponse)`. The request is the `.query()` fields. The response repeats each read model it shows. |
| automation, state view, or a slice without `.service()` | Nothing. They have no service method. |

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
