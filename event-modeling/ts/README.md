# event-modeling

Describe a system’s commands, events, and read models in TypeScript. The `em` command draws a live diagram, checks the model, and exports JSON and protobuf service definitions. Use it to find missing data sources and inconsistent examples before implementation.

It runs wherever node 22.6 or later runs.

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
`.readModel()`, `.actor()`. Only a mapping's helper is a verb, because it does something:
`generate`.

Your own names follow the practice: events in the past tense (`NoteCreated`), commands in the
imperative (`CreateNote`), read models as nouns (`Inbox`). Everything you declare, chapters
included, is named by its export.

A lane says whose it is and what it holds. Name a system after the system (`Calendar`) and a stream
after what we keep track of (`Connections`), never after the system it is about (`CalendarStream`).

## How it fits together

**Names come from exports.** Export a declaration and the CLI uses the binding's name:
`export const ListCreated = m.event(...)` is the event `ListCreated`. Names are CamelCase, and the
diagram shows them as words. Any declaration accepts `.note("...")`.

**Fields are [Zod](https://zod.dev) schemas.** Events, commands and read models declare their fields
the same way. Zod types the example data in specifications and the generated messages.

**Slices connect declarations.** A slice is a chain of calls. The first takes the slice's whole
pattern, starting with what starts it, so an incomplete slice does not compile; the rest add to it.
When a slice connects two declarations, fields with the same name flow from one to the other. When
the names differ, or a value has to be computed, call the declaration with a function:
`ItemAdded((c) => ({ title: c.text }))`. The function's argument is the slice's source, so the
editor knows its fields. The editor offers only the calls that can come next.

## The slice patterns

| Pattern | Starts with | Chain | Meaning |
|---|---|---|---|
| state change | the command | `.command(Command, Event)` | An actor issues a command and events are recorded. |
| state view | the read model | `.view(ReadModel, Event)` | Our events build a read model, and an actor reads it. |
| automation | the trigger: an event, or a read model it polls | `.trigger(Event, Command, Event)` or `.trigger(ReadModel, Command, Event)` | An event, or a row of work, causes a command. No actor is involved. |

The first call is the whole pattern, and leaving out any of its arguments is an error where the slice
is written. Every later step is optional: `.event()` adds another event, `.readModel()` names what
the handler reads, once per read model, `.query()` gives a view its request fields, `.test()`
adds a specification, and `.chapter()` puts the slice in a chapter. A state change or a view also
takes `.actor()`, `.screen()` and `.service()`, and needs none of them. An automation takes
`.actor()` for the system actor that runs it.

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
  .command(CreateList, ListCreated)
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

A user adds an item. The command says `text` and the event says `title`, so the event is called
with a function that maps the field that does not match:

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
  .command(AddItem, ItemAdded((c) => ({ title: c.text })))
  .chapter(ListManagement)
  .actor(User)
  .service(TodoService)
  .test("A user adds an item", {
    given: groceries,
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
    then: milk,
  })
```

A read model is a table, and `m.key` marks the columns that identify a row. A view slice builds it
from events, and the user reads their lists in it:

```ts
export const TodoList = m.readModel({
  userId: m.key(z.string()),
  listId: m.key(z.string()),
  name: z.string(),
  itemCount: z.number().int(),
})

m.slice()
  .view(TodoList, ListCreated(() => ({ itemCount: 0 })))
  .chapter(Views)
  .event(ItemAdded((e, { generate }) => ({ itemCount: generate(e) })))
  .query({ userId: z.string() })
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

`ListCreated` fills `userId`, `listId` and `name`; the function sets `itemCount`. `generate(e)` says
the count is made from the `ItemAdded` events seen for the row. An event finds its row by the key
columns, so each event a view names must carry every one: `ItemAdded` carries `userId` for that
reason.

`.query()` declares the request. A view has no command to name its method after, so `.service()`
names it.

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

Automations, and views no one sees, are drawn in the lane of the system actor that runs them. A
model need not declare one: they are then under the built-in System. Once it does, the first system
actor declared runs them all, and an automation's `.actor(Syncer)` names another.

### Fields and mappings

A field declared `.optional()` may go unfilled in a slice, as long as another slice fills it:

```ts
export const NoteShared = m.event({ noteId: z.uuid(), imageUri: z.string().optional() })

m.slice().command(ShareText, NoteShared)    // ShareText has no imageUri
m.slice().command(ShareImage, NoteShared)   // ShareImage carries it
```

An optional field no slice fills is left to do. The same holds for an automation's command. Write
no default in a mapping, such as `c.imageUri ?? ""`: the model cannot see it. Make the field
optional instead.

A value the handler makes has no field to copy. Say what it is made from with `generate()`, which
the function gets as its second argument: the command's fields, and any read model the handler
looks it up in, which the slice names with `.readModel()`. From nothing, it is an id or a clock. A
specification may give it any value.

```ts
.command(AddNote, NoteAdded((c, { generate }) => ({ noteId: generate(), slug: generate(c.title) })))
.command(RecordChange, ChangeRecorded((c, { generate }) => ({ noteId: generate(c.pageId, Pages) })))
  .readModel(Pages)
```

A mapping only copies, sets constants and says what a value is made from; it computes nothing. A
field put into a string, such as `` `${c.title}!` ``, or into arithmetic, such as `c.minutes * 60`,
is drawn as generated from that field and left to do, with the fix: `generate(c.title)`. The
compiler cannot see it, because a string built from a string is a string.

The events a command lists, `.command(AddItem, ItemAdded).event(ListFull)`, are what it can
produce, not a sequence; the diagram draws them side by side. Each specification's `then` says
which happened.

### Screens, services and headings

`.actor()` takes any number of actors, and each is drawn with a screen. Without one the slice has
no screen; without `.service()` it has no service method. When the handler reads a read model to
decide, name it: `.command(FileNote, NoteFiled).readModel(Inbox)`.

The screen shows the command's form or the read model's table, titled with the service method. To
say which screen the actor is on, declare it once, `export const LockScreen = m.screen()`, and name
it: `.screen(LockScreen)`. The card is then titled with the screen's name, and several slices can
share one. A screen is seen by the slice's actors, so a slice with a screen and no actor is left to
do, and so is a screen no slice names; neither is drawn.

A slice's column is headed by its command, or a view's by its read model. Pass a name,
`m.slice("StartList")`, only when that heading would say the wrong thing. The service method is
also named after the command; to use another method name, pass it:
`.service(TodoService, "StartList")`.

### Read models

The same events can build a second table for a different question. A view shows one read model;
to show two side by side, write two views that name one screen. Without `.query()` its request is
empty.

A read model has one view slice, so a later chapter can extend a table next to the event that
changes it. Every `.view()` of it adds its events, mappings and specifications to that slice, which
is drawn where the first one is: in its chapter, seen by its actors on its screen, served by its
method. A later call that names another of those is left to do.

```ts
m.slice().view(Inbox, NoteCreated(() => ({ status: "inbox" }))).chapter(Capture)
// further down the file: adds NoteFiled to the Inbox slice in Capture
m.slice().view(Inbox, NoteFiled(() => ({ status: "filed" }))).chapter(Capture)
```

A read model an automation polls, or a handler reads, is built by a view like any other, which then
needs no screen, actor or service.

### Specifications

A specification is a Given, When, Then example attached to a slice with `.test()`. Calling a
declaration with data builds an example of it, and Zod checks the values. `given` and `then` accept
one example or a list. A state change's specification has `then`, the events recorded, or
`reject`, why the command is refused; never both. A view's has `given`, the events that build the
rows; `when`, the values its query is asked with, only once it has a `.query()`; and `then`, the
rows the screen shows. It has no `reject`, because a read model cannot reject an event.

Every event a slice handles or produces is in one of its specifications: each event a command lists
in some `then`, external events included, and each event a view names, or an automation's
trigger event, in some `given`. An automation a read model starts has no trigger event, so it needs
none. Every view has a specification. Until then the model is unfinished. A `given` may also hold
other events, the history that shaped the state.

A specification must agree with its slice's wiring. A value copied or mapped from the command, the
trigger event, the polled row or a given event must equal the value there; a constant the mapping
sets, the constant. A `generate()` field, and any field of an external event, may be anything. The
polled row is the one `given` builds whose key columns hold what the command copied from them. A
disagreement names the spec, the field and both values.

A view's `given` builds the rows through the view's events. Each row in
`then` must be one of them, matched by its key columns, with the values they have. A row built and
left out of `then` must be one the query excludes: a query field filters by equality with the
column of the same name. A query field with no such column, such as a search's `text`, excludes
nothing, so its specification lists every row built.

### Automations

An automation issues a command with no actor. It has two forms.

```ts
// When the last item is done, the list completes.
m.slice("ListCompleter")
  .trigger(ItemCompleted, CompleteList, ListCompleted)
  .readModel(OpenItems)
```

`.trigger()` with an event starts the slice when the event occurs, and fields flow from the event
into the command. A command field the event does not carry is set by calling the command with a
function whose argument is the event:
`.trigger(NoteCreated, ClassifyNote((e) => ({ noteId: e.id })), NoteClassified)`. `.readModel()`
names what the handler looks at, once per read model. An automation's column is headed by a gear as
well as its command, so it is the one slice that usually takes a name. Name it for what it does.

The second form polls a read model of the work to do. From a hotel model:

```ts
m.slice("PaymentProcessor")
  .trigger(PaymentsToProcess, ProcessPayment, PaymentSucceeded)
```

A read model as the trigger runs on the processor's own schedule, and the command's fields come
from the row, or from a function whose argument is the row. No event and no service method starts
it. The view that builds `PaymentsToProcess` marks the row done when it sees
`PaymentSucceeded`.

### Events from outside

```ts
// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external()

export const TaskScheduled = m
  .event({ userId: z.string(), listId: z.string(), itemId: z.string(), text: z.string() })
  .external(Calendar)

m.slice()
  .trigger(TaskScheduled, AddItem, ItemAdded((c) => ({ title: c.text })))
  .chapter(Integrations)
```

A system you do not own is a lane, declared once with `m.external()` and named by its export, like
a stream. An event joins it where the event is declared, with `.external()`. We translate its
events and never store them, so an event is in a stream or a system, not both. A system no event
has joined yet is drawn empty, and two modules may export one under the same name.

An external event builds no read model: it isn't stored, so the read model would be empty after a
replay. Translate it into an event of ours with `.trigger()`, as above, and project that.

The model says that data arrives, not how. A call to such a system is our command followed by the
event that brings its data back, and that event's fields come from outside, so the command need
not carry them:

```ts
export const Shop = m.external()
export const CartUpdated = m.event({ added: z.array(Item), unavailable: z.array(Item) }).external(Shop)

m.slice().trigger(GroceriesToOrder, AddGroceriesToCart, CartUpdated)   // the call
m.slice().trigger(CartUpdated, RecordOrder, OrderUpdated)              // we keep what came back
```

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
like a stream. A slice joins it with `.chapter()`, anywhere after its first call, and joins at most
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
| any reference | An unknown actor, event, command, read model, screen or service cannot be written, because references are values, not strings. |
| the chain | Only a legal chain compiles; each start offers only its own steps. A slice missing part of its pattern is an error where it is written: `Expected 2 arguments, but got 1`, beside which the editor names the missing argument, such as `event`. |
| a function | Its argument is the slice's source: the command for a handler's event, the trigger event or the polled row for an automation's command, the event in a view. Its result must be fields of the target, with matching types. Its second argument holds `generate`, except for an automation's command. |
| a command's event | Every event field the command lacks must be set by the function, or marked `generate()`, unless it is optional. The error names the fields. |
| a view's event | An external event is refused, because it isn't stored. The error says to translate it first. |
| a function outside a slice | A mapper only works inside a slice: `.event(...)`, `.command(...)` or `.view(...)`. The error says so. |
| an automation's command | Every command field the trigger event, or the polled row, lacks must be set by the function, unless it is optional. The error names the fields. |
| `.service()` on a view | It names the method. |
| `.test()` | `when` is the slice's command, or a view's query values. `then` is its events, or the rows of the read model a view shows; `reject` replaces `then`, and a view has none. Zod checks the values. |

Assembly catches the rest, and each error names the slice it found the problem in:

| What | Why the compiler cannot |
|---|---|
| A declaration used in a slice that no module exports, or one exported under two names | It has no name until it is exported. |
| Two modules exporting one name, such as `ListCreated` | Each module is compiled on its own. |
| A column no event of the read model's `.view()` calls writes | The calls can be in several modules. |
| An optional field no slice fills | Same. |
| A view's event that lacks one of the read model's key columns | Declarations are anonymous, so two events with the same fields are one type. |
| An event nothing consumes: no `.trigger()`, no view, no `given` | Same. |
| An event no slice records; a read model nothing reads or builds | Same. |
| A field with no value, in a model the compiler did not check | `em json` runs the model without `tsc`. |
| Two slices claiming one service method; a slice without a service claims none | A union of literal types dedupes rather than counts. |
| A declaration in no slice, a slice in no chapter, or a chapter no slice joins | Whether a value is used is not a type. |
| A slice joining two chapters | `.chapter()` can be called again further down the chain. |
| A read model built from an external event | `em json` runs the model without `tsc`, and `Event(map)` does not say whose event it is. |
| An event in both a stream and an external system | `.stream()` and `.external()` can be called on it in separate statements. |
| An event of ours in no stream, once the model declares one | Whether a value is used is not a type. |
| A slice's event or view that no specification covers, as [Specifications](#specifications) says | Each `.test()` is checked on its own, not against the slice's other specifications. |
| A specification value that is not what flows in: from `when`, the trigger in `given`, or the events that build the row | Example values are data, not types. |
| A view's row that `given` does not build, or a built row `then` leaves out and the query does not exclude | Same. |
| A source field put into a string or arithmetic in a mapping | A string built from a string is a string, and a number from a number a number. |
| A read model passed to `generate()` that the slice does not name with `.readModel()` | `.readModel()` can be called anywhere down the chain. |

Naming is yours: the conventions above are not checked.

## The JSON

`em json` prints the model as JSON that validates against the
[event-modeling-spec](https://github.com/dilgerma/event-modeling-spec) JSON Schema, vendored in
`schema/eventmodeling.schema.json`. `test/todo-app.json` is the todo example's.

| Ours | The spec's |
|---|---|
| a slice | a `Slice`, in story order, with `index`. A state change is `STATE_CHANGE`; a `.trigger()` is `AUTOMATION`, or `TRANSLATION` when its trigger is an external event; a view is `STATE_VIEW`, the spec's pattern of events in, read model out, to the screen |
| a chapter | the slice's `context`. A slice in no chapter has none |
| a command, event, read model | an `Element` of type `COMMAND`, `EVENT`, `READMODEL`, in each slice that uses it, with `fields` and `dependencies` along the slice's arrows |
| an automation's gear | an `AUTOMATION` element in `processors`, named after the slice: what starts it points at it, it points at the command |
| a screen | one `SCREEN` per slice with an actor: the screen's name, or the method's. Its fields are the command's, or a view's `.query()` |
| `.service()` | `service` and `apiEndpoint` on the command, or on the read model a view shows |
| a stream | each event's `aggregate`, and the slice's `aggregates`: the streams it records into. A slice that records nothing names none |
| an actor | the slice's `actors`. An admin is tagged `admin`, a machine of ours `system`. An automation's, or a view's no one sees, is the system actor that runs it |
| `m.key` | `idAttribute: true` |
| `.optional()`, `z.array()`, `z.object()` | `optional`, `cardinality: "List"`, `subfields` |
| a note | an element's `description` |
| a specification | a `Specification`: `given`, `when` and `then` steps, each an example in `examples`. A `reject` is a `SPEC_ERROR` step titled with the reason. A view's query values are a `SPEC_COMMAND` step titled with its screen, the request it is asked from, as a command is sent from one |

The schema allows no property it does not name, at any level, so the JSON adds no keys. Where it
needs to say what the spec has no field for, it uses a field the spec has, as follows. A model
written by hand can do the same, and the viewer draws it.

| What | Where |
|---|---|
| where a mapped field's value comes from | the field's `mapping`: the source field's name, or `= ` and a JSON value. A value the handler makes is `generated: true`, and its `mapping` lists what it is made from, comma-separated: source fields and read models, as `pageId, Pages`; made from nothing, it has no `mapping`. A read model built from several events maps a column once per event, one line each, a generated one as `ItemAdded: generate(ItemAdded)` |
| a system we do not own | its events have `context: "EXTERNAL"`, and `service` names the system. No `aggregate`: we never store them |
| a call to one | the external event among the command's outbound events |
| outcomes that are alternatives | no field: a command's outbound events are what it can record, and each specification's `then` says which it did |
| what a handler reads | a read model pointing at the command; one pointing at the processor is the read model the automation polls |
| a slice's note | a `storylines` entry titled with it, with no elements |

The top level holds only `slices`, so the rest travels beside the JSON, only to the viewer: the
model's name and description; the chapters, with their notes, and the streams, in the order
declared; the actors no slice names and every external system; and, while the model is unfinished,
the declarations in no slice and what is left to do. That is what `em json --partial` prints. Notes
on actors, services and external systems have no place in either.

## Protobuf

`proto` writes one `.proto` file per service, at the path its package implies, ready for
`buf generate` with your own `buf.gen.yaml`. The output passes `buf lint` under `STANDARD`.

A service's file is written once its own slices are finished: the state changes and views with
`.service()` naming it, each with its command, read models and query fields. What is left to do
elsewhere does not hold it back; a service with its own left to do is skipped, its to-dos printed,
and `proto` exits 1.

| Slice | Generates |
|---|---|
| state change | `rpc Command(CommandRequest) returns (CommandResponse)`. The request is the command's fields. The response is empty, because events are internal. |
| view | `rpc Method(MethodRequest) returns (MethodResponse)`. The request is the `.query()` fields. The response returns one row when the query names every key column; otherwise, a list. |
| automation, or a slice without `.service()` | Nothing. They have no service method. |

Every command and read model becomes a `message`. Field numbers follow declaration order, so
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
