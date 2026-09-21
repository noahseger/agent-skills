// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { m } from "#em"
import { z } from "zod"

const User = m.actor()
const TodoService = m.service("todo.v1")
const ListsScreen = m.screen(User, TodoService)
const Completer = m.automation()
const CreateList = m.command({ listId: z.string(), name: z.string() })
const ListCreated = m.event({ listId: z.string(), name: z.string() })
const AddItem = m.command({ listId: z.string(), text: z.string() })
const ItemAdded = m.event({ listId: z.string(), title: z.string() })
const TodoList = m.readModel({ listId: m.key(z.string()), name: z.string(), itemCount: z.number().int() })
const Nope = m.rejected("nope")

// --- any reference: a reference is a value, so a string is not one -----------

// @ts-expect-error "User" is a string, not an actor
m.screen("User")

// --- a slot takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
ListsScreen.command(ListCreated)

// @ts-expect-error a command is not an event
ListsScreen.command(CreateList).emits(CreateList)

// @ts-expect-error a command is not a read model
ListsScreen.view("List").reads(CreateList)

// @ts-expect-error a view is named; the name is its service method
ListsScreen.view()

// --- a slice starts from its trigger, and each call offers only what can come next

// @ts-expect-error a screen slice has no .emits() before its command
ListsScreen.emits(ListCreated)

// @ts-expect-error a screen is not started by an event
ListsScreen.on(ListCreated)

// @ts-expect-error a view has no command; a screen that commands is a state change
ListsScreen.view("List").reads(TodoList).command(CreateList)

// @ts-expect-error an automation has no screen, so no .query()
Completer.query({ listId: z.string() })

// @ts-expect-error an automation decides after its trigger, not before
Completer.command(CreateList)

// @ts-expect-error a projection has no command
TodoList.command(CreateList)

// @ts-expect-error a declaration is not a slice until something starts from it
m.chapter([ListsScreen])

// A slice at any stage is a slice: the chapter takes it, and assembly says what it lacks.
m.chapter([ListsScreen.command(CreateList), ListsScreen.view("List"), Completer.on(ItemAdded)])

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope
ListsScreen.command(AddItem).emits(ItemAdded, (c) => ({ nope: c.text }))

// @ts-expect-error title is a string
ListsScreen.command(AddItem).emits(ItemAdded, (c) => ({ title: 42 }))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
ListsScreen.command(AddItem).emits(ItemAdded, (c) => ({ title: c.name }))

// @ts-expect-error TodoList has no column done
TodoList.on(ListCreated, () => ({ done: true }))

// --- .test() -----------------------------------------------------------------

const create = ListsScreen.command(CreateList).emits(ListCreated)

// @ts-expect-error when is the slice's command
create.test("x", { when: AddItem.with({ listId: "l-1" }), then: ListCreated.with({ listId: "l-1" }) })

// @ts-expect-error then is the slice's events, not any event
create.test("x", { when: CreateList.with({ listId: "l-1" }), then: ItemAdded.with({ listId: "l-1" }) })

// @ts-expect-error a rejection is m.rejected(), not a string
create.test("x", { when: CreateList.with({ listId: "l-1" }), then: "Error: nope" })

// @ts-expect-error a projection has no when
TodoList.on(ListCreated).test("x", { given: ListCreated.with({ listId: "l-1" }), when: CreateList.with({}), then: TodoList.with({}) })

// @ts-expect-error a view has no specification
ListsScreen.view("List").reads(TodoList).test("x", { given: ListCreated.with({ listId: "l-1" }), then: TodoList.with({}) })

// --- .with(): the declaration's fields, with Zod's types ---------------------

// @ts-expect-error nickname is not a field of CreateList
CreateList.with({ listId: "l-1", nickname: "shopping" })

// @ts-expect-error listId is a string
CreateList.with({ listId: 42 })

// The legal forms of the same calls, so a check that fires too widely also fails.
create.test("x", { given: ListCreated.with({ listId: "l-1" }), when: CreateList.with({ listId: "l-2" }), then: [ListCreated.with({ listId: "l-2" }), Nope] })
TodoList.on(ListCreated, () => ({ itemCount: 0 })).on(ItemAdded, (e) => ({ itemCount: m.count(e), name: e.title }))
ListsScreen.view("List").query({ listId: z.string() }).reads(TodoList)
ListsScreen.reads(TodoList).command(CreateList).emits(ListCreated)
Completer.on(ItemAdded).reads(TodoList).command(CreateList).emits(ListCreated)
Completer.polls(TodoList).command(CreateList).emits(ListCreated)
