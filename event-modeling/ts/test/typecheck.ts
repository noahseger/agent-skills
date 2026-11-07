// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { m } from "#em"
import { z } from "zod"

const User = m.actor()
const Admin = m.actor({ icon: "admin" })
const Syncer = m.actor({ icon: "system" })
const TodoService = m.service("todo.v1")
const CreateList = m.command({ listId: z.string(), name: z.string() })
const ListCreated = m.event({ listId: z.string(), name: z.string() })
const AddItem = m.command({ listId: z.string(), text: z.string() })
const ItemAdded = m.event({ listId: z.string(), title: z.string() })
const TodoList = m.readModel({ listId: m.key(z.string()), name: z.string(), itemCount: z.number().int() })
const NameList = m.command({ listId: z.string(), name: z.string() })
const Lock = m.screen()
const Ch = m.chapter().note("A run of slices.")

// --- any reference: a reference is a value, so a string is not one -----------

// @ts-expect-error "User" is a string, not an actor
m.slice().command(CreateList, ListCreated).actor("User")

const Notes = m.stream()

// @ts-expect-error "Lock" is a string, not a screen
m.slice().command(CreateList, ListCreated).actor(User).screen("Lock")

// @ts-expect-error "Notes" is a string, not a stream, so a typo cannot make a lane
m.event({ noteId: z.string() }).stream("Notes")

// @ts-expect-error "Ch" is a string, not a chapter, so a typo cannot make a heading
m.slice().command(CreateList, ListCreated).chapter("Ch")

// @ts-expect-error a model lists no chapters: a slice joins one where it is written
m.model("x", { chapters: { Ch: [m.slice().command(CreateList, ListCreated)] } })

// @ts-expect-error a command is drawn in the lane of the event it records
CreateList.stream(Notes)

// --- a slot takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
m.slice().command(ListCreated, ListCreated)

// @ts-expect-error a command is not an event
m.slice().command(CreateList, CreateList)

// @ts-expect-error a command is not an event, after the start either
m.slice().command(CreateList, ListCreated).event(CreateList)

// @ts-expect-error a command is not a read model
m.slice().projection(CreateList, ListCreated)

// @ts-expect-error an event is not a read model
m.slice().view(ListCreated)

// @ts-expect-error a read model is not an event
m.slice().trigger(TodoList, NameList, ListCreated)

// --- the chain: a slice starts with its whole pattern -------------------------

// @ts-expect-error a slice does not start with .event()
m.slice().event(ListCreated)

// @ts-expect-error a slice does not start with .actor()
m.slice().actor(User)

// @ts-expect-error a slice does not start with .query()
m.slice().query({ listId: z.string() })

// @ts-expect-error a slice does not start with .service()
m.slice().service(TodoService)

// An incomplete slice cannot be written: each core argument is required.

// @ts-expect-error a state change records an event
m.slice().command(CreateList)

// @ts-expect-error an automation issues a command
m.slice().trigger(ListCreated)

// @ts-expect-error an automation's command records an event
m.slice().trigger(ListCreated, NameList)

// @ts-expect-error a to-do list's automation issues a command
m.slice().todoList(TodoList)

// @ts-expect-error a to-do list's command records an event
m.slice().todoList(TodoList, NameList)

// @ts-expect-error a projection is built by an event
m.slice().projection(TodoList)

// @ts-expect-error a view shows a read model
m.slice().view()

// @ts-expect-error a slice not yet started joins no chapter
m.slice().chapter(Ch)

// Each start offers only its own next steps.

// @ts-expect-error a machine of ours runs an automation, not a person
m.slice().trigger(ListCreated, NameList, ListCreated).actor(User)

// @ts-expect-error an automation works through a to-do list without a service
m.slice().todoList(TodoList, NameList, ListCreated).service(TodoService)

// @ts-expect-error a view records no event
m.slice().view(TodoList).event(ListCreated)

// @ts-expect-error a view issues no command
m.slice().view(TodoList).command(CreateList, ListCreated)

// @ts-expect-error an automation has no screen: no one sees it
m.slice().trigger(ListCreated, NameList, ListCreated).screen(Lock)

// @ts-expect-error a machine of ours runs a projection, not a person
m.slice().projection(TodoList, ListCreated).actor(User)

// @ts-expect-error a projection has no command
m.slice().projection(TodoList, ListCreated).command(CreateList, ListCreated)

// @ts-expect-error a state change has no query
m.slice().command(CreateList, ListCreated).query({ listId: z.string() })

// @ts-expect-error a state change is not started twice
m.slice().command(CreateList, ListCreated).command(AddItem, ItemAdded)

// Complete, with no actor, service or chapter: none is required. A chapter joins anywhere after the start.
m.slice().command(CreateList, ListCreated)
m.slice().command(CreateList, ListCreated).chapter(Ch).readModel(TodoList).actor(User, Admin).service(TodoService)
m.slice().command(CreateList, ListCreated).actor(User).screen(Lock).service(TodoService, "StartList").chapter(Ch)
m.slice().view(TodoList).chapter(Ch)
m.slice().view(TodoList, TodoList).chapter(Ch).query({ listId: z.string() }).actor(User)
m.slice().view(TodoList).actor(User).screen(Lock).service(TodoService, "GetList")
m.slice().trigger(ListCreated, NameList, ListCreated).chapter(Ch).readModel(TodoList)
m.slice().todoList(TodoList, NameList, ListCreated).readModel(TodoList).chapter(Ch)
m.slice().projection(TodoList, ListCreated).chapter(Ch).event(ItemAdded)
m.slice().trigger(ListCreated, NameList, ListCreated).actor(Syncer)
m.slice().projection(TodoList, ListCreated).actor(Syncer)
m.model("x", { description: "A model lists no chapters." })

// @ts-expect-error a view names its method: it has no command to take one from
m.slice().view(TodoList).service(TodoService)

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope, and the mapping must set title
m.slice().command(AddItem, ItemAdded((c) => ({ nope: c.text })))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().command(AddItem, ItemAdded)

// @ts-expect-error a later outcome is checked the same
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text }))).event(ItemAdded)

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().command(AddItem, ItemAdded((c) => ({ listId: c.listId })))

m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text })))
// An optional field may go unfilled in one slice; assembly checks that another fills it.
const ItemShared = m.event({ listId: z.string(), title: z.string().optional() })
m.slice().command(CreateList, ItemShared)
// generate() fills the field the command lacks.
m.slice().command(AddItem, ItemAdded((c, { generate }) => ({ title: generate() })))
// generate() says what the value is made from: the command's fields, and the read models the slice reads.
m.slice().command(AddItem, ItemAdded((c, { generate }) => ({ title: generate(c.text, TodoList) }))).readModel(TodoList)

// @ts-expect-error a mapper only works inside a slice
ItemAdded((c, { generate }) => ({ title: generate(c.text) }))

// @ts-expect-error a mapper only works inside a slice, for a projection's event too
ItemAdded(() => ({ itemCount: 0 }))
m.slice().command(CreateList, ListCreated).event(ItemAdded((c) => ({ title: c.name })))

// @ts-expect-error count is gone: a count is generate(e)
m.slice().projection(TodoList, ListCreated((e, { count }) => ({ itemCount: count(e) })))

// @ts-expect-error a mapping's helpers are its second argument, not on m
m.generate

// @ts-expect-error title is a string
m.slice().command(AddItem, ItemAdded((c) => ({ title: 42 })))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.name })))

// @ts-expect-error the mapping is the declaration's call, not a third argument
m.slice().command(AddItem, ItemAdded, (c: { text: string }) => ({ title: c.text }))

// An automation's command: every field its trigger, or to-do row, lacks is set by the mapping.

// @ts-expect-error ListCreated has no text, so AddItem.text has no value
m.slice().trigger(ListCreated, AddItem, ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the mapping must set text, which ListCreated lacks
m.slice().trigger(ListCreated, AddItem((e) => ({ listId: e.listId })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the argument is the trigger's fields, and ListCreated has no title
m.slice().trigger(ListCreated, AddItem((e) => ({ text: e.title })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the to-do row has no text, so AddItem.text has no value
m.slice().todoList(TodoList, AddItem, ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error an automation's command gets no helpers
m.slice().trigger(ListCreated, AddItem((e, { generate }) => ({ text: generate() })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the automation's event is filled from its command, and AddItem has no title
m.slice().trigger(ListCreated, AddItem((e) => ({ text: e.name })), ItemAdded)

m.slice().trigger(ListCreated, AddItem((e) => ({ text: e.name })), ItemAdded((c) => ({ title: c.text })))
// An automation's optional command field may go unfilled too.
m.slice().trigger(ListCreated, m.command({ listId: z.string(), text: z.string().optional() }), ItemShared)
m.slice().todoList(TodoList, AddItem((row) => ({ text: row.name })), ListCreated((c) => ({ name: c.text })))

// --- a call ends in the external event that brings the data back -------------

const Shop = m.external()

// @ts-expect-error "Shop" is a string, not an external system
m.event({ listId: z.string() }).external("Shop")

// @ts-expect-error an external system's events join it; they are not declared inside it
m.external({ CartUpdated: m.event({ listId: z.string() }) })

// An external event's fields come from outside, so the command need not carry them.
const CartUpdated = m.event({ listId: z.string(), unavailable: z.array(z.string()) }).external(Shop)
m.slice().command(AddItem, CartUpdated).actor(User)
m.slice().trigger(CartUpdated, NameList((e) => ({ name: "" })), ListCreated)

// @ts-expect-error ItemAdded is ours, so AddItem must still carry its title
m.slice().command(AddItem, CartUpdated).event(ItemAdded)

// @ts-expect-error an external event isn't stored, so it builds no read model
m.slice().projection(TodoList, CartUpdated)

// @ts-expect-error nor after the start
m.slice().projection(TodoList, ListCreated).event(CartUpdated)

// --- everything is declared with m.command or m.event, so a spec can name it --

// @ts-expect-error a command is not declared in place
m.slice().command("AddItem", { text: z.string() }, ItemAdded)

// @ts-expect-error an event is not declared in place
m.slice().command(CreateList, "ListNamed", { name: z.string() })

// @ts-expect-error a later event is not declared in place either
m.slice().command(CreateList, ListCreated).event("ListNamed", { name: z.string() })

// @ts-expect-error an automation's command is not declared in place
m.slice().trigger(ListCreated, "Archive", { listId: z.string() })

// --- a projection: its function reads the event and sets columns --------------

// @ts-expect-error TodoList has no column done
m.slice().projection(TodoList, ListCreated(() => ({ done: true })))

// @ts-expect-error itemCount is a number
m.slice().projection(TodoList, ListCreated(() => ({ itemCount: "0" })))

// @ts-expect-error a later event is checked the same: itemCount is a number
m.slice().projection(TodoList, ListCreated).event(ItemAdded(() => ({ itemCount: "0" })))

// --- .test() -----------------------------------------------------------------

const create = m.slice().command(CreateList, ListCreated).actor(User).service(TodoService)

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
m.slice().projection(TodoList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({}), then: TodoList({}) })

// @ts-expect-error a read model cannot reject
m.slice().projection(TodoList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), then: TodoList({}), reject: "nope" })

// A view's when is its query's values; its then, rows of the read models it shows.
const Shelf = m.readModel({ shelfId: m.key(z.string()) })
const inbox = m.slice().view(TodoList).query({ name: z.string() })

// @ts-expect-error name is a string
inbox.test("x", { when: { name: 1 }, then: [] })

// @ts-expect-error the query has no field nope
inbox.test("x", { when: { name: "a", nope: 1 }, then: [] })

// @ts-expect-error a view with a query is asked with its values
inbox.test("x", { then: [] })

// @ts-expect-error a view with no query has no when
m.slice().view(TodoList).test("x", { when: { name: "a" }, then: [] })

// @ts-expect-error then is rows of what the view shows, and it does not show Shelf
inbox.test("x", { when: { name: "a" }, then: Shelf({ shelfId: "s-1" }) })

// @ts-expect-error then is rows, not events
inbox.test("x", { when: { name: "a" }, then: ListCreated({ listId: "l-1" }) })

// @ts-expect-error a view cannot reject
inbox.test("x", { when: { name: "a" }, then: [], reject: "nope" })

// @ts-expect-error an example is not a use in a slice
m.slice().command(CreateList, ListCreated({ listId: "l-1" }))

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
m.slice().trigger(ListCreated, NameList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: NameList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })
m.slice().projection(TodoList, ListCreated(() => ({ itemCount: 0 }))).event(ItemAdded((e, { generate }) => ({ itemCount: generate(e), name: e.title })))
inbox.test("x", { given: [ListCreated({ listId: "l-1", name: "a" }), ItemAdded({ listId: "l-1" })], when: { name: "a" }, then: [TodoList({ listId: "l-1" })] })
m.slice().view(TodoList, Shelf).test("x", { then: [TodoList({ listId: "l-1" }), Shelf({ shelfId: "s-1" })] })
m.event({ noteId: z.string() }).stream(Notes)
