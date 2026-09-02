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
const Nope = m.rejected("nope")

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
m.chapter([m.slice().actor(User).service(TodoService).command(CreateList)])

// @ts-expect-error a projection with no .on() is not a slice
m.chapter([m.slice().projects(TodoList)])

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ nope: c.text }))

// @ts-expect-error title is a string
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ title: 42 }))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
m.slice().actor(User).service(TodoService).command(AddItem).emits(ItemAdded, (c) => ({ title: c.name }))

// @ts-expect-error TodoList has no column done
m.slice().projects(TodoList).on(ListCreated, () => ({ done: true }))

// --- .service(): a view names its method -------------------------------------

// @ts-expect-error stopping at .service() with no method is not a slice
m.chapter([m.slice().actor(User).reads(TodoList).service(TodoService)])

// --- .test() -----------------------------------------------------------------

const create = m.slice().actor(User).service(TodoService).command(CreateList).emits(ListCreated)

// @ts-expect-error when is the slice's command
create.test("x", { when: AddItem.with({ listId: "l-1" }), then: ListCreated.with({ listId: "l-1" }) })

// @ts-expect-error then is the slice's events, not any event
create.test("x", { when: CreateList.with({ listId: "l-1" }), then: ItemAdded.with({ listId: "l-1" }) })

// @ts-expect-error a rejection is m.rejected(), not a string
create.test("x", { when: CreateList.with({ listId: "l-1" }), then: "Error: nope" })

// @ts-expect-error a projection has no when
m.slice().projects(TodoList).on(ListCreated).test("x", { given: ListCreated.with({ listId: "l-1" }), when: CreateList.with({}), then: TodoList.with({}) })

// --- .with(): the declaration's fields, with Zod's types ---------------------

// @ts-expect-error nickname is not a field of CreateList
CreateList.with({ listId: "l-1", nickname: "shopping" })

// @ts-expect-error listId is a string
CreateList.with({ listId: 42 })

// The legal forms of the same calls, so a check that fires too widely also fails.
create.test("x", { given: ListCreated.with({ listId: "l-1" }), when: CreateList.with({ listId: "l-2" }), then: [ListCreated.with({ listId: "l-2" }), Nope] })
m.slice().projects(TodoList).on(ListCreated, () => ({ itemCount: 0 })).on(ItemAdded, (e) => ({ itemCount: m.count(e), name: e.title }))
