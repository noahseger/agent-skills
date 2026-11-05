// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { m } from "#em"
import { z } from "zod"

const User = m.actor()
const Admin = m.actor({ icon: "admin" })
const TodoService = m.service("todo.v1")
const CreateList = m.command({ listId: z.string(), name: z.string() })
const ListCreated = m.event({ listId: z.string(), name: z.string() })
const AddItem = m.command({ listId: z.string(), text: z.string() })
const ItemAdded = m.event({ listId: z.string(), title: z.string() })
const TodoList = m.readModel({ listId: m.key(z.string()), name: z.string(), itemCount: z.number().int() })
const NameList = m.command({ listId: z.string(), name: z.string() })

// --- any reference: a reference is a value, so a string is not one -----------

// @ts-expect-error "User" is a string, not an actor
m.slice().command(CreateList).actor("User")

// --- a slot takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
m.slice().command(ListCreated)

// @ts-expect-error a command is not an event
m.slice().command(CreateList).event(CreateList)

// @ts-expect-error a command is not a read model
m.slice().projection(CreateList)

// @ts-expect-error an event is not a read model
m.slice().view(ListCreated)

// @ts-expect-error a read model is not an event
m.slice().trigger(TodoList)

// --- the chain: a slice starts with what starts it -----------------------------

// @ts-expect-error a slice does not start with .event()
m.slice().event(ListCreated)

// @ts-expect-error a slice does not start with .actor()
m.slice().actor(User)

// @ts-expect-error a slice does not start with .query()
m.slice().query({ listId: z.string() })

// @ts-expect-error a slice does not start with .service()
m.slice().service(TodoService)

// Each start offers only its own next steps.

// @ts-expect-error an automation has no actor
m.slice().trigger(ListCreated).actor(User)

// @ts-expect-error an automation has no actor, after its command either
m.slice().trigger(ListCreated).command(NameList).event(ListCreated).actor(User)

// @ts-expect-error an automation works through a to-do list without a service
m.slice().todoList(TodoList).command(NameList).service(TodoService)

// @ts-expect-error a view records no event
m.slice().view(TodoList).event(ListCreated)

// @ts-expect-error a view issues no command
m.slice().view(TodoList).command(CreateList)

// @ts-expect-error a projection has no actor
m.slice().projection(TodoList).actor(User)

// @ts-expect-error a projection has no command
m.slice().projection(TodoList).command(CreateList)

// @ts-expect-error a state change has no query
m.slice().command(CreateList).query({ listId: z.string() })

// @ts-expect-error a state change is not started twice
m.slice().command(CreateList).command(AddItem)

// @ts-expect-error a chain that stops at the command is not a slice
m.model("x", { chapters: { Ch: [m.slice().command(CreateList).actor(User)] } })

// @ts-expect-error an automation that stops at its trigger is not a slice
m.model("x", { chapters: { Ch: [m.slice().trigger(ListCreated)] } })

// @ts-expect-error a projection with no .event() is not a slice
m.model("x", { chapters: { Ch: [m.slice().projection(TodoList)] } })

// A chapter written in another module, `export const Sync = [...]`, is checked the same.
const Sync = [m.slice().command(CreateList)]
// @ts-expect-error a chain that stops at the command is not a slice
m.model("x", { chapters: { Sync } })

// The error names the missing step. These lines compile only while it does.
const stopsAtCommand = m.slice().command(CreateList)
const needsEvent: (typeof stopsAtCommand)["finish this slice with"] = ".event(Event)"
const stopsAtTrigger = m.slice().trigger(ListCreated)
const needsCommand: (typeof stopsAtTrigger)["finish this slice with"] = ".command(Command)"
const stopsAtProjection = m.slice().projection(TodoList)
const needsProjected: (typeof stopsAtProjection)["finish this slice with"] = ".event(Event)"
void needsEvent
void needsCommand
void needsProjected

// Finished, with no actor or service: actors and services are never required.
m.model("x", { chapters: { Ch: [
  m.slice().command(CreateList).event(ListCreated),
  m.slice().command(CreateList).readModel(TodoList).event(ListCreated).actor(User, Admin).service(TodoService),
  m.slice().command(CreateList).actor(User).event(ListCreated).service(TodoService, "StartList"),
  m.slice().view(TodoList),
  m.slice().view(TodoList).query({ listId: z.string() }).actor(User),
  m.slice().view(TodoList).actor(User).service(TodoService, "GetList"),
  m.slice().trigger(ListCreated).command(NameList).event(ListCreated),
  m.slice().todoList(TodoList).command(NameList).readModel(TodoList).event(ListCreated),
  m.slice().projection(TodoList).event(ListCreated),
] } })

// @ts-expect-error a view names its method: it has no command to take one from
m.slice().view(TodoList).service(TodoService)

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope, and the mapping must set title
m.slice().command(AddItem).event(ItemAdded((c) => ({ nope: c.text })))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().command(AddItem).event(ItemAdded)

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().command(AddItem).event(ItemAdded((c) => ({ listId: c.listId })))

m.slice().command(AddItem).event(ItemAdded((c) => ({ title: c.text })))
// generate() fills the field the command lacks.
m.slice().command(AddItem).event(ItemAdded((c, { generate }) => ({ title: generate() })))

// @ts-expect-error count applies to a projection, not where a handler records an event
m.slice().command(AddItem).event(ItemAdded((c, { count }) => ({ title: "" })))

// @ts-expect-error a mapping's helpers are its second argument, not on m
m.count

// @ts-expect-error title is a string
m.slice().command(AddItem).event(ItemAdded((c) => ({ title: 42 })))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
m.slice().command(AddItem).event(ItemAdded((c) => ({ title: c.name })))

// @ts-expect-error the mapping is the declaration's call, not a second argument
m.slice().command(AddItem).event(ItemAdded, (c: { text: string }) => ({ title: c.text }))

// An automation's command: every field its trigger, or to-do row, lacks is set by the mapping.

// @ts-expect-error ListCreated has no text, so AddItem.text has no value
m.slice().trigger(ListCreated).command(AddItem)

// @ts-expect-error the mapping must set text, which ListCreated lacks
m.slice().trigger(ListCreated).command(AddItem((e) => ({ listId: e.listId })))

// @ts-expect-error the argument is the trigger's fields, and ListCreated has no title
m.slice().trigger(ListCreated).command(AddItem((e) => ({ text: e.title })))

// @ts-expect-error the to-do row has no text, so AddItem.text has no value
m.slice().todoList(TodoList).command(AddItem)

// @ts-expect-error an automation's command gets no helpers
m.slice().trigger(ListCreated).command(AddItem((e, { generate }) => ({ text: generate() })))

m.slice().trigger(ListCreated).command(AddItem((e) => ({ text: e.name }))).event(ItemAdded((c) => ({ title: c.text })))
m.slice().todoList(TodoList).command(AddItem((row) => ({ text: row.name }))).event(ListCreated((c) => ({ name: c.text })))

// --- a declaration written in place is checked like one declared apart -------

// @ts-expect-error inline AddItem has no title, so inline ItemAdded.title has no value
m.slice().command("AddItem", { text: z.string() }).event("ItemAdded", { title: z.string() })

// @ts-expect-error inline AddItem has no title, so ItemAdded.title has no value
m.slice().command("AddItem", { listId: z.string() }).event(ItemAdded)

// @ts-expect-error CreateList has no title, so inline ItemAdded.title has no value
m.slice().command(CreateList).event("ItemAdded", { title: z.string() })

// @ts-expect-error ListCreated has no text, so inline Remind.text has no value
m.slice().trigger(ListCreated).command("Remind", { text: z.string() })

m.slice().command("AddItem", { text: z.string() }).event("ItemAdded", { text: z.string() })
m.slice().command(CreateList).event("ListNamed", { name: z.string() })
m.slice().trigger(ListCreated).command("Archive", { listId: z.string() }).event("Archived", { listId: z.string() })
m.slice().todoList(TodoList).command("Remind", { listId: z.string() }).event("Reminded", { listId: z.string() })

// --- a projection: its function reads the event and sets columns --------------

// @ts-expect-error TodoList has no column done
m.slice().projection(TodoList).event(ListCreated(() => ({ done: true })))

// @ts-expect-error generate applies where a handler records an event, not to a projection
m.slice().projection(TodoList).event(ListCreated((e, { generate }) => ({ itemCount: generate() })))

// @ts-expect-error itemCount is a number
m.slice().projection(TodoList).event(ListCreated(() => ({ itemCount: "0" })))

// --- .test() -----------------------------------------------------------------

const create = m.slice().command(CreateList).event(ListCreated).actor(User).service(TodoService)

// @ts-expect-error when is the slice's command
create.test("x", { when: AddItem({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })

// @ts-expect-error then is the slice's events, not any event
create.test("x", { when: CreateList({ listId: "l-1" }), then: ItemAdded({ listId: "l-1" }) })

// @ts-expect-error a rejection is reject: "why", not a string in then
create.test("x", { when: CreateList({ listId: "l-1" }), then: "Error: nope" })

// @ts-expect-error a specification has then or reject, not both
create.test("x", { when: CreateList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }), reject: "nope" })

// @ts-expect-error a specification has then or reject, not neither
create.test("x", { when: CreateList({ listId: "l-1" }) })

// @ts-expect-error a rejection is written in the specification, not declared on m
m.reject

// @ts-expect-error a projection has no when
m.slice().projection(TodoList).event(ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({}), then: TodoList({}) })

// @ts-expect-error a read model cannot reject
m.slice().projection(TodoList).event(ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), then: TodoList({}), reject: "nope" })

// @ts-expect-error an example is not a use in a slice
m.slice().command(CreateList).event(ListCreated({ listId: "l-1" }))

// --- calling a declaration: its fields, with Zod's types ---------------------

// @ts-expect-error nickname is not a field of CreateList
CreateList({ listId: "l-1", nickname: "shopping" })

// @ts-expect-error listId is a string
CreateList({ listId: 42 })

// @ts-expect-error a declaration is called for an example; there is no .with()
CreateList.with({ listId: "l-1" })

// The legal forms of the same calls, so a check that fires too widely also fails.
create.test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({ listId: "l-2" }), then: [ListCreated({ listId: "l-2" })] })
create.test("x", { given: [ListCreated({ listId: "l-1" })], when: CreateList({ listId: "l-1" }), reject: "nope" })
m.slice().trigger(ListCreated).command(NameList).event(ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: NameList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })
m.slice().projection(TodoList).event(ListCreated(() => ({ itemCount: 0 }))).event(ItemAdded((e, { count }) => ({ itemCount: count(e), name: e.title })))
