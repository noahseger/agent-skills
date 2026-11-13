// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { m, type SliceStart } from "#em"
import { z } from "zod"

const User = m.actor()
const Admin = m.actor({ icon: "admin" })
const Syncer = m.actor({ icon: "system" })
const TodoService = m.service("todo.v1")
const CreateList = m.command({ listId: z.string(), name: z.string() })
const ListCreated = m.event({ listId: z.string(), name: z.string() })
const AddItem = m.command({ listId: z.string(), text: z.string() })
const ItemAdded = m.event({ listId: z.string(), title: z.string() })
const TodoList = m.view({ listId: z.string(), name: z.string(), itemCount: z.number().int() }).key("listId")
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

// @ts-expect-error a command is not an event, in any place
m.slice().command(CreateList, ListCreated, CreateList)

// @ts-expect-error a command is not a view
m.slice().view(CreateList, ListCreated)

// @ts-expect-error an event is not a view
m.slice().view(ListCreated, ListCreated)

// @ts-expect-error a state view shows one view: what follows it is an event
m.slice().view(TodoList, TodoList)

// @ts-expect-error a command starts no automation: an event or a view does
m.slice().automation(CreateList, NameList, ListCreated)

// --- the chain: a slice starts with its whole pattern -------------------------

// @ts-expect-error there is no .event(): a slice's events are all in its first call
m.slice().command(CreateList, ListCreated).event(ItemAdded)

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
m.slice().automation(ListCreated)

// @ts-expect-error an automation's command records an event
m.slice().automation(ListCreated, NameList)

// @ts-expect-error a state view is built by an event
m.slice().view(TodoList)

// @ts-expect-error a state view shows a view
m.slice().view()

// @ts-expect-error a slice not yet started joins no chapter
m.slice().chapter(Ch)

// Each start offers only its own next steps.

// @ts-expect-error a machine of ours runs an automation, not a person
m.slice().automation(ListCreated, NameList, ListCreated).actor(User)

// @ts-expect-error an automation polls a view without a service
m.slice().automation(TodoList, NameList, ListCreated).service(TodoService)

// @ts-expect-error a state view issues no command
m.slice().view(TodoList, ListCreated).command(CreateList, ListCreated)

// @ts-expect-error an automation has no screen: no one sees it
m.slice().automation(ListCreated, NameList, ListCreated).screen(Lock)

// @ts-expect-error a state change has no query
m.slice().command(CreateList, ListCreated).query({ listId: z.string() })

// @ts-expect-error a state change is not started twice
m.slice().command(CreateList, ListCreated).command(AddItem, ItemAdded)

// Complete, with no actor, service or chapter: none is required. A chapter joins anywhere after the start.
m.slice().command(CreateList, ListCreated)
m.slice().command(CreateList, ListCreated).chapter(Ch).view(TodoList).actor(User, Admin).service(TodoService)
m.slice().command(CreateList, ListCreated).actor(User).screen(Lock).service(TodoService, "StartList").chapter(Ch)
m.slice().view(TodoList, ListCreated).chapter(Ch)
m.slice().view(TodoList, ListCreated, ItemAdded).chapter(Ch).query({ listId: z.string() }).actor(User)
m.slice().view(TodoList, ListCreated).actor(User).screen(Lock).service(TodoService, "GetList")
m.slice().automation(ListCreated, NameList, ListCreated).chapter(Ch).view(TodoList)
m.slice().automation(TodoList, NameList, ListCreated).view(TodoList).chapter(Ch)
m.slice().automation(ListCreated, NameList, ListCreated).actor(Syncer)
m.model("x", { description: "A model lists no chapters." })

// @ts-expect-error a state view names its method: it has no command to take one from
m.slice().view(TodoList, ListCreated).service(TodoService)

// --- a function: its argument is the source, its result is the target --------

// @ts-expect-error ItemAdded has no field nope, and the mapping must set title
m.slice().command(AddItem, ItemAdded((c) => ({ nope: c.text })))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().command(AddItem, ItemAdded)
// The editor's error is the instruction: the parameter's type is the sentence.
declare const start: SliceStart
const said: Parameters<typeof start.command<typeof AddItem.__fields, [typeof ItemAdded]>>[1] = "add title to the command or set it in the mapping"

// @ts-expect-error every event is checked the same
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text })), ItemAdded)

// @ts-expect-error wherever it is: the third of four lacks title
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text })), ListCreated((c) => ({ name: c.text })), ItemAdded, ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().command(AddItem, ItemAdded((c) => ({ listId: c.listId })))

m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text })))
// An optional field may go unfilled in one slice; assembly checks that another fills it.
const ItemShared = m.event({ listId: z.string(), title: z.string().optional() })
m.slice().command(CreateList, ItemShared)
// m.generate() fills the field the command lacks.
m.slice().command(AddItem, ItemAdded(() => ({ title: m.generate() })))
// m.generate() says what the value is made from: the command's fields, and the views the slice reads.
m.slice().command(AddItem, ItemAdded((c) => ({ title: m.generate(c.text, TodoList) }))).view(TodoList)

// @ts-expect-error a mapper only works inside a slice
ItemAdded((c) => ({ title: m.generate(c.text) }))

// @ts-expect-error a mapper only works inside a slice, for a state view's event too
ItemAdded(() => ({ itemCount: z.literal(0) }))
m.slice().command(CreateList, ListCreated, ItemAdded((c) => ({ title: c.name })))

// @ts-expect-error a mapping takes one argument: generate is m.generate
m.slice().command(AddItem, ItemAdded((c, { generate }) => ({ title: generate() })))

// @ts-expect-error title is a string
m.slice().command(AddItem, ItemAdded((c) => ({ title: z.literal(42) })))

// @ts-expect-error the argument is the command's fields, and AddItem has no name
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.name })))

// @ts-expect-error the mapping is the declaration's call, not a third argument
m.slice().command(AddItem, ItemAdded, (c: { text: string }) => ({ title: c.text }))

// An automation's command: every field its trigger event, or polled row, lacks is set by the mapping.

// @ts-expect-error ListCreated has no text, so AddItem.text has no value
m.slice().automation(ListCreated, AddItem, ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the mapping must set text, which ListCreated lacks
m.slice().automation(ListCreated, AddItem((e) => ({ listId: e.listId })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the argument is the trigger's fields, and ListCreated has no title
m.slice().automation(ListCreated, AddItem((e) => ({ text: e.title })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the polled row has no text, so AddItem.text has no value
m.slice().automation(TodoList, AddItem, ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the argument is the polled row, and TodoList has no title
m.slice().automation(TodoList, AddItem((row) => ({ text: row.title })), ItemAdded((c) => ({ title: c.text })))

// m.generate() in an automation's command compiles; assembly leaves it to do.
m.slice().automation(ListCreated, AddItem(() => ({ text: m.generate() })), ItemAdded((c) => ({ title: c.text })))

// @ts-expect-error the automation's event is filled from its command, and AddItem has no title
m.slice().automation(ListCreated, AddItem((e) => ({ text: e.name })), ItemAdded)

m.slice().automation(ListCreated, AddItem((e) => ({ text: e.name })), ItemAdded((c) => ({ title: c.text })))
// An automation's optional command field may go unfilled too.
m.slice().automation(ListCreated, m.command({ listId: z.string(), text: z.string().optional() }), ItemShared)
m.slice().automation(TodoList, AddItem((row) => ({ text: row.name })), ListCreated((c) => ({ name: c.text })))

// --- a mapping's source is its schemas, and a constant is z.literal() -------------

const NoteCaptured = m.event({ noteId: z.uuid(), text: z.string(), status: z.enum(["inbox", "filed"]), count: z.number().int() })
const CaptureNote = m.command({ noteId: z.uuid(), text: z.string(), n: z.number(), at: z.iso.datetime() })

// @ts-expect-error a string is not a uuid
m.slice().command(CaptureNote, NoteCaptured((c) => ({ noteId: c.text, status: z.literal("inbox"), count: z.literal(0) })))

// @ts-expect-error a datetime is not a uuid either
m.slice().command(CaptureNote, NoteCaptured((c) => ({ noteId: c.at, status: z.literal("inbox"), count: z.literal(0) })))

// @ts-expect-error status is one of inbox or filed
m.slice().command(CaptureNote, NoteCaptured(() => ({ status: z.literal("nope"), count: z.literal(0) })))

// @ts-expect-error text is a string, not a number
m.slice().command(CaptureNote, NoteCaptured((c) => ({ text: c.n, status: z.literal("inbox"), count: z.literal(0) })))

// @ts-expect-error a mapping computes nothing: a string built from a field is not a schema
m.slice().command(CaptureNote, NoteCaptured((c) => ({ text: `${c.text}!`, status: z.literal("inbox"), count: z.literal(0) })))

// @ts-expect-error a constant is z.literal(), not a value
m.slice().command(CaptureNote, NoteCaptured(() => ({ status: "inbox", count: z.literal(0) })))

m.slice().command(CaptureNote, NoteCaptured((c) => ({ noteId: c.noteId, text: c.noteId, status: z.literal("filed"), count: z.literal(0) })))

// A field that flows by name must fit too.
const CaptureText = m.command({ noteId: z.string(), text: z.string() })
const TextCaptured = m.event({ noteId: z.uuid(), text: z.string() })

// @ts-expect-error CaptureText's noteId is a string, and TextCaptured's a uuid
m.slice().command(CaptureText, TextCaptured)
const misfit: Parameters<typeof start.command<typeof CaptureText.__fields, [typeof TextCaptured]>>[1] = "the command's noteId does not fit: set it in the mapping"
m.slice().command(CaptureText, TextCaptured(() => ({ noteId: m.generate() })))

// --- a call ends in the external event that brings the data back -------------

const Shop = m.external()

// @ts-expect-error "Shop" is a string, not an external system
m.event({ listId: z.string() }).external("Shop")

// @ts-expect-error an external system's events join it; they are not declared inside it
m.external({ CartUpdated: m.event({ listId: z.string() }) })

// An external event's fields come from outside, so the command need not carry them.
const CartUpdated = m.event({ listId: z.string(), unavailable: z.array(z.string()) }).external(Shop)
m.slice().command(AddItem, CartUpdated).actor(User)
m.slice().translation(CartUpdated, NameList((e) => ({ name: z.literal("") })), ListCreated)

// @ts-expect-error an external event starts a translation, not an automation
m.slice().automation(CartUpdated, NameList((e) => ({ name: z.literal("") })), ListCreated)

// @ts-expect-error a translation starts with an external event
m.slice().translation(ListCreated, NameList, ListCreated)

// @ts-expect-error nor does a view start one
m.slice().translation(TodoList, NameList, ListCreated)
const polled: Parameters<typeof start.translation<typeof TodoList, typeof NameList, [typeof ListCreated]>>[0] = "is a view: poll it with .automation()"

// @ts-expect-error ItemAdded is ours, so AddItem must still carry its title
m.slice().command(AddItem, CartUpdated, ItemAdded)

// The reply fills an event of ours in the same slice, in any order: by name, or in a mapping as CartUpdated.fields.
const CartKept = m.event({ listId: z.string(), unavailable: z.array(z.string()) })
const ItemsMissing = m.event({ listId: z.string(), items: z.array(z.string()) })
m.slice().command(AddItem, CartUpdated, CartKept).actor(User)
m.slice().command(AddItem, CartKept, CartUpdated)
m.slice().command(AddItem, ItemsMissing(() => ({ items: CartUpdated.fields.unavailable })), CartUpdated, ItemAdded((c) => ({ title: c.text })))
m.slice().automation(ListCreated, AddItem((e) => ({ text: z.literal("") })), CartUpdated, CartKept)
m.slice().command(AddItem, CartUpdated, ItemAdded(() => ({ title: m.generate(CartUpdated.fields.unavailable) })))

// @ts-expect-error without the reply, AddItem lacks unavailable
m.slice().command(AddItem, ItemAdded((c) => ({ title: c.text })), CartKept)

// @ts-expect-error a mapping's argument is the command alone: the reply's field is CartUpdated.fields.unavailable
m.slice().command(AddItem, CartUpdated, ItemsMissing((c) => ({ items: c.unavailable })))

// @ts-expect-error a mapping must still set what neither the command nor a reply carries
m.slice().command(AddItem, CartUpdated, ItemsMissing((c) => ({ listId: c.listId })))

// @ts-expect-error the reply's unavailable is a list, and a title a string
m.slice().command(AddItem, CartUpdated, ItemAdded(() => ({ title: CartUpdated.fields.unavailable })))

// @ts-expect-error a field of a declaration is a reference for a mapping, not a schema to declare with
m.view({ unavailable: CartUpdated.fields.unavailable })

// @ts-expect-error the seventeenth event is checked as the first: ItemAdded lacks title
m.slice().command(AddItem, CartUpdated, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, CartKept, ItemAdded)

// @ts-expect-error an external event isn't stored, so it builds no view
m.slice().view(TodoList, CartUpdated)

// @ts-expect-error nor beside an event of ours
m.slice().view(TodoList, ListCreated, CartUpdated)

// --- everything is declared with m.command or m.event, so a spec can name it --

// @ts-expect-error a command is not declared in place
m.slice().command("AddItem", { text: z.string() }, ItemAdded)

// @ts-expect-error an event is not declared in place
m.slice().command(CreateList, "ListNamed", { name: z.string() })

// @ts-expect-error nor is a second event
m.slice().command(CreateList, ListCreated, "ListNamed", { name: z.string() })

// @ts-expect-error an automation's command is not declared in place
m.slice().automation(ListCreated, "Archive", { listId: z.string() })

// --- a state view: its function reads the event and sets columns --------------

// @ts-expect-error TodoList has no column done
m.slice().view(TodoList, ListCreated(() => ({ done: z.literal(true) })))

// @ts-expect-error itemCount is a number
m.slice().view(TodoList, ListCreated(() => ({ itemCount: z.literal("0") })))

// @ts-expect-error every event is checked the same: itemCount is a number
m.slice().view(TodoList, ListCreated, ItemAdded(() => ({ itemCount: z.literal("0") })))

// A field that flows by name into a column must fit it.
const Basket = m.view({ listId: z.uuid(), name: z.string() })

// @ts-expect-error ListCreated's listId is a string, and Basket's a uuid
m.slice().view(Basket, ListCreated)
const unfit: Parameters<typeof start.view<typeof Basket.__fields, [typeof ListCreated]>>[1] = "the event's listId does not fit: set it in the mapping"

// @ts-expect-error beside a mapped event too
m.slice().view(Basket, ListCreated(() => ({ listId: m.generate() })), ListCreated)

// @ts-expect-error a mapping that leaves it to flow must set it
m.slice().view(Basket, ListCreated(() => ({ name: z.literal("x") })))
m.slice().view(Basket, ListCreated(() => ({ listId: m.generate() })), ItemAdded(() => ({ listId: m.generate() })))

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

// @ts-expect-error a state view's when is its query's values, never a command
m.slice().view(TodoList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({}), then: TodoList({}) })

// A state view's when is its query's values; its then, rows of the view it shows.
const Shelf = m.view({ shelfId: z.string() }).key("shelfId")
const inbox = m.slice().view(TodoList, ListCreated).query({ name: z.string() })

// @ts-expect-error name is a string
inbox.test("x", { when: { name: 1 }, then: [] })

// @ts-expect-error the query has no field nope
inbox.test("x", { when: { name: "a", nope: 1 }, then: [] })

// @ts-expect-error a state view with a query is asked with its values
inbox.test("x", { then: [] })

// @ts-expect-error a state view with no query has no when
m.slice().view(TodoList, ListCreated).test("x", { when: { name: "a" }, then: [] })

// @ts-expect-error then is rows of what the view shows, and it does not show Shelf
inbox.test("x", { when: { name: "a" }, then: Shelf({ shelfId: "s-1" }) })

// @ts-expect-error then is rows, not events
inbox.test("x", { when: { name: "a" }, then: ListCreated({ listId: "l-1" }) })

// @ts-expect-error a state view cannot reject: a view cannot refuse an event
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

// @ts-expect-error a key is one of the view's columns
m.view({ shelfId: z.string() }).key("nope")

// @ts-expect-error a key is named on the view with .key(), not marked on m
m.key

// @ts-expect-error a table built from events is declared with m.view
m.readModel({ shelfId: z.string() })

// @ts-expect-error what a handler reads is named with .view()
m.slice().command(CreateList, ListCreated).readModel(TodoList)

// The legal forms of the same calls, so a check that fires too widely also fails.
create.test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({ listId: "l-2" }), then: [ListCreated({ listId: "l-2" })] })
create.test("x", { given: [ListCreated({ listId: "l-1" })], when: CreateList({ listId: "l-1" }), reject: "nope" })
m.slice().automation(ListCreated, NameList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), when: NameList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })
m.slice().view(TodoList, ListCreated(() => ({ itemCount: z.literal(0) })), ItemAdded((e) => ({ itemCount: m.generate(e), name: e.title })))
inbox.test("x", { given: [ListCreated({ listId: "l-1", name: "a" }), ItemAdded({ listId: "l-1" })], when: { name: "a" }, then: [TodoList({ listId: "l-1" })] })
m.slice().view(TodoList, ListCreated).test("x", { given: ListCreated({ listId: "l-1" }), then: TodoList({ listId: "l-1" }) })
m.event({ noteId: z.string() }).stream(Notes)
// A specification may be a function, and m.generate() is a value of any field's type.
create.test("x", () => { const listId = m.generate(); return { when: CreateList({ listId, name: m.generate() }), then: ListCreated({ listId }) } })
inbox.test("x", { given: ListCreated({ listId: m.generate() }), when: { name: m.generate() }, then: [] })
