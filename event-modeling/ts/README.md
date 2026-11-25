# event-modeling

Describe a system’s commands, events, and views in TypeScript. The `em` command draws a live diagram, checks the model, and exports JSON and protobuf service definitions. Use it to find missing data sources and invalid examples before implementation.

It runs wherever node 22.6 or later runs.

```ts
import { d, m, t } from "@noahseger/event-modeling"
```

## Vocabulary

| | | below |
|---|---|---|
| **event** | something that happened, in the past tense | `ListCreated` |
| **command** | something an actor wants to happen | `CreateList` |
| **view** | a table built from events | `TodoList` |
| **actor** | who acts: a person, a role, or a machine of ours | `User` |
| **External System** | a system we do not own, whose events we translate and never store | `Calendar` |
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
imperative (`CreateNote`), views as nouns (`Inbox`). Everything you declare, chapters included,
takes its name from the string you declare it with.

A lane says whose it is and what it holds. Name an External System after the system (`Calendar`)
and a stream after what we keep track of (`Connections`), never after the system it is about
(`CalendarStream`).

## How it fits together

**A name is a string, and `d.Name` is its use.** `m.event("ListCreated", { … })` declares the
event `ListCreated`, and everything else names it as `d.ListCreated`: a slice's steps, its examples,
the lane an event joins. You export and import nothing, and a use may come before its declaration,
in any file. [Names](#names) says how the editor knows them. Names are CamelCase, and the diagram
shows them as words.

**A note is a sticky everyone sees.** `.note(text, kind)` on a declaration sticks one beside its
card, on a slice beside the slice, and on a chapter above its band: red for `"critical"`, amber
for `"question"`, neutral for `"info"`, the default; its kind's icon (⚠ ? ⓘ) starts its text. It
stands level with what it is about, so it carries no header; hover it for that name. A second
stacks under the first, or beside it above a chapter.

```ts
m.command("DeleteItem", { listId: t.string(), itemId: t.string() })
  .note("No userId: anyone can delete any item.", "critical")
```

**`t` builds fields.** Events, commands and views declare their fields the same way, from
a closed set, so every field has a JSON Schema and a protobuf type; [Fields](#fields) lists them.
They type the example data in specifications and the generated messages.

**Write a slice in story order.** Each call is a step: what starts it, the views it reads, the
command, the events it records. Each call takes its declaration as `d.Name`: `.event(d.ItemAdded)`.
Fields flow by name from step to step. When the names differ, or
the step sets a value, its second argument is a mapping:
`.event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))`. Its argument holds each declaration
before the step by its name, with its fields, so `c.AddItem.text` is the `t.string()`
declared for `text`, and the editor refuses one that does not fit its target: a `t.string()` does
not fit a `t.uuid()`. A field that flows by name must fit too, and only one declaration before the step
may carry it; where two do, the mapping says which. A constant is `t.literal("open")`, or
`t.literal([])` for the empty list. A step that lacks a field is an error on that step, worded as
the fix: `ItemAdded.title: no source. Add title to a step before .event(), or set it in the mapping.` The editor offers only the calls
that can come next.

## The slice patterns

| Pattern | Starts with | Chain | Meaning |
|---|---|---|---|
| state change | the command | `.command(d.Command).event(d.Event)` | An actor issues a command, which records events. |
| state view | the view | `.view(d.View).event(d.Event)` | Our events build a view, and an actor reads it. |
| automation | the trigger: an event of ours, or a view it polls | `.automation(d.Event).command(d.Command).event(d.Event)` or `.automation(d.View)…` | An event, or a row of work, causes a command. No actor takes part. |
| translation | the external event | `.translation(d.ExternalEvent).command(d.Command).event(d.Event)` | An external event becomes an event of ours. No actor takes part. |

A slice is complete once it has its command and an event, or its view and an event. Before then it
compiles, the diagram draws it as far as it goes, and what it lacks is a warning; `.spec()` waits for its
events. `.event()` again adds an event the command can record. `.query()` reads a view, before the
events. `.context()` gives a state view the fields each read brings, `.spec()` adds a specification,
and `.chapter()` puts the slice in a chapter. A state change or state view also takes `.actor()`,
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
writes `model/index.ts`; a `tsconfig.json` that lets node run the model with no build step and
type-checks the directory, `generated/` included; `generated/d.d.ts`, which types `d`; and a
`package.json` that marks the directory as ES modules. Leave `view` running in its own terminal: on
every save it rewrites `generated/d.d.ts`, redraws, and logs its errors, then its warnings. The
picture marks a slice with an error with a red dot and an unfinished one with a yellow dot.

### 3. Write the model

Replace `model/index.ts` with the blocks below, in order. The model is a todo list app. Save after
each block and watch the diagram grow; until the last block, it marks what is left to do.

```ts
import { d, m, t } from "@noahseger/event-modeling"

export default m.model("Todo List Application")

m.actor("User")
m.service("TodoService", "todo.v1")

m.stream("Lists")
m.stream("Items")

m.chapter("ListManagement", 1)
m.chapter("Views", 2)
```

`m.service()` takes its name and its protobuf package. A stream is a lane of events and a chapter a
heading on the timeline; once a model declares a stream, every event must join one.

A state change slice: a user creates a list.

```ts
m.command("CreateList", { userId: t.string(), listId: t.string(), name: t.string() })
m.event("ListCreated", { userId: t.string(), listId: t.string(), name: t.string() }).stream(d.Lists)

const groceries = d.ListCreated({ userId: "u-1", listId: "list-1", name: "Groceries" })

m.slice()
  .command(d.CreateList)
  .event(d.ListCreated)
  .chapter(d.ListManagement)
  .actor(d.User)
  .service(d.TodoService)
  .spec("A user creates a list", {
    when: d.CreateList({ userId: "u-1", listId: "list-1", name: "Groceries" }),
    then: groceries,
  })
  .spec("A second list with the same name is refused", {
    given: groceries,
    when: d.CreateList({ userId: "u-1", listId: "list-2", name: "Groceries" }),
    reject: "list name already exists",
  })
```

Every field of `ListCreated` has a namesake in `CreateList`, so it flows on its own. Called with
data, `d.ListCreated` is an example; `groceries` is one, reused below. Each `.spec()` is a
[specification](#specifications): `then` is what the command records, or `reject` why the handler refuses it.

A user adds an item. The command says `text` and the event says `title`, so the event's step maps
the field that does not match:

```ts
m.command("AddItem", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  text: t.string(),
})
m.event("ItemAdded", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  title: t.string(),
}).stream(d.Items)

const milk = d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })

m.slice()
  .command(d.AddItem)
  .event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
  .chapter(d.ListManagement)
  .actor(d.User)
  .service(d.TodoService)
  .spec("A user adds an item", {
    given: groceries,
    when: d.AddItem({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
    then: milk,
  })
```

A view is a table, and `.key()` marks a key column: you look up rows by their key columns. A state
view slice builds it from events, and the user reads their lists in it:

```ts
m.view("TodoList", {
  userId: t.string().key(),
  listId: t.string().key(),
  name: t.string(),
  itemCount: t.int(),
})

m.slice()
  .view(d.TodoList)
  .event(d.ListCreated, () => ({ itemCount: t.literal(0) }))
  .event(d.ItemAdded, (c) => ({ itemCount: m.generate(c.ItemAdded) }))
  .context({ userId: t.string() })
  .chapter(d.Views)
  .actor(d.User)
  .service(d.TodoService, "ListTodoLists")
  .spec("Each item added counts", {
    given: [groceries, milk],
    when: { userId: "u-1" },
    then: d.TodoList({ userId: "u-1", listId: "list-1", name: "Groceries", itemCount: 1 }),
  })
  .spec("A user sees only their own lists", {
    given: [groceries, d.ListCreated({ userId: "u-2", listId: "list-2", name: "Hardware" })],
    when: { userId: "u-1" },
    then: d.TodoList({ userId: "u-1", listId: "list-1", name: "Groceries", itemCount: 0 }),
  })
```

`ListCreated` fills `userId`, `listId` and `name`; the mapping sets `itemCount`. Each event builds
the view on its own, so a state view's mapping reads only its event. `m.generate(c.ItemAdded)` says
the handler makes the count from the `ItemAdded` events it sees for the row. An event finds its row by the key
columns, so each event a state view names must carry every one: `ItemAdded` carries `userId` for
that reason.

`.context()` fields are the context each read brings, from a request, a token or a session,
and filter the view by equality on columns of the same name. A state view has no command to name
its method after, so `.service()` names it.

### 4. Generate the API

The diagram now marks nothing left to do. Write the protobuf:

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

You do not have to finish first. `view` draws a model as far as it goes: an event in no slice
stands on its own in its lane, where you declare it, with a warning that nothing records it yet,
and `view` marks what is left to do on the slice it belongs to. So write the events first, each in its stream, in the order they happen.

## Writing a model

The model is a directory of TypeScript modules. Write it top to bottom as the story of the system,
declaring each thing where the story first needs it.

### Names

```ts
m.command("ArchiveItem", { aggregateId: t.uuid(), productId: t.uuid() })
```

A declaration is a call with its name, and `d.ArchiveItem` is every use of it. `em types` writes
`generated/d.d.ts` in the model, which tells the editor what each name is, so it checks and
completes `d`, and a declaration map, so go-to-definition and rename on `d.ArchiveItem` reach the
string. `em view` rewrites both on every save. They are generated, so never edit them, and
committed, so CI type-checks a fresh clone without running `em`; run `em types model --check`
there: it exits 1 when they are out of date. They stay beside the model, in `generated/`, so the
`tsconfig.json`'s `include` takes them in and `d` is typed with no extra configuration.

A name nothing declares is a compiler error, `Property 'ArchivItem' does not exist on type
'Registry'`, and a step refuses a declaration of another kind. Two declarations
with the same fields are still two: `d.ArchiveCart` is not `d.ArchiveItem`. Declaring a name twice is
an error; a stream, an External System or a chapter is one by name, so two modules may each
declare it.

One tsconfig is one model: `d` holds every name in the files it type-checks, so a second model there
would mix its names in. The tsconfig `em init` writes covers its own directory.

### Actors

`m.actor("User")` is a person. Pass `{ icon: "admin" }` for one with authority,
and `{ icon: "system" }` for a machine of ours.

The diagram draws automations, and state views no one sees, in the lane of the system actor that
runs them. A model need not declare one: the built-in System then runs them. Once it does, the first
system actor it declares runs them all, and an automation's `.actor(d.Syncer)` names another.

### Fields

| `t` | JSON Schema | proto |
|---|---|---|
| `t.string()` | `string` | `string` |
| `t.uuid()`, `t.email()`, `t.url()`, `t.date()` | `string` with that `format` | `string` |
| `t.datetime()` | `string`, `date-time` | `google.protobuf.Timestamp` |
| `t.duration()` | `string`, `duration` | `google.protobuf.Duration` |
| `t.number()` | `number` | `double` |
| `t.int()` | `integer` | `int32` |
| `t.boolean()` | `boolean` | `bool` |
| `t.enum(["a", "b"])` | `string`, `enum` | `string` |
| `t.literal("a")` | its value's type, `const` | its value's type |
| `t.array(T)`, `t.array({ ... })` | `array` | `repeated T`, or of a nested message |
| `t.object({ ... })` | `object` | a nested message |
| `t.record(T)` | `object` keyed by string | `map<string, T>`, never `optional` |
| `t.oneOf({ win: T, draw: U })` | `oneOf`, one case as `{ "win": value }` | a `oneof` |
| `.optional()` | left out of `required` | `optional` |
| `.describe("...")` | `description` | a `//` comment above the field |

Dates, times and durations are ISO strings: `2026-01-31`, `2026-01-31T09:00:00Z`, `PT30S`. A field
has no other method: what a field computes, refines or defaults to is the handler's, not the model's.

Every event carries `timestamp`, a `t.datetime()`: the UTC moment it was recorded. Recording sets
it, so you don't declare one, and declaring a field named `timestamp` on an event is a compiler
error. An example may set it when the time matters. A business time, when a fact became true, such
as a payment's `paidAt` from the bank, is an ordinary declared field. The JSON lists `timestamp` on
every event; the diagram shows it only on an event whose `timestamp` a mapping reads.

### Mappings

A field declared `.optional()` may go unfilled in a slice, as long as another slice fills it:

```ts
m.event("NoteShared", { noteId: t.uuid(), imageUri: t.string().optional() })

m.slice().command(d.ShareText).event(d.NoteShared) // ShareText has no imageUri
m.slice().command(d.ShareImage).event(d.NoteShared) // ShareImage carries it
```

An optional field no slice fills has no source, an error. The same holds for an automation's command. A
mapping has no default for a missing value: make the field optional instead.

A value the handler makes has no field to copy. Say what the handler makes it from with
`m.generate()`: fields before its step. From nothing, it is an id or a clock. A specification may give it any value.

```ts
.command(d.AddNote).event(d.NoteAdded, (c) => ({ noteId: m.generate(), slug: m.generate(c.AddNote.title) }))
```

What comes before an automation's command fills it, so generating a value there is an error.

A mapping reads an event's `timestamp` like any of its fields, so a view records when something
happened without the event declaring it: `.view(d.Inbox).event(d.NoteCaptured, (c) => ({ capturedAt: c.NoteCaptured.timestamp }))`.

A mapping only copies, sets constants and says what the handler makes a value from; it computes nothing. A
string built from a field, such as `` `${c.AddNote.title}!` ``, or arithmetic, such as
`c.SetTimer.minutes * 60`, is not a field, so the editor refuses it. A field changed by a method,
such as `c.AddNote.title.describe("loud")`, is not a source field: the diagram draws it as generated, and it is
an error, with the fix: `m.generate(c.AddNote.title)`.

The events of `.command(d.AddItem).event(d.ItemAdded).event(d.ListFull)` are what the command
can produce, not a sequence; the diagram draws them side by side. Each specification's `then` says
which happened. So an event of ours does not pass its fields to the next.

### Queries

`.query(d.View, filter)` reads rows of a view. The filter is a column, which takes the value of the
field of the same name before the step, or a mapping from those fields to columns. A mapping that
names no column, `() => ({})`, reads every row. Only a view with no key column, which has one row,
takes no filter.

```ts
.command(d.RecordChange).query(d.Pages, "pageId").event(d.ChangeRecorded)
.automation(d.ProductRepriced).query(d.CartsWithProducts, (c) => ({ productId: c.ProductRepriced.changedProductId }))
```

The row joins the mapping's argument, as `c.Pages`, and its columns flow on by name:
`ChangeRecorded.noteId` comes from the `Pages` row. A filter column holds the value of its namesake
before the step, so the two are one source. Any other field the row shares with a step before it
flows from neither, and the mapping says which. Querying a view again replaces its earlier row.

A mapping that returns a whole declaration takes every field it carries; spread it to set the rest:

```ts
.event(d.ChangeRecorded, (c) => c.RecordChange)
.event(d.ChangeRecorded, (c) => ({ ...c.RecordChange, noteId: c.Pages.noteId }))
```

A filter that names every key column of a view that is not a list picks one row, and so does any
filter, or none, of a view with no key column: `.query(d.TotalRevenue)`. Any other filter, and any
filter of a list, picks many rows, which only an automation reads, before its command: it issues the
command once per row.

The handler refuses a command whose row is missing, and an automation that finds no row issues
nothing.

### Screens, services and headings

`.actor()` takes any number of actors, and the diagram draws each with a screen. Without one the slice has
no screen; without `.service()` it has no service method. When the handler reads a view to
decide, query it: `.command(d.FileNote).query(d.Inbox, "noteId").event(d.NoteFiled)`.

The screen shows the command's form or the view's table, titled with the service method; the
command's card, or the view's, names the service under its title, since the service handles the one
and serves the other. Commands and views stand in the lane between the actors and the streams,
Interaction. To
say which screen the actor is on, declare it once, `m.screen("LockScreen")`, and name
it: `.screen(d.LockScreen)`. The card's title is then the screen's name, and several slices can
share one. The slice's actors see its screen, so a slice with a screen and no actor is a warning, and the
diagram draws neither its screen nor a screen no slice names.

The command heads a slice's column, and the view a state view's. Pass a name,
`m.slice("StartList")`, only when that heading would say the wrong thing. The service method
also takes the command's name; to use another, pass it:
`.service(d.TodoService, "StartList")`.

### Views

A view's key columns, the fields marked `.key()`, say how many rows it has:

| A view | Declared as | An event | A lookup by every key column |
|---|---|---|---|
| keyed | `m.view("Lists", { listId: t.uuid().key(), name: t.string() })` | changes its row, or adds it | one row |
| with no key column | `m.view("TotalRevenue", { total: t.number() })` | changes its one row | needs no filter: `.query(d.TotalRevenue)` |
| a list | `m.view("NoteActivity", t.array({ … }))` | adds a row | every matching row |

The screen of a view with no key column shows its one row, and its state view's response is that
row.

A list of what happened to each note:

```ts
m.view("NoteActivity", t.array({ noteId: t.uuid().key(), at: t.datetime(), what: t.string() }))
```

Its state view's response is a list, and the picture titles it "Note Activity[]".

The same events can build a second table for a different question. A state view shows one view; to
show two side by side, write two state views that name one screen. Without `.context()` its context
is empty.

A view has one state view slice, so a later chapter can extend a table next to the event that
changes it. Every `m.slice().view()` of it adds its events, mappings and specifications to that
slice, which the diagram draws where the first one is: in its chapter, seen by its actors on its screen,
served by its method, read with its context. A later call that names another of those is an error.

```ts
m.slice()
  .view(d.Inbox)
  .event(d.NoteCreated, () => ({ status: t.literal("inbox") }))
  .chapter(d.Capture)
// further down the file: adds NoteFiled to the Inbox slice in Capture
m.slice()
  .view(d.Inbox)
  .event(d.NoteFiled, () => ({ status: t.literal("filed") }))
  .chapter(d.Capture)
```

A state view builds a view an automation polls, or a slice queries, like any other, and then
needs no screen, actor or service.

### Specifications

A specification is a Given, When, Then example; `.spec()` attaches one to a slice. Calling
`d.Name` with data builds an example of it, and its fields check the values: one they refuse is an
error, with where in the example. `given` and `then` accept one example or a list. A state change's
specification has `then`, the events the command records, or `reject`, why the handler refuses it;
never both. An automation's or a translation's may leave out `when` and say `then: []`: nothing
happens. A state view's has `given`, the events that build the rows; `when`, the values of its
context, only once it, or the first state view of its view, has a `.context()`; and `then`, the rows
the screen shows. It has no `reject`, because a view cannot reject an event. Any `then` may also
hold strings, alone or beside its examples, each describing an outcome the examples cannot show:
`then: ["The queue has no row for this record"]`.

Every event a slice handles or produces is in one of its specifications: each event a command records
in some `then`, external events included, and each event a state view names, or an automation's
trigger event, in some `given`. A string in `then` is no event. An automation a view starts has no
trigger event, so it needs none. Every state view has a specification. Until then the model is
unfinished. A `given` may also hold other events, the history that shaped the state.

Specifications illustrate behavior. The tool checks their shape and value types, not that `then`
follows from `given` and `when`, so a `then` may join text, count, or leave out a row a later event
removed.

A value the specification does not care about, such as an id, is `m.generate()`, at any depth, such
as a field of an item in a list. Each one is a value of its field's type that no other generated
value in the specification has, the same on every run, so one used in both `given` and `then`
shows the same value in each. To name one, write the specification as a function:

```ts
.spec("A captured note shows in the inbox", () => {
  const noteId = m.generate()
  return {
    given: d.NoteCaptured({ noteId, text: "buy milk" }),
    then: d.Inbox({ noteId, text: "buy milk" }),
  }
})
```

A specification written as a function runs at assembly, so it may use examples declared below the slice.

### Automations

An automation issues a command with no actor. An event of ours starts it as it happens; a view
starts it once per row. From the eventsourcing book's cart:

```ts
// A price change archives the product from every cart that holds it.
m.slice("ArchiveItemScheduler")
  .automation(d.PriceChanged)
  .query(d.CartsWithProducts, "productId")
  .command(d.ArchiveItem)
  .query(d.CartsWithProducts, (c) => ({
    aggregateId: c.ArchiveItem.aggregateId,
    productId: c.ArchiveItem.productId,
  }))
  .event(d.ItemArchived)
```

The processor hears `PriceChanged`, queries the carts that hold the product, and issues one
`ArchiveItem` per row, its `aggregateId` from the row and its `productId` from the event. The
handler sees only the command: from `.command()` on, the mapping's argument holds the command and
the rows the slice queries after it. So the handler reads the one row its command is for, and
`ItemArchived.itemId` flows from that row. A gear heads an automation's column as well as
its command, so it is the one slice that usually takes a name. Name it for what it does.

The second form polls a view of the work to do. From a hotel model:

```ts
m.slice().view(d.PaymentsToProcess).event(d.PaymentApproved).event(d.PaymentSucceeded)

m.slice("PaymentProcessor")
  .automation(d.PaymentsToProcess)
  .command(d.ProcessPayment)
  .event(d.PaymentSucceeded)
```

A view as the trigger runs on the processor's own schedule, and the command's fields come from the
row. No event and no service method starts it. The view holds only the work: the processor issues
its command for every row, so `PaymentApproved` adds a row and `PaymentSucceeded` takes it out.

### External events

```ts
// The calendar pushes a scheduled task in, and we translate it into an item.
m.external("Calendar")

m.event("TaskScheduled", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  text: t.string(),
}).external(d.Calendar)

m.slice()
  .translation(d.TaskScheduled)
  .command(d.AddItem)
  .event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
  .chapter(d.Integrations)
```

An External System, a system we do not own, is a lane captioned EXTERNAL. Declare it like a
stream, with `m.external("Calendar")`. An event joins it where you declare the event, with
`.external()`. We translate its events and never store them, so an event is in a stream or an
External System, not both. The diagram draws an External System no event has joined yet as an
empty lane, and two modules that declare one name declare one External System.

An external event builds no view: we never store it, so the view would be empty after a
replay. Translate it into an event of ours with `.translation()`, as above, and project that.
`.translation()` takes only an external event, and `.automation()` refuses one; fields flow and
map as in an automation an event starts, but it reads one row at most. We publish an external event a slice of ours produces,
so it needs no translation; any other no `.translation()` reads is a warning, even if a
specification's `given` has it. Translation is for an event that arrives on its own.

The model says that data arrives, not how. A call to such a system is our command and the external
event the call gets back, in one slice. That event's fields come from outside, so the command need
not carry them, and an event of ours after it keeps them:

```ts
m.external("Shop")
m.event("CartUpdated", { added: t.array(Item), unavailable: t.array(Item) }).external(d.Shop)

m.slice()
  .automation(d.GroceriesToOrder)
  .command(d.AddGroceriesToCart)
  .event(d.CartUpdated)
  .event(d.OrderUpdated, (c) => ({ missing: c.CartUpdated.unavailable }))
```

The external event joins the mapping's argument, as `c.CartUpdated`, and its fields flow on by name.
So it comes before the event that keeps it. A field the command carries too flows from neither, and
the mapping says which.

The command sends out only the fields the external event carries, by name or by a mapping; any
other must reach an event of ours. External events can carry data we need but don't want to store
in events — for example, secrets, credentials, PII, large files, etc. Command handlers can manage
this data externally for when it's needed using a secure keystore or other mechanism.

### Streams

A stream is a lane in the diagram; declare it with `m.stream("Lists")`. An event joins it where you
declare the event, with `.stream(d.Lists)`. Once a model declares a stream, every event must join one; an
external event joins its External System instead. A model that declares no stream has one lane, called
Events.

`.stream()` takes `d.Lists`, not a string, so a typo does not compile. The diagram draws a slice in the
lane of the events it records, its command with them, and a stream no event has joined yet as an
empty lane. Two modules that declare one name declare one lane.

### Chapters and order

The model, `export default m.model("Name", { description })`, is its only export, and lists
nothing. The CLI finds every declaration, and every slice, by running each module in the directory.

A chapter is a heading on the timeline; declare it like a stream, with `m.chapter("Capture", 1)`. A
slice joins it with `.chapter(d.Capture)`, complete or not, and joins at most one. The diagram draws
a chapter no slice has joined yet as a title with no columns, and it is a warning. A slice in no chapter has
no heading: chapters are optional, like their numbers. Two modules that declare one name declare
one chapter.

All elements appear on the timeline in declaration order until organized into slices and chapters.

A slice sits where you declare the first of its own elements: its view, its command, or an event
it records. Chapters appear in the order of their numbers: `m.chapter("Capture", 1)`, then
`m.chapter("Filing", 2)`. A chapter with no number is 0, and chapters of one number keep the order
you declare them. A chapter holds its slices in
the order you write them. An element in no slice, and a slice in no chapter, stays where you
declare it, after the chapter of the slice you declare before it. Lanes appear in the order of the first chapter
that uses them.

## Validation

`tsc` checks each slice as you type. The CLI checks the whole model when it assembles, which every
command does first.

The compiler catches:

| Where | What |
|---|---|
| any reference | It is `d.Name`. A name nothing declares is no member of `d`, a string is not a reference, and a step refuses a declaration of another kind, with the fix: `ListCreated: is an event; pass a command.` Two declarations with the same fields are still two. |
| the chain | Only a legal chain compiles; each step offers only what can come next. `.spec()` refuses a slice with no event yet and says what to add, such as `no event. Add .event() before .spec().` |
| a step's declaration | It is one `d.Name`. What `m.command()` returns is not, nor is an example. |
| a mapping | Its argument holds each declaration before its step by name, with its fields: what starts the slice, the rows it queries, the command and the external events it gets back; in a state view, the event. Its result must be fields of the target, each a field that fits it, a `t.literal()` or `m.generate()`. A string format, such as `t.uuid()`, takes only that format. |
| a field that flows by name | It must fit its target as a mapped one does, and only one declaration before the step may carry it; a filter column and its namesake are one. The error names the field to set in the mapping, and where two carry it, both. |
| a step's command or event | Its mapping must set every field no step before it carries, or mark it `m.generate()`, unless the field is optional. The error names the fields. |
| an automation's command | The handler sees only the command: from `.command()` on, what starts the automation and the rows queried before it no longer flow. |
| `.query()` | The filter names columns of the view, each from a field before the step that fits it. A filter that does not name every key column, and any filter of a list, picks many rows, which only an automation reads, before its command. A view with no key column has one row, and needs no filter; any other view does. |
| a state view's event | The step refuses an external event, because we never store one. The error says to translate it first. |
| what starts an automation or a translation | `.automation()` refuses an external event, and the error says to use `.translation()`; `.translation()` takes nothing else. |
| `.key()` | Only a view's field takes it, so `.query()` can count the rows a filter picks. On an event's or a command's field it is an error: `id: only a view has key columns. Remove .key().` |
| `.service()` on a state view | It names the method. |
| `.spec()` | `when` is the slice's command, or a state view's context values; an automation's or a translation's may leave it out only with `then: []`. `then` is its events, or the rows of the view a state view shows, and strings that describe an outcome; `reject` replaces `then`, and a state view has none. The values have their fields' types; a oneOf holds exactly one case. |

Assembly catches the rest. Each finding is an error when data is wrong or has no source, and a
warning when the model is unfinished but nothing is wrong, such as a missing specification or a
slice with no command yet. A slice with no event is an error: what its command takes in goes nowhere. Each names its element first, then its slice, and the
fix: `ItemAdded.title (ListManagement › AddItem): no source. Add title to a step before .event(),
or set it in the mapping.` A command field that reaches no event names instead, as the compiler
does, the `file:line` its slice starts at. The diagram says the same without the code: `Item Added:
title has no source`.

| What | Why the compiler cannot |
|---|---|
| A `d.Name` nothing declares: the diagram draws the call without it | `d.d.ts` can be older than the model, and `em json` runs the model without `tsc`. |
| A name declared twice, such as `ListCreated`, other than a stream, an External System or a chapter | `d.d.ts` types the name as each of its declarations at once, so every use compiles. |
| A column no event of the view's `m.slice().view()` calls writes | The calls can be in several modules. |
| An optional field no slice fills | Same. |
| A slice with no command, or no event | An incomplete slice compiles, so the diagram can draw it while you write it. |
| A command field that reaches no event of its slice, ours or external: none carries it by name, maps it or generates from it, and no later query filters by it | The compiler checks each event's mapping on its own, not against the slice's other events. |
| A state view's event that lacks one of the view's key columns | Its step checks that its fields fit the view's, not that it carries the view's key columns. |
| An event nothing consumes: no `.automation()`, no state view, no `given`; for an external event no slice produces, no `.translation()` | Whether anything uses a declaration is not a type. |
| An event something consumes that no slice records; a view nothing reads or builds | Same. |
| A field with no value, in a model the compiler did not check | `em json` runs the model without `tsc`. |
| Two slices claiming one service method; a slice without a service claims none | A union of literal types dedupes rather than counts. |
| A chapter no slice joins, or a stream no event joins | Whether anything uses a value is not a type. |
| A slice joining two chapters | A chain can call `.chapter()` again further down. |
| A view built from an external event | `em json` runs the model without `tsc`. |
| An event in both a stream and an External System | Separate statements can call `.stream()` and `.external()` on it. |
| An event of ours in no stream, once the model declares one | Whether anything uses a value is not a type. |
| A slice's event, or a state view, that no specification covers, as [Specifications](#specifications) says | The compiler checks each `.spec()` on its own, not against the slice's other specifications. |
| A mapping's result that is a field but no source field, such as `c.AddNote.title.describe("loud")` | A field's method returns a field of the same type. |
| A mapping that throws, such as `m.generate()` given something other than a field: the diagram draws its slice without the mapping | The mapping runs when the model does. |
| `m.generate()` in an automation's command | `m.generate()` is one function, wherever you call it. |

Naming is yours: nothing checks the conventions above.

## The JSON

`em json` prints the model as JSON that validates against `schema/eventmodeling.schema.json`, the
[event-modeling-spec](https://github.com/dilgerma/event-modeling-spec)'s schema with its own
`fields`, `key` and `mappings`, and `comments`, each with a `kind`, on elements and slices.
`test/todo-app.json` is the todo example's.

| Ours | The JSON's |
|---|---|
| a slice | a `Slice`, in story order, with `index` and an `id` no other slice has: its heading, lowercase and hyphenated, numbered from the second slice with that heading. A state change is `STATE_CHANGE`; an `.automation()` is `AUTOMATION`; a `.translation()` is `TRANSLATION`; a state view is `STATE_VIEW`, the spec's pattern of events in, view out, to the screen |
| a chapter | the slice's `context`. A slice in no chapter has none |
| an element in no slice | a `Slice` of its own, titled with it, that holds only it: an event or a command in a `STATE_CHANGE`, a view in a `STATE_VIEW` |
| a command, event, view | an `Element` of type `COMMAND`, `EVENT`, `READMODEL`, in each slice that uses it, with `fields` and `dependencies` along the slice's arrows |
| an automation's gear | an `AUTOMATION` element in `processors`, named after the slice: what starts it points at it, it points at the command |
| a screen | one `SCREEN` per slice with an actor: the screen's name, or the method's. Its fields are the command's, or a state view's `.context()` |
| `.service()` | `service` and `apiEndpoint` on the command, or on the view a state view shows |
| a stream | each event's `aggregate`, and the slice's `aggregates`: the streams it records into. A slice that records nothing names none |
| an actor | the slice's `actors`. An admin carries the tag `admin`, a machine of ours `system`. An automation's, or a state view's no one sees, is the system actor that runs it |
| fields | the element's `fields`: their JSON Schema, as [Fields](#fields) says, less `$schema`, a `pattern` beside a `format`, and an integer's safe-integer bounds. An event's also have `timestamp`, which it doesn't declare, marked `"implicit": true`; the viewer draws an implicit field only where a mapping reads it |
| `.key()` | the element's `key` |
| a list view | its `fields` are an array's JSON Schema, with the row's fields as its `items` |
| a mapping | the slice's `mappings`, by the element of the step it is on, then by field: the source field's name, `= ` and a JSON value, or `generate(<inputs>)`. A field from a queried row, by name too, is `View(filter columns).column`, as `CartsWithProducts(productId).aggregateId`; of a view queried twice, the row before the step. A state view's are on its events, and set the view's columns |
| a note | a `comments` entry on its element, or on its slice: `description` is the text, `kind` is `critical`, `question` or `info`. The viewer reads another tool's element `description`, and a comment with no `kind`, as info |
| a specification | a `Specification`: `given`, `when` and `then` steps, each an example in `examples`. A `reject` is a `SPEC_ERROR` step titled with the reason. A string in `then` is a `SPEC_DESCRIPTION` step titled with it. A state view's context values are a `SPEC_COMMAND` step titled with its screen, the one a reader asks from, as an actor sends a command from one. One that says nothing happens has no `when` and no `then` steps |

The schema allows no property it does not name. The JSON says the rest with properties the
schema has, as follows; a model you write by hand can do the same, and the viewer draws it.

| What | Where |
|---|---|
| an External System | its events have `context: "EXTERNAL"`, and `service` names the system. No `aggregate`: we never store them |
| a call to one | the external event among the command's outbound events |
| what an event of ours keeps from the external event a call gets back | the external event pointing at it |
| outcomes that are alternatives | no field: a command's outbound events are what it can record, and each specification's `then` says which it did |
| what a slice queries | the view pointing at the command; one pointing at the processor is the view the automation polls |

The top level holds only `slices`, so the rest travels beside the JSON, only to the viewer: the
model's name and description; the chapters, with their notes, and the streams, in the order
drawn; the actors no slice names and every External System; and the model's `errors` and
`warnings`, each naming the slice it is about by its `id`. That is what `em json --partial`
prints. Notes on actors, services and External Systems have no place in either.

## Protobuf

`proto` writes one `.proto` file per service, at the path its package implies, ready for
`buf generate` with your own `buf.gen.yaml`. The output passes `buf lint` under `STANDARD`.

`proto` writes a service's file once its own slices have no errors: the state changes and state views
with `.service()` naming it, each with its command, views and context fields. An error elsewhere,
or a warning anywhere, such as a missing specification, does not hold it back. `proto` skips a service
whose own slices have errors, prints its errors, and exits 1.

| Slice | Generates |
|---|---|
| state change | `rpc Command(CommandRequest) returns (CommandResponse)`. The request is the command's fields. The response is empty, because events are internal. |
| state view | `rpc Method(MethodRequest) returns (MethodResponse)`. The request is the `.context()` fields. The response returns one row when the view is not a list and they name every key column, as an empty context does for a view with none; otherwise, a list. |
| automation, or a slice without `.service()` | Nothing. They have no service method. |

Every command and view becomes a `message`. Field numbers follow declaration order, so
appending a field is compatible and reordering one is not; `buf breaking` reports which you did.
[Step 4 of the quickstart](#4-generate-the-api) shows a whole file.

Each field's proto type is in [Fields](#fields). A list of records, or a oneOf case that is a list
or a record, has none: it is an error that names the declaration and the field. The todo example's
output is `examples/proto`.

## CLI

```bash
npx em init   model/                 # scaffold a model directory
npx em types  model/                 # write generated/d.d.ts, which types d
npx em types  model/ --check         # exit 1 if generated/d.d.ts is out of date, for CI
npx em view   model/                 # live diagram; runs until Ctrl-C
npx em view   model.json             # the same for a model written as spec JSON
npx em export model/ -o model.html   # one self-contained page, for sharing; takes model.json too
npx em json   model/                 # the model as event-modeling-spec JSON
npx em json   model/ --partial       # what the viewer draws of an unfinished model
npx em proto  model/ -o proto        # one .proto per service
```

Every command also accepts a single self-contained file.

`json` assembles the model and fails when assembly finds errors; its warnings go to stderr. With
`--partial` it goes on past errors and prints what the viewer reads: the spec JSON as `model`, and
beside it what the spec has no place for, the `errors` and `warnings` among it. `view` and `export`
assemble that way.

`view` rewrites `generated/d.d.ts` and type-checks the model on every save, with the
`tsconfig.json` that `init` wrote. It logs each compiler error as `file:line`, with what assembly
finds, in the terminal under a count such as `2 errors, 3 warnings:`, errors first, or `Nothing
left to do.` An example used above its declaration is one line per file, listing what to move up.
When a module throws, the model doesn't load and `generated/d.d.ts` lacks what the modules declare
after it, so the log leaves out the names it lacks.

The picture marks the same: a red ring for an error, a yellow ring for a warning, on the
slice in the navigation, its column heading and the card it is about. A selected slice or card
lists its own in plain words in the panel beside the board; the model's name in the header lists
them all. `E` steps to the next slice with a red dot and `W` to the next with a yellow one; `Shift` steps back.

`view` and `export` also draw a model written as spec JSON, by hand or extracted from a running
system. They draw it as far as it goes, and list each place it breaks the schema as an error, as
`model.json /slices/0/sliceType: must be equal to one of the allowed values ...`. The file has only
what the spec has, so lanes and chapters come in the order its slices first name them, and a User
sees a screen the file gives no actor.

Node runs the TypeScript directly with `--experimental-strip-types`. The package carries `zod`,
which checks the values under `t`, and `typescript`, so the model needs no other dependency.

## Developing

```bash
git clone https://github.com/noahseger/agent-skills.git
cd agent-skills/event-modeling/ts
npm ci
npm test
```

`npm test` checks that each model's `generated/d.d.ts` is current, type-checks, lints, builds the
viewer and the package, runs the node tests, and lints the generated proto. Each example, each test
fixture and `test/typecheck` is a model with its own `tsconfig.json` and `generated/`; after
changing one, `npm run types -- examples/todo-app` writes its file again.

To model against the checkout, with nothing published, build it once and install it into a new
repository by path. npm links the directory, so the next save picks up a rebuild of the
checkout.

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
