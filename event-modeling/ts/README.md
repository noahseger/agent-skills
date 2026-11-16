# event-modeling

Describe a system’s commands, events, and views in TypeScript. The `em` command draws a live diagram, checks the model, and exports JSON and protobuf service definitions. Use it to find missing data sources and inconsistent examples before implementation.

It runs wherever node 22.6 or later runs.

```ts
import { m, z } from "@noahseger/event-modeling"
```

## Vocabulary

| | | below |
|---|---|---|
| **event** | something that happened, in the past tense | `ListCreated` |
| **command** | something an actor wants to happen | `CreateList` |
| **view** | a table built from events | `TodoList` |
| **actor** | who acts: a person, a role, or a machine of ours | `User` |
| **external** | a system we do not own, whose events we translate and never store | `Calendar` |
| **service** | the API that exposes a slice's procedure | `TodoService` |
| **stream** | a lane of events in the diagram | `Lists` |
| **slice** | one column of the diagram | the "Create List" column |
| **chapter** | a run of slices under one heading | `ListManagement` |

## Naming

A slice starts with what starts it. `m.` names what you declare, and every call of a slice's chain
names the elements it takes, so both are nouns: `m.command`, `.command()`, `.event()`,
`.query()`. Only `m.generate()` is a verb, because it does something: it stands
for a value the handler makes.

Your own names follow the practice: events in the past tense (`NoteCreated`), commands in the
imperative (`CreateNote`), views as nouns (`Inbox`). Everything you declare, chapters
included, is named by its export.

A lane says whose it is and what it holds. Name a system after the system (`Calendar`) and a stream
after what we keep track of (`Connections`), never after the system it is about (`CalendarStream`).

## How it fits together

**Names come from exports.** Export a declaration and the CLI uses the binding's name:
`export const ListCreated = m.event(...)` is the event `ListCreated`. Names are CamelCase, and the
diagram shows them as words. Any declaration accepts `.note("...")`.

**Fields are [Zod](https://zod.dev) schemas.** Events, commands and views declare their fields
the same way. Zod types the example data in specifications and the generated messages.

**A slice is written in story order.** Each call is a step: what starts it, the views it reads, the
command, the events it records. Each call takes its declaration as `{ Name }`, so the compiler knows
its name: `.event({ ItemAdded })`. Fields flow by name from step to step. When the names differ, or
a value has to be set, the step's second argument is a mapping:
`.event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))`. Its argument holds each declaration
before the step by its name, with its fields as schemas, so `c.AddItem.text` is the `z.string()`
declared for `text`, and the editor refuses one that does not fit its target: a `z.string()` does
not fit a `z.uuid()`. A field that flows by name must fit too, and only one declaration before the step
may carry it; where two do, the mapping says which. A constant is `z.literal("open")`. A step that
lacks a field is an error on that step, worded as the fix:
`add title to a step before .event() or set it in the mapping`. The editor offers only the calls
that can come next.

## The slice patterns

| Pattern | Starts with | Chain | Meaning |
|---|---|---|---|
| state change | the command | `.command({ Command }).event({ Event })` | An actor issues a command and events are recorded. |
| state view | the view | `.view({ View }).event({ Event })` | Our events build a view, and an actor reads it. |
| automation | the trigger: an event of ours, or a view it polls | `.automation({ Event }).command({ Command }).event({ Event })` or `.automation({ View })…` | An event, or a row of work, causes a command. No actor is involved. |
| translation | the external event | `.translation({ ExternalEvent }).command({ Command }).event({ Event })` | An event from outside becomes an event of ours. No actor is involved. |

A slice is complete once it has its command and an event, or its view and an event. Before then it
compiles, is drawn as far as it goes, and what it lacks is left to do; `.test()` waits for its
events. `.event()` again adds an event the command can record. `.query()` reads a view, before the
events. `.request()` gives a state view its request fields, `.test()` adds a specification, and
`.chapter()` puts the slice in a chapter. A state change or state view also takes `.actor()`,
`.screen()` and `.service()`, and needs none of them. An automation or a translation takes
`.actor()` for the system actor that runs it. `.chapter()`, `.actor()`, `.screen()`, `.service()`
and `.note()` can come anywhere after the first step.

## Quickstart

### 1. See a diagram

The repository is public, so the worked example draws with no sign-in:

```bash
git clone https://github.com/noahseger/agent-skills.git
cd agent-skills/event-modeling/ts
npm ci && npm run build
npm run view -- examples/todo-app
```

It opens the browser. Click a card for its notes and specifications. Stop it with Ctrl-C.

### 2. Install

You need node 22.6 or later. The package is on GitHub Packages, which needs a token even to read.
Once per project, put this in `.npmrc` next to your `package.json`:

```ini
@noahseger:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then put a GitHub personal access token (classic) with the `read:packages` scope in the
`GITHUB_TOKEN` environment variable. The file names the variable, so it is safe to commit.

```bash
npm install @noahseger/event-modeling
npx em init model
npx em view model
```

If `npm install` answers `401` or `404`, the token is missing or lacks `read:packages`. `init`
writes `model/index.ts`, a `tsconfig.json` that lets node run the model with no build step, and a
`package.json` that marks the directory as ES modules. Leave `view` running in its own terminal: it
redraws on every save and lists above the picture what is left to do.

### 3. Write the model

Replace `model/index.ts` with the blocks below, in order. The model is a todo list app. Save after
each block and watch the diagram grow; until the last block, it lists what is left to do.

```ts
import { m, z } from "@noahseger/event-modeling"

export default m.model("Todo List Application")

export const User = m.actor()
export const TodoService = m.service("todo.v1")

export const Lists = m.stream()
export const Items = m.stream()

export const ListManagement = m.chapter()
export const Views = m.chapter()
```

`m.service()` takes the protobuf package. A stream is a lane of events and a chapter a heading on
the timeline; once a model declares a stream, every event must join one.

A state change slice: a user creates a list.

```ts
export const CreateList = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
export const ListCreated = m
  .event({ userId: z.string(), listId: z.string(), name: z.string() })
  .stream(Lists)

const groceries = ListCreated({ userId: "u-1", listId: "list-1", name: "Groceries" })

m.slice()
  .command({ CreateList })
  .event({ ListCreated })
  .chapter(ListManagement)
  .actor(User)
  .service(TodoService)
  .test("A user creates a list", {
    when: CreateList({ userId: "u-1", listId: "list-1", name: "Groceries" }),
    then: groceries,
  })
  .test("A second list with the same name is refused", {
    given: groceries,
    when: CreateList({ userId: "u-1", listId: "list-2", name: "Groceries" }),
    reject: "list name already exists",
  })
```

Every field of `ListCreated` has a namesake in `CreateList`, so it flows on its own. Called with
data, a declaration is an example; `groceries` is one, reused below. Each `.test()` is a
[specification](#specifications): `then` is what is recorded, or `reject` why the command is refused.

A user adds an item. The command says `text` and the event says `title`, so the event's step maps
the field that does not match:

```ts
export const AddItem = m.command({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
  text: z.string(),
})
export const ItemAdded = m
  .event({ userId: z.string(), listId: z.string(), itemId: z.string(), title: z.string() })
  .stream(Items)

const milk = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })

m.slice()
  .command({ AddItem })
  .event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))
  .chapter(ListManagement)
  .actor(User)
  .service(TodoService)
  .test("A user adds an item", {
    given: groceries,
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
    then: milk,
  })
```

A view is a table, and `.key()` names the columns that identify a row. A state view slice builds it
from events, and the user reads their lists in it:

```ts
export const TodoList = m
  .view({
    userId: z.string(),
    listId: z.string(),
    name: z.string(),
    itemCount: z.number().int(),
  })
  .key("userId", "listId")

m.slice()
  .view({ TodoList })
  .event({ ListCreated }, () => ({ itemCount: z.literal(0) }))
  .event({ ItemAdded }, (c) => ({ itemCount: m.generate(c.ItemAdded) }))
  .request({ userId: z.string() })
  .chapter(Views)
  .actor(User)
  .service(TodoService, "ListTodoLists")
  .test("Each item added counts", {
    given: [groceries, milk],
    when: { userId: "u-1" },
    then: TodoList({ userId: "u-1", listId: "list-1", name: "Groceries", itemCount: 1 }),
  })
  .test("A user sees only their own lists", {
    given: [groceries, ListCreated({ userId: "u-2", listId: "list-2", name: "Hardware" })],
    when: { userId: "u-1" },
    then: TodoList({ userId: "u-1", listId: "list-1", name: "Groceries", itemCount: 0 }),
  })
```

`ListCreated` fills `userId`, `listId` and `name`; the mapping sets `itemCount`. Each event builds
the view on its own, so a state view's mapping reads only its event. `m.generate(c.ItemAdded)` says
the count is made from the `ItemAdded` events seen for the row. An event finds its row by the key
columns, so each event a state view names must carry every one: `ItemAdded` carries `userId` for
that reason.

`.request()` declares the request. A state view has no command to name its method after, so
`.service()` names it.

### 4. Generate the API

The diagram now lists nothing left to do. Write the protobuf:

```bash
npx em proto model -o proto
```

It writes `proto/todo/v1/todo_service.proto`:

```proto
syntax = "proto3";

package todo.v1;

service TodoService {
  rpc CreateList(CreateListRequest) returns (CreateListResponse);
  rpc AddItem(AddItemRequest) returns (AddItemResponse);
  rpc ListTodoLists(ListTodoListsRequest) returns (ListTodoListsResponse);
}

message CreateListRequest {
  string user_id = 1;
  string list_id = 2;
  string name = 3;
}

message CreateListResponse {}

message AddItemRequest {
  string user_id = 1;
  string list_id = 2;
  string item_id = 3;
  string text = 4;
}

message AddItemResponse {}

message ListTodoListsRequest {
  string user_id = 1;
}

message TodoList {
  string user_id = 1;
  string list_id = 2;
  string name = 3;
  int32 item_count = 4;
}

message ListTodoListsResponse {
  repeated TodoList todo_list = 1;
}
```

`test/readme.test.ts` runs this quickstart, so it stays true. The full todo app, with automations
and more slices, is `examples/todo-app/`.

You do not have to finish first. `view` draws a model as far as it goes: an event in no slice yet
stands on its own in its lane, a slice in no chapter yet is drawn after the story, and what is left
to do is listed above the picture. So the first thing to write is the events, each in its stream.

## Writing a model

The model is a directory of TypeScript modules. Write it top to bottom as the story of the system,
declaring each thing where the story first needs it.

### Actors

`m.actor()` is a person. Pass `{ icon: "admin" }` for one with authority, like an arbiter, and
`{ icon: "system" }` for a machine of ours.

Automations, and state views no one sees, are drawn in the lane of the system actor that runs them.
A model need not declare one: they are then under the built-in System. Once it does, the first
system actor declared runs them all, and an automation's `.actor(Syncer)` names another.

### Fields and mappings

A field declared `.optional()` may go unfilled in a slice, as long as another slice fills it:

```ts
export const NoteShared = m.event({ noteId: z.uuid(), imageUri: z.string().optional() })

m.slice().command({ ShareText }).event({ NoteShared })    // ShareText has no imageUri
m.slice().command({ ShareImage }).event({ NoteShared })   // ShareImage carries it
```

An optional field no slice fills is left to do. The same holds for an automation's command. A
mapping has no default for a missing value: make the field optional instead.

A value the handler makes has no field to copy. Say what it is made from with `m.generate()`: fields
before its step. From nothing, it is an id or a clock. A specification may give it any value.

```ts
.command({ AddNote }).event({ NoteAdded }, (c) => ({ noteId: m.generate(), slug: m.generate(c.AddNote.title) }))
```

An automation's command is filled from what is before it, so a value generated there is left to do.

A mapping only copies, sets constants and says what a value is made from; it computes nothing. A
string built from a field, such as `` `${c.AddNote.title}!` ``, or arithmetic, such as
`c.SetTimer.minutes * 60`, is not a schema, so the editor refuses it. A schema changed by a Zod
method, such as `c.AddNote.title.toUpperCase()`, is not a source field: it is drawn as generated and
left to do, with the fix: `m.generate(c.AddNote.title)`.

The events of `.command({ AddItem }).event({ ItemAdded }).event({ ListFull })` are what the command
can produce, not a sequence; the diagram draws them side by side. Each specification's `then` says
which happened. So an event of ours does not pass its fields to the next.

### Queries

`.query({ View }, filter)` reads rows of a view. The filter is always stated: a column, which takes
the value of the field of the same name before the step, or a mapping from those fields to columns.

```ts
.command({ RecordChange }).query({ Pages }, "pageId").event({ ChangeRecorded })
.automation({ ProductRepriced }).query({ CartsWithProducts }, (c) => ({ productId: c.ProductRepriced.changedProductId }))
```

The row joins the mapping's argument, as `c.Pages`, and its columns flow on by name:
`ChangeRecorded.noteId` comes from the `Pages` row. A filter column holds the value of its namesake
before the step, so the two are one source. Any other field the row shares with a step before it
flows from neither, and the mapping says which. A view queried again replaces its earlier row.

A filter that names every key column picks one row. One that does not picks many, which only an
automation reads, before its command: it issues the command once per row. A view with no `.key()`
always gives many.

A command whose row is missing is refused, and an automation that finds no row issues nothing; a
specification has to agree, as [Specifications](#specifications) says.

### Screens, services and headings

`.actor()` takes any number of actors, and each is drawn with a screen. Without one the slice has
no screen; without `.service()` it has no service method. When the handler reads a view to
decide, query it: `.command({ FileNote }).query({ Inbox }, "noteId").event({ NoteFiled })`.

The screen shows the command's form or the view's table, titled with the service method. To
say which screen the actor is on, declare it once, `export const LockScreen = m.screen()`, and name
it: `.screen(LockScreen)`. The card is then titled with the screen's name, and several slices can
share one. A screen is seen by the slice's actors, so a slice with a screen and no actor is left to
do, and so is a screen no slice names; neither is drawn.

A slice's column is headed by its command, or a state view's by its view. Pass a name,
`m.slice("StartList")`, only when that heading would say the wrong thing. The service method is
also named after the command; to use another method name, pass it:
`.service(TodoService, "StartList")`.

### Views

The same events can build a second table for a different question. A state view shows one view; to
show two side by side, write two state views that name one screen. Without `.request()` its request
is empty.

A view has one state view slice, so a later chapter can extend a table next to the event that
changes it. Every `m.slice().view()` of it adds its events, mappings and specifications to that
slice, which is drawn where the first one is: in its chapter, seen by its actors on its screen,
served by its method. A later call that names another of those is left to do.

```ts
m.slice().view({ Inbox }).event({ NoteCreated }, () => ({ status: z.literal("inbox") })).chapter(Capture)
// further down the file: adds NoteFiled to the Inbox slice in Capture
m.slice().view({ Inbox }).event({ NoteFiled }, () => ({ status: z.literal("filed") })).chapter(Capture)
```

A view an automation polls, or a slice queries, is built by a state view like any other, which then
needs no screen, actor or service.

### Specifications

A specification is a Given, When, Then example attached to a slice with `.test()`. Calling a
declaration with data builds an example of it, and Zod checks the values: one it refuses is left to
do, with where in the example. `given` and `then` accept one example or a list. A state change's specification has `then`, the events recorded, or `reject`,
why the command is refused; never both. A state view's has `given`, the events that build the rows;
`when`, the values its request is asked with, only once it has a `.request()`; and `then`, the rows
the screen shows. It has no `reject`, because a view cannot reject an event.

Every event a slice handles or produces is in one of its specifications: each event a command records
in some `then`, external events included, and each event a state view names, or an automation's
trigger event, in some `given`. An automation a view starts has no trigger event, so it needs none.
Every state view has a specification. Until then the model is unfinished. A `given` may also hold
other events, the history that shaped the state.

A specification must agree with its slice's wiring. A value copied or mapped from the command, the
trigger event, the polled row, a queried row or a given event must equal the value there; a
constant the mapping sets, the constant. A generated field, and any field of an external event or
kept from one, may be anything. The polled row is the one `given` builds whose key columns hold
what the command copied from them. A queried row is one `given` builds that the filter picks; of
several, the one `when` agrees with. When `given` builds none, an automation issues nothing, so its
specification is wrong, and a command is refused, so its specification has `reject`. A
disagreement names the spec, the field and both values.

A value the specification does not care about, such as an id, is `m.generate()`, at any depth, such
as a field of an item in a list. Each one is a
value of its field's type that no other generated value in the specification has, the same on every
run, so one used in both `given` and `then` agrees, and two different ones do not. To name one, write
the specification as a function:

```ts
.test("A captured note shows in the inbox", () => {
  const noteId = m.generate()
  return {
    given: NoteCaptured({ noteId, text: "buy milk" }),
    then: Inbox({ noteId, text: "buy milk" }),
  }
})
```

A state view's `given` builds the rows through its events. Each row in
`then` must be one of them, matched by its key columns, with the values they have. A row built and
left out of `then` must be one the request excludes: a request field filters by equality with the
column of the same name. A request field with no such column, such as a search's `text`, excludes
nothing, so its specification lists every row built.

### Automations

An automation issues a command with no actor. An event of ours starts it as it happens; a view
starts it once per row. From the eventsourcing book's cart:

```ts
// A price change archives the product from every cart that holds it.
m.slice("ArchiveItemScheduler")
  .automation({ PriceChanged })
  .query({ CartsWithProducts }, "productId")
  .command({ ArchiveItem })
  .query({ CartsWithProducts }, (c) => ({
    aggregateId: c.ArchiveItem.aggregateId,
    productId: c.ArchiveItem.productId,
  }))
  .event({ ItemArchived })
```

The processor hears `PriceChanged`, queries the carts that hold the product, and issues one
`ArchiveItem` per row, its `aggregateId` from the row and its `productId` from the event. The
handler sees only the command: from `.command()` on, the mapping's argument holds the command and
the rows queried after it. So the handler reads the one row its command is for, and
`ItemArchived.itemId` flows from that row. An automation's column is headed by a gear as well as
its command, so it is the one slice that usually takes a name. Name it for what it does.

The second form polls a view of the work to do. From a hotel model:

```ts
m.slice("PaymentProcessor").automation({ PaymentsToProcess }).command({ ProcessPayment }).event({ PaymentSucceeded })
```

A view as the trigger runs on the processor's own schedule, and the command's fields come from the
row. No event and no service method starts it. The state view that builds `PaymentsToProcess` marks
the row done when it sees `PaymentSucceeded`.

### Events from outside

```ts
// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external()

export const TaskScheduled = m
  .event({ userId: z.string(), listId: z.string(), itemId: z.string(), text: z.string() })
  .external(Calendar)

m.slice()
  .translation({ TaskScheduled })
  .command({ AddItem })
  .event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))
  .chapter(Integrations)
```

A system you do not own is a lane, declared once with `m.external()` and named by its export, like
a stream. An event joins it where the event is declared, with `.external()`. We translate its
events and never store them, so an event is in a stream or a system, not both. A system no event
has joined yet is drawn empty, and two modules may export one under the same name.

An external event builds no view: it isn't stored, so the view would be empty after a
replay. Translate it into an event of ours with `.translation()`, as above, and project that.
`.translation()` takes only an external event, and `.automation()` refuses one; fields flow and
map as in an automation an event starts, but it reads one row at most. An external event a slice of ours produces is published
and needs no translation; any other no `.translation()` reads is left to do, even if a
specification's `given` has it. Translation is for an event that arrives on its own.

The model says that data arrives, not how. A call to such a system is our command and the outside
event the call gets back, in one slice. That event's fields come from outside, so the command need
not carry them, and an event of ours after it keeps them:

```ts
export const Shop = m.external()
export const CartUpdated = m.event({ added: z.array(Item), unavailable: z.array(Item) }).external(Shop)

m.slice()
  .automation({ GroceriesToOrder })
  .command({ AddGroceriesToCart })
  .event({ CartUpdated })
  .event({ OrderUpdated }, (c) => ({ missing: c.CartUpdated.unavailable }))
```

The outside event joins the mapping's argument, as `c.CartUpdated`, and its fields flow on by name.
So it comes before the event that keeps it. A field the command carries too flows from neither, and
the mapping says which.

### Streams

A stream is a lane in the diagram, declared once with `m.stream()` and named by its export. An
event joins it where it is declared, with `.stream()`. Once a model declares a stream, every event
must join one; an external event joins its system instead. A model that declares no stream has one
lane, called Events.

`.stream()` takes the stream, not its name, so a typo does not compile. A slice is drawn in the lane
of the events it records, and its command with them. Lanes come in the order the streams are
declared; one no event has joined yet is drawn empty. Two modules may export a stream under the
same name; the CLI merges them into one lane.

### Chapters and order

The model, `export default m.model("Name", { description })`, lists nothing. The CLI finds every
declaration, and every slice, by walking the directory.

A chapter is a heading on the timeline, declared once with `m.chapter()` and named by its export,
like a stream. A slice joins it with `.chapter()`, complete or not, and joins at most
one. `.chapter()` takes the chapter, not its name, so a typo does not compile. A chapter no slice
has joined yet is drawn as a title with no columns, and is left to do. A slice in no chapter is
drawn after the story under "Not in a chapter yet", and is left to do until it joins one. Two
modules may export a chapter under the same name; the CLI merges them into one.

Chapters come in the order they are declared, and a chapter's slices in the order they are written.
In one file that is top to bottom. Across files it is the order node runs them: the CLI imports the
model's files one at a time, by path, and a module runs after the modules it imports. So a file that
imports an earlier chapter's file comes after it.

## Validation

`tsc` checks each slice as you type. The CLI checks the whole model when it assembles, which every
command does first.

The compiler catches:

| Where | What |
|---|---|
| any reference | An unknown actor, event, command, view, screen or service cannot be written, because references are values, not strings. |
| the chain | Only a legal chain compiles; each step offers only what can come next. `.test()` refuses a slice with no event yet and says what to add, such as `add .event() before .test()`. |
| a step's declaration | It is `{ Name }`. A bare declaration has no name the compiler knows, and is refused; so is an object of two. |
| a mapping | Its argument holds each declaration before its step by name, with its fields as schemas: what starts the slice, the rows it queries, the command and the outside events it gets back; in a state view, the event. Its result must be fields of the target, each a field that fits it, a `z.literal()` or `m.generate()`. A string format, such as `z.uuid()`, takes only that format. |
| a field that flows by name | It must fit its target as a mapped one does, and only one declaration before the step may carry it; a filter column and its namesake are one. The error names the field to set in the mapping, and where two carry it, both. |
| a step's command or event | Every field no step before it carries must be set by its mapping, or marked `m.generate()`, unless it is optional. The error names the fields. |
| an automation's command | The handler sees only the command: from `.command()` on, what starts the automation and the rows queried before it no longer flow. |
| `.query()` | The filter names columns of the view, each from a field before the step that fits it. A filter that does not name every key column picks many rows, which only an automation reads, before its command. |
| a state view's event | An external event is refused, because it isn't stored. The error says to translate it first. |
| what starts an automation or a translation | `.automation()` refuses an external event, and the error says to use `.translation()`; `.translation()` takes nothing else. |
| `.key()` | It names columns of the view, so `.query()` can count the rows a filter picks. |
| `.service()` on a state view | It names the method. |
| `.test()` | `when` is the slice's command, or a state view's request values. `then` is its events, or the rows of the view a state view shows; `reject` replaces `then`, and a state view has none. Zod checks the values. |

Assembly catches the rest, and each error names the slice it found the problem in:

| What | Why the compiler cannot |
|---|---|
| A declaration used in a slice that no module exports, or one exported under two names | It has no name until it is exported. |
| A call that renames its declaration, as `{ Note: CaptureNote }` | The declaration's type carries its fields, not its name. |
| Two modules exporting one name, such as `ListCreated` | Each module is compiled on its own. |
| A column no event of the view's `m.slice().view()` calls writes | The calls can be in several modules. |
| An optional field no slice fills | Same. |
| A slice with no command, or no event | An incomplete slice compiles, so it can be drawn while it is written. |
| A command field no event of its slice records: none carries it by name, maps it or generates from it, none is external, and no later query filters by it | Each event's mapping is checked on its own, not against the slice's other events. |
| A state view's event that lacks one of the view's key columns | Declarations are anonymous, so two events with the same fields are one type. |
| An event nothing consumes: no `.automation()`, no state view, no `given`; for an external event no slice produces, no `.translation()` | Same. |
| An event no slice records; a view nothing reads or builds | Same. |
| A field with no value, in a model the compiler did not check | `em json` runs the model without `tsc`. |
| Two slices claiming one service method; a slice without a service claims none | A union of literal types dedupes rather than counts. |
| A declaration in no slice, a slice in no chapter, or a chapter no slice joins | Whether a value is used is not a type. |
| A slice joining two chapters | `.chapter()` can be called again further down the chain. |
| A view built from an external event | `em json` runs the model without `tsc`. |
| An event in both a stream and an external system | `.stream()` and `.external()` can be called on it in separate statements. |
| An event of ours in no stream, once the model declares one | Whether a value is used is not a type. |
| A slice's event, or a state view, that no specification covers, as [Specifications](#specifications) says | Each `.test()` is checked on its own, not against the slice's other specifications. |
| A specification value that is not what flows in: from `when`, the trigger in `given`, or the events that build the row or a queried row | Example values are data, not types. |
| A queried row `given` does not build, in a specification that does not `reject`; in an automation, before its command, any specification | Same. |
| A state view's row that `given` does not build, or a built row `then` leaves out and the request does not exclude | Same. |
| A mapping's result that is a schema but no source field, such as `c.AddNote.title.toUpperCase()` | A Zod method returns a schema of the same type. |
| A mapping that throws, such as `m.generate()` given something other than a field: its slice is drawn without the mapping | The mapping runs when the model does. |
| `m.generate()` in an automation's command | `m.generate()` is one function, wherever it is called. |

Naming is yours: the conventions above are not checked.

## The JSON

`em json` prints the model as JSON that validates against `schema/eventmodeling.schema.json`, the
[event-modeling-spec](https://github.com/dilgerma/event-modeling-spec)'s schema with its own
`fields`, `key` and `mappings`. `test/todo-app.json` is the todo example's.

| Ours | The JSON's |
|---|---|
| a slice | a `Slice`, in story order, with `index`. A state change is `STATE_CHANGE`; an `.automation()` is `AUTOMATION`; a `.translation()` is `TRANSLATION`; a state view is `STATE_VIEW`, the spec's pattern of events in, view out, to the screen |
| a chapter | the slice's `context`. A slice in no chapter has none |
| a command, event, view | an `Element` of type `COMMAND`, `EVENT`, `READMODEL`, in each slice that uses it, with `fields` and `dependencies` along the slice's arrows |
| an automation's gear | an `AUTOMATION` element in `processors`, named after the slice: what starts it points at it, it points at the command |
| a screen | one `SCREEN` per slice with an actor: the screen's name, or the method's. Its fields are the command's, or a state view's `.request()` |
| `.service()` | `service` and `apiEndpoint` on the command, or on the view a state view shows |
| a stream | each event's `aggregate`, and the slice's `aggregates`: the streams it records into. A slice that records nothing names none |
| an actor | the slice's `actors`. An admin is tagged `admin`, a machine of ours `system`. An automation's, or a state view's no one sees, is the system actor that runs it |
| fields | the element's `fields`: Zod's `z.toJSONSchema()` of them, less `$schema`, a `pattern` beside a `format`, and an integer's safe-integer bounds. `.describe()` is a field's `description` |
| `.key()` | the element's `key` |
| a mapping | the slice's `mappings`, by the element of the step it is on, then by field: the source field's name, `= ` and a JSON value, or `generate(<inputs>)`. A field from a queried row, by name too, is `View(filter columns).column`, as `CartsWithProducts(productId).aggregateId`; of a view queried twice, the row before the step. A state view's are on its events, and set the view's columns |
| a note | an element's `description` |
| a specification | a `Specification`: `given`, `when` and `then` steps, each an example in `examples`. A `reject` is a `SPEC_ERROR` step titled with the reason. A state view's request values are a `SPEC_COMMAND` step titled with its screen, the request it is asked from, as a command is sent from one |

The schema allows no property it does not name. The rest is said with properties it has, as
follows; a model written by hand can do the same, and the viewer draws it.

| What | Where |
|---|---|
| a system we do not own | its events have `context: "EXTERNAL"`, and `service` names the system. No `aggregate`: we never store them |
| a call to one | the external event among the command's outbound events |
| what an event of ours keeps from the outside event a call gets back | the external event pointing at it |
| outcomes that are alternatives | no field: a command's outbound events are what it can record, and each specification's `then` says which it did |
| what a slice queries | the view pointing at the command; one pointing at the processor is the view the automation polls |
| a slice's note | a `storylines` entry titled with it, with no elements |

The top level holds only `slices`, so the rest travels beside the JSON, only to the viewer: the
model's name and description; the chapters, with their notes, and the streams, in the order
declared; the actors no slice names and every external system; and, while the model is unfinished,
the declarations in no slice and what is left to do. That is what `em json --partial` prints. Notes
on actors, services and external systems have no place in either.

## Protobuf

`proto` writes one `.proto` file per service, at the path its package implies, ready for
`buf generate` with your own `buf.gen.yaml`. The output passes `buf lint` under `STANDARD`.

A service's file is written once its own slices are finished: the state changes and state views with
`.service()` naming it, each with its command, views and request fields. What is left to do
elsewhere does not hold it back; a service with its own left to do is skipped, its to-dos printed,
and `proto` exits 1.

| Slice | Generates |
|---|---|
| state change | `rpc Command(CommandRequest) returns (CommandResponse)`. The request is the command's fields. The response is empty, because events are internal. |
| state view | `rpc Method(MethodRequest) returns (MethodResponse)`. The request is the `.request()` fields. The response returns one row when the request names every key column; otherwise, a list. |
| automation, or a slice without `.service()` | Nothing. They have no service method. |

Every command and view becomes a `message`. Field numbers follow declaration order, so
appending a field is compatible and reordering one is not; `buf breaking` reports which you did.
[Step 4 of the quickstart](#4-generate-the-api) shows a whole file.

| Zod | proto |
|---|---|
| `z.string()`, `z.enum([...])` | `string` |
| `z.number()` | `double` |
| `z.number().int()` | `int32` |
| `z.boolean()` | `bool` |
| `z.array(T)` | `repeated T` |
| `z.object({...})` | a nested message |
| `z.record(z.string(), T)` | `map<string, T>`, never `optional` |
| `.optional()` | `optional` |
| `.describe()` | a `//` comment above the field |

Any other Zod type is an error that names the declaration and the field. The todo example's output
is `examples/proto`.

## CLI

```bash
npx em init   model/                 # scaffold a model directory
npx em view   model/                 # live diagram; runs until Ctrl-C
npx em view   model.json             # the same for a model written as spec JSON
npx em export model/ -o model.html   # one self-contained page, for sharing; takes model.json too
npx em json   model/                 # the model as event-modeling-spec JSON
npx em json   model/ --partial       # what the viewer draws of an unfinished model
npx em proto  model/ -o proto        # one .proto per service
```

Every command also accepts a single self-contained file.

`json` assembles the model and fails when assembly reports errors. With `--partial` it goes on past dead ends
and prints what the viewer reads: the spec JSON as `model`, beside it what the spec has no place
for, and the dead ends as `warnings`. `view` and `export` assemble that way.

`view` type-checks the model on every save, with the `tsconfig.json` that `init` wrote. It logs
each compiler error as `file:line`, with what assembly left to do, in the terminal and above the
picture. Names used above their declarations are one line per file, listing what to move up.

`view` and `export` also draw a model written as spec JSON, by hand or extracted from a running
system. It is drawn as far as it goes, and each place it breaks the schema is listed as left to do,
as `model.json/slices/0/sliceType must be equal to one of the allowed values ...`. The file has only
what the spec has, so lanes and chapters come in the order its slices first name them, and a screen
no actor is said to see is a User's.

Node runs the TypeScript directly with `--experimental-strip-types`. The package carries `zod` and
exports it as `z`, so the model and the package read schemas with one copy. It carries `typescript`
too, so the model needs no other dependency.

## Developing

```bash
git clone https://github.com/noahseger/agent-skills.git
cd agent-skills/event-modeling/ts
npm ci
npm test
```

`npm test` type-checks, lints, builds the viewer and the package, runs the node tests, and lints the
generated proto.

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

From there the quickstart applies from `npx em view model`. `npm pack` writes the tarball a release
publishes, and the tests install it.

To release, raise `version` in `package.json`, commit, and push a tag with the same number:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The `publish` workflow builds the package and publishes it to GitHub Packages with the
repository's own token. It refuses a tag that does not match `package.json`.
