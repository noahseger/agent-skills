// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { m } from "#em"
import { z } from "zod"

const User = m.actor()
const TodoService = m.service("todo.v1")
const CreateList = m.command({ listId: z.string(), name: z.string() })
const ListCreated = m.event({ listId: z.string(), name: z.string() })
const AddItem = m.command({ listId: z.string(), text: z.string() })
const ItemAdded = m.event({ listId: z.string(), title: z.string() })
const TodoList = m.readModel({ listId: m.key(z.string()), name: z.string(), itemCount: z.number().int() })

// --- any reference: a reference is a value, so a string is not one -----------

// @ts-expect-error "User" is a string, not an actor
m.slice().actor("User")

// --- a slot takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
m.slice().actor(User).service(TodoService).command(ListCreated)

// @ts-expect-error a command is not an event
m.slice().actor(User).service(TodoService).command(CreateList).emits(CreateList)

// @ts-expect-error a command is not a read model
m.slice().projects(CreateList)

// --- the chain ---------------------------------------------------------------

// @ts-expect-error a slice does not start with .emits()
m.slice().emits(ListCreated)

// @ts-expect-error an automation has no actor
m.slice().on(ListCreated).actor(User)

// @ts-expect-error a chain that stops at the command is not a slice
m.model("x", { chapters: { Ch: [m.slice().actor(User).service(TodoService).command(CreateList)] } })

// @ts-expect-error a projection with no .on() is not a slice
m.model("x", { chapters: { Ch: [m.slice().projects(TodoList)] } })

// A chapter written in another module, `export const Sync = [...]`, is checked the same.
const Sync = [m.slice().actor(User).service(TodoService).command(CreateList)]
// @ts-expect-error a chain that stops at the command is not a slice
m.model("x", { chapters: { Sync } })

// The error names the missing step. These lines compile only while it does.
const stopsAtCommand = m.slice().actor(User).service(TodoService).command(CreateList)
const needsEmits: (typeof stopsAtCommand)["finish this slice with"] = ".emits(Event)"
const stopsAtProjects = m.slice().projects(TodoList)
const needsOn: (typeof stopsAtProjects)["finish this slice with"] = ".on(Event)"
void needsEmits
void needsOn

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ nope: c.text }))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded)

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ listId: c.listId }))

m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ title: c.text }))
// generate() fills the field the command lacks.
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c, { generate }) => ({ title: generate() }))

// @ts-expect-error count applies to a projection, not to .emits()
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c, { count }) => ({ title: "" }))

// @ts-expect-error a mapping's helpers are its second argument, not on m
m.count

// @ts-expect-error title is a string
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ title: 42 }))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ title: c.name }))

// --- a declaration written in place is checked like one declared apart -------

// @ts-expect-error inline AddItem has no title, so inline ItemAdded.title has no value
m.slice().actor(User).service(TodoService).command("AddItem", { text: z.string() }).emits("ItemAdded", { title: z.string() })

// @ts-expect-error inline AddItem has no title, so ItemAdded.title has no value
m.slice().actor(User).service(TodoService).command("AddItem", { listId: z.string() }).emits(ItemAdded)

// @ts-expect-error CreateList has no title, so inline ItemAdded.title has no value
m.slice().actor(User).service(TodoService).command(CreateList).emits("ItemAdded", { title: z.string() })

// @ts-expect-error the mapping must set title, which inline AddItem lacks
m.slice().actor(User).service(TodoService).command("AddItem", { text: z.string() }).emits("ItemAdded", { title: z.string() }, () => ({}))

m.slice().actor(User).service(TodoService).command("AddItem", { text: z.string() }).emits("ItemAdded", { title: z.string() }, (c) => ({ title: c.text }))
m.slice().actor(User).service(TodoService).command(CreateList).emits("ListNamed", { name: z.string() })
m.slice().on(ListCreated).command("Archive", { listId: z.string() }).emits("Archived", { listId: z.string() })
m.slice().polls(TodoList).command("Remind", { listId: z.string() }).emits(ListCreated, () => ({ name: "" }))

// @ts-expect-error TodoList has no column done
m.slice().projects(TodoList).on(ListCreated, () => ({ done: true }))

// --- .service(): a view names its method -------------------------------------

// @ts-expect-error stopping at .service() with no method is not a slice
m.model("x", { chapters: { Ch: [m.slice().actor(User).reads(TodoList).service(TodoService)] } })

// --- .test() -----------------------------------------------------------------

const create = m.slice().actor(User).service(TodoService).command(CreateList).emits(ListCreated)

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
m.slice().projects(TodoList).on(ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({}), then: TodoList({}) })

// @ts-expect-error a read model cannot reject
m.slice().projects(TodoList).on(ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), then: TodoList({}), reject: "nope" })

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
m.slice().projects(TodoList).on(ListCreated, () => ({ itemCount: 0 })).on(ItemAdded, (e, { count }) => ({ itemCount: count(e), name: e.title }))
