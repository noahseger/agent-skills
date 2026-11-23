// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { type Commanded, m, type Start, t, type Triggered, type Viewing } from "#em"

const User = m.actor()
const Admin = m.actor({ icon: "admin" })
const Syncer = m.actor({ icon: "system" })
const TodoService = m.service("todo.v1")
const CreateList = m.command({ listId: t.string(), name: t.string() })
const ListCreated = m.event({ listId: t.string(), name: t.string() })
const AddItem = m.command({ listId: t.string(), text: t.string() })
const ItemAdded = m.event({ listId: t.string(), title: t.string() })
const TodoList = m.view({ listId: t.string(), name: t.string(), itemCount: t.int() }).key("listId")
const NameList = m.command({ listId: t.string(), name: t.string() })
const Lock = m.screen()
const Ch = m.chapter(1).note("A run of slices.")

/** A step's parameter when it is called bare: the editor's error is this type, the sentence. */
type Bare<F> = F extends { (a: infer A): unknown; (a: never, b: never): unknown } ? A : never
declare const start: Start

// --- any reference: a reference is a value, so a string is not one -----------

// @ts-expect-error "User" is a string, not an actor
m.slice().command({ CreateList }).event({ ListCreated }).actor("User")

const Notes = m.stream()

// @ts-expect-error "Lock" is a string, not a screen
m.slice().command({ CreateList }).event({ ListCreated }).actor(User).screen("Lock")

// @ts-expect-error "Notes" is a string, not a stream, so a typo cannot make a lane
m.event({ noteId: t.string() }).stream("Notes")

// @ts-expect-error "Ch" is a string, not a chapter, so a typo cannot make a heading
m.slice().command({ CreateList }).event({ ListCreated }).chapter("Ch")

// @ts-expect-error a model lists no chapters: a slice joins one where it is written
m.model("x", { chapters: { Ch: [m.slice().command({ CreateList }).event({ ListCreated })] } })

// A chapter's number places it in the story, and while storming it may have none yet
m.chapter()

// @ts-expect-error a command is drawn in the lane of the event it records
CreateList.stream(Notes)

// --- a step takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
m.slice().command({ ListCreated })

// @ts-expect-error a command is not an event
m.slice().command({ CreateList }).event({ CreateList })

// @ts-expect-error a command is not an event, in any place
m.slice().command({ CreateList }).event({ ListCreated }).event({ CreateList })

// @ts-expect-error a command is not a view
m.slice().view({ CreateList })

// @ts-expect-error an event is not a view
m.slice().view({ ListCreated })

// @ts-expect-error a state view shows one view: what follows it is an event
m.slice().view({ TodoList }).event({ TodoList })

// @ts-expect-error a command starts no automation: an event or a view does
m.slice().automation({ CreateList })

// --- a call takes its declaration as { Name }: a mapping reads it by that name --

// @ts-expect-error a bare declaration has no name the compiler knows
m.slice().command(CreateList)
const bare: Parameters<typeof start.command<typeof CreateList>>[0] = "pass it as { Name }, so the compiler knows its name"

// @ts-expect-error one declaration per call
m.slice().command({ CreateList, NameList })

// @ts-expect-error a mapping reads a field through its declaration
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.text }))

// @ts-expect-error a field two declarations before the step carry flows from neither: the mapping says which
m.slice().command({ CreateList }).query({ TodoList }, "listId").event({ ListCreated })

// --- the chain: a slice is written in story order -----------------------------

// @ts-expect-error a slice does not start with .event(): its command comes first
m.slice().event({ ItemAdded })

// @ts-expect-error nor does an automation's event come before its command
m.slice().automation({ ListCreated }).event({ ListCreated })

// @ts-expect-error a slice does not start with .actor()
m.slice().actor(User)

// @ts-expect-error a slice does not start with .query()
m.slice().query({ listId: t.string() })

// @ts-expect-error a slice does not start with .service()
m.slice().service(TodoService)

// @ts-expect-error a read comes before the events: .query() after an event
m.slice().command({ CreateList }).event({ ListCreated }).query({ TodoList }, "listId")

// @ts-expect-error a state view reads nothing: its events build it
m.slice().view({ TodoList }).query({ TodoList }, "listId")

// An incomplete slice compiles and is drawn as far as it goes. From its first step it takes a chapter, an
// actor, a screen, a service and a note, each keeping its stage; .test() waits for its events.

// @ts-expect-error a slice not yet started joins no chapter
m.slice().chapter(Ch)

m.slice().command({ CreateList }).chapter(Ch)
m.slice().automation({ ListCreated }).chapter(Ch)
m.slice().automation({ ListCreated }).command({ NameList }).chapter(Ch)
m.slice().view({ TodoList }).chapter(Ch)
m.slice().command({ CreateList }).chapter(Ch).actor(User).screen(Lock).service(TodoService).note("x").event({ ListCreated })
m.slice().automation({ ListCreated }).chapter(Ch).actor(Syncer).command({ NameList }).event({ ListCreated })
m.slice().view({ TodoList }).chapter(Ch).actor(User).service(TodoService, "GetList").event({ ListCreated })

// @ts-expect-error a state change with no event has no specification yet
m.slice().command({ CreateList }).test("x", { when: CreateList({ listId: "l-1" }), then: [] })

// @ts-expect-error nor an automation with no command
m.slice().automation({ ListCreated }).test("x", { when: NameList({ listId: "l-1" }), then: [] })

// @ts-expect-error a machine of ours runs an automation, not a person, from its first step
m.slice().automation({ ListCreated }).actor(User)

// @ts-expect-error a state view shows a view
m.slice().view()

// Each start offers only its own next steps.

// @ts-expect-error a machine of ours runs an automation, not a person
m.slice().automation({ ListCreated }).command({ NameList }).event({ ListCreated }).actor(User)

// @ts-expect-error an automation polls a view without a service
m.slice().automation({ TodoList }).command({ NameList }).event({ ListCreated }).service(TodoService)

// @ts-expect-error a state view issues no command
m.slice().view({ TodoList }).event({ ListCreated }).command({ CreateList })

// @ts-expect-error an automation has no screen: no one sees it
m.slice().automation({ ListCreated }).command({ NameList }).event({ ListCreated }).screen(Lock)

// @ts-expect-error a state change has no context
m.slice().command({ CreateList }).event({ ListCreated }).context({ listId: t.string() })

// @ts-expect-error a state change is not started twice
m.slice().command({ CreateList }).event({ ListCreated }).command({ AddItem })

// Complete, with no actor, service or chapter: none is required. A chapter joins after the events.
m.slice().command({ CreateList }).event({ ListCreated })
m.slice().command({ CreateList }).query({ TodoList }, "listId").event({ ListCreated }, (c) => ({ name: c.CreateList.name })).chapter(Ch).actor(User, Admin).service(TodoService)
m.slice().command({ CreateList }).event({ ListCreated }).actor(User).screen(Lock).service(TodoService, "StartList").chapter(Ch)
m.slice().view({ TodoList }).event({ ListCreated }).chapter(Ch)
m.slice().view({ TodoList }).event({ ListCreated }).event({ ItemAdded }).context({ listId: t.string() }).chapter(Ch).actor(User)
m.slice().view({ TodoList }).event({ ListCreated }).actor(User).screen(Lock).service(TodoService, "GetList")
m.slice().automation({ ListCreated }).command({ NameList }).query({ TodoList }, "listId").event({ ListCreated }, (c) => ({ name: c.NameList.name })).chapter(Ch)
m.slice().automation({ TodoList }).command({ NameList }).event({ ListCreated }).chapter(Ch)
m.slice().automation({ ListCreated }).command({ NameList }).event({ ListCreated }).actor(Syncer)
m.model("x", { description: "A model lists no chapters." })

// @ts-expect-error a state view names its method: it has no command to take one from
m.slice().view({ TodoList }).event({ ListCreated }).service(TodoService)
declare const shown: Viewing<typeof TodoList.__fields>
const nameless: Bare<typeof shown.service> = 'a state view names its method: .service(Api, "ListX")'

// --- a mapping: its argument is what is before the step, its result is the target --

// @ts-expect-error ItemAdded has no field nope, and the mapping must set title
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ nope: c.AddItem.text }))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().command({ AddItem }).event({ ItemAdded })
// The editor's error is the instruction: the parameter's type is the sentence.
declare const adding: Commanded<readonly [readonly ["AddItem", typeof AddItem.__fields, never]], typeof AddItem.__fields, "change">
const said: Bare<typeof adding.event<{ ItemAdded: typeof ItemAdded }>> = "add title to a step before .event() or set it in the mapping"

// @ts-expect-error every event is checked the same: an event of ours is an outcome, so the second does not see the first's title
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text })).event({ ItemAdded })

// @ts-expect-error wherever it is: the third of four lacks title
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text })).event({ ListCreated }, (c) => ({ name: c.AddItem.text })).event({ ItemAdded }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ listId: c.AddItem.listId }))

// @ts-expect-error a whole declaration sets only what it carries, and AddItem has no title
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => c.AddItem)

m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))
// An optional field may go unfilled in one slice; assembly checks that another fills it.
const ItemShared = m.event({ listId: t.string(), title: t.string().optional() })
m.slice().command({ CreateList }).event({ ItemShared })
// m.generate() fills the field nothing before the step carries.
m.slice().command({ AddItem }).event({ ItemAdded }, () => ({ title: m.generate() }))
// m.generate() says what the value is made from: fields before the step, a queried row's included.
m.slice().command({ AddItem }).query({ TodoList }, "listId").event({ ItemAdded }, (c) => ({ title: m.generate(c.AddItem.text, c.TodoList.name) }))

// @ts-expect-error a mapping is the step's second argument: called with a function, a declaration is not an example
ItemAdded((c) => ({ title: m.generate(c.AddItem.text) }))
m.slice().command({ CreateList }).event({ ListCreated }).event({ ItemAdded }, (c) => ({ title: c.CreateList.name }))

// @ts-expect-error a mapping takes one argument: generate is m.generate
m.slice().command({ AddItem }).event({ ItemAdded }, (c, { generate }) => ({ title: generate() }))

// @ts-expect-error title is a string
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: t.literal(42) }))

// @ts-expect-error the argument is what is before the step, and AddItem has no name
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.name }))

// @ts-expect-error the mapping is the step's second argument, not the declaration's call
m.slice().command({ AddItem }).event(ItemAdded((c) => ({ title: c.AddItem.text })))

// An automation's command: every field what is before it lacks is set by the mapping.

// @ts-expect-error ListCreated has no text, so AddItem.text has no value
m.slice().automation({ ListCreated }).command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the mapping must set text, which ListCreated lacks
m.slice().automation({ ListCreated }).command({ AddItem }, (c) => ({ listId: c.ListCreated.listId })).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the argument is the trigger's fields, and ListCreated has no title
m.slice().automation({ ListCreated }).command({ AddItem }, (c) => ({ text: c.ListCreated.title })).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the polled row has no text, so AddItem.text has no value
m.slice().automation({ TodoList }).command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the argument is the polled row, and TodoList has no title
m.slice().automation({ TodoList }).command({ AddItem }, (c) => ({ text: c.TodoList.title })).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// m.generate() in an automation's command compiles; assembly leaves it to do.
m.slice().automation({ ListCreated }).command({ AddItem }, () => ({ text: m.generate() })).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the automation's event is filled from its command, and AddItem has no title
m.slice().automation({ ListCreated }).command({ AddItem }, (c) => ({ text: c.ListCreated.name })).event({ ItemAdded })

m.slice().automation({ ListCreated }).command({ AddItem }, (c) => ({ text: c.ListCreated.name })).event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))
// An automation's optional command field may go unfilled too.
const AddDraft = m.command({ listId: t.string(), text: t.string().optional() })
m.slice().automation({ ListCreated }).command({ AddDraft }).event({ ItemShared })
m.slice().automation({ TodoList }).command({ AddItem }, (c) => ({ text: c.TodoList.name })).event({ ListCreated }, (c) => ({ name: c.AddItem.text }))

// --- .query(): a view, and the filter that picks its rows ----------------------

const PriceChanged = m.event({ productId: t.uuid(), oldPrice: t.number(), newPrice: t.number() })
const CartsWithProducts = m.view({ aggregateId: t.uuid(), productId: t.uuid(), itemId: t.uuid() }).key("aggregateId", "productId")
const ArchiveItem = m.command({ aggregateId: t.uuid(), productId: t.uuid() })
const ItemArchived = m.event({ aggregateId: t.uuid(), itemId: t.uuid() })
const ItemRepriced = m.event({ aggregateId: t.uuid(), newPrice: t.number() })
const ProductRepriced = m.event({ changedProductId: t.uuid(), newPrice: t.number() })
const ArchiveCartItem = m.command({ cartId: t.uuid(), productId: t.uuid() })
const CartItemArchived = m.event({ cartId: t.uuid(), itemId: t.uuid() })
const ProductNamed = m.event({ productId: t.string() })

// Many rows, before an automation's command: one command per row. The row's columns join what is before.
m.slice("ArchiveItemScheduler").automation({ PriceChanged }).query({ CartsWithProducts }, "productId").command({ ArchiveItem }).event({ ItemArchived }, () => ({ itemId: m.generate() })).chapter(Ch)
// The mapping form, when names differ; a mapping only where they do.
m.slice().automation({ ProductRepriced }).query({ CartsWithProducts }, (c) => ({ productId: c.ProductRepriced.changedProductId })).command({ ArchiveCartItem }, (c) => ({ cartId: c.CartsWithProducts.aggregateId })).event({ CartItemArchived }, () => ({ itemId: m.generate() })).chapter(Ch)
// One row: every key column named. The row's itemId reaches the event.
m.slice().command({ ArchiveItem }).query({ CartsWithProducts }, (c) => ({ aggregateId: c.ArchiveItem.aggregateId, productId: c.ArchiveItem.productId })).event({ ItemArchived }).chapter(Ch)
// A view queried again replaces its earlier row in c. After an automation's command, the handler's one row brings itemId.
m.slice("ArchiveItemScheduler").automation({ PriceChanged }).query({ CartsWithProducts }, "productId").command({ ArchiveItem }).query({ CartsWithProducts }, (c) => ({ aggregateId: c.ArchiveItem.aggregateId, productId: c.ArchiveItem.productId })).event({ ItemArchived })
// In one step's context too: name flows from the later TodoList row alone.
m.slice().command({ AddItem }).query({ TodoList }, "listId").query({ TodoList }, "listId").event({ ListCreated })

// @ts-expect-error the view has no column price
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, "price")

// @ts-expect-error nothing before the query carries itemId: map it
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, "itemId")

// @ts-expect-error the view has no column cart, in the mapping form too
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, (c) => ({ cart: c.PriceChanged.productId }))

// @ts-expect-error many rows in a state change: the filter leaves out the key column aggregateId
m.slice().command({ ArchiveItem }).query({ CartsWithProducts }, "productId")

// @ts-expect-error in the mapping form too
m.slice().command({ ArchiveItem }).query({ CartsWithProducts }, (c) => ({ productId: c.ArchiveItem.productId }))

// @ts-expect-error many rows after an automation's command: its handler reads one
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, "productId").command({ ArchiveItem }).query({ CartsWithProducts }, "productId")

const Restock = m.command({ shelfId: t.string() })
const Shelves = m.view({ shelfId: t.string() })

// @ts-expect-error a view with no key is many rows
m.slice().command({ Restock }).query({ Shelves }, "shelfId")

// @ts-expect-error the filter is always stated
m.slice().automation({ PriceChanged }).query({ CartsWithProducts })
declare const priced: Triggered<readonly [readonly ["PriceChanged", typeof PriceChanged.__fields, never]]>
const unfiltered: Bare<typeof priced.query> = "say which rows: a column or a mapping, () => ({}) for every row"
// A mapping that names no column reads every row.
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, () => ({}))

// @ts-expect-error a price is not a uuid: the filter's value fits its column
m.slice().automation({ PriceChanged }).query({ CartsWithProducts }, (c) => ({ productId: c.PriceChanged.oldPrice }))

// @ts-expect-error by name too: ProductNamed's productId is a string, the column a uuid
m.slice().automation({ ProductNamed }).query({ CartsWithProducts }, "productId")

// @ts-expect-error the handler sees only the command: the trigger's newPrice does not reach the event
m.slice().automation({ PriceChanged }).command({ ArchiveItem }, () => ({ aggregateId: m.generate() })).event({ ItemRepriced })

// --- a mapping's source is its schemas, and a constant is t.literal() -------------

const NoteCaptured = m.event({ noteId: t.uuid(), text: t.string(), status: t.enum(["inbox", "filed"]), count: t.int() })
const CaptureNote = m.command({ noteId: t.uuid(), text: t.string(), n: t.number(), at: t.datetime() })

// @ts-expect-error a string is not a uuid
m.slice().command({ CaptureNote }).event({ NoteCaptured }, (c) => ({ noteId: c.CaptureNote.text, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a datetime is not a uuid either
m.slice().command({ CaptureNote }).event({ NoteCaptured }, (c) => ({ noteId: c.CaptureNote.at, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error status is one of inbox or filed
m.slice().command({ CaptureNote }).event({ NoteCaptured }, () => ({ status: t.literal("nope"), count: t.literal(0) }))

// @ts-expect-error text is a string, not a number
m.slice().command({ CaptureNote }).event({ NoteCaptured }, (c) => ({ text: c.CaptureNote.n, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a mapping computes nothing: a string built from a field is not a schema
m.slice().command({ CaptureNote }).event({ NoteCaptured }, (c) => ({ text: `${c.CaptureNote.text}!`, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a constant is t.literal(), not a value
m.slice().command({ CaptureNote }).event({ NoteCaptured }, () => ({ status: "inbox", count: t.literal(0) }))

m.slice().command({ CaptureNote }).event({ NoteCaptured }, (c) => ({ noteId: c.CaptureNote.noteId, text: c.CaptureNote.noteId, status: t.literal("filed"), count: t.literal(0) }))

// A field that flows by name must fit too.
const CaptureText = m.command({ noteId: t.string(), text: t.string() })
const TextCaptured = m.event({ noteId: t.uuid(), text: t.string() })

// @ts-expect-error CaptureText's noteId is a string, and TextCaptured's a uuid
m.slice().command({ CaptureText }).event({ TextCaptured })
declare const capturing: Commanded<readonly [readonly ["CaptureText", typeof CaptureText.__fields, never]], typeof CaptureText.__fields, "change">
const misfit: Bare<typeof capturing.event<{ TextCaptured: typeof TextCaptured }>> = "noteId does not fit: set it to a field of its type, a t.literal() or m.generate()"
m.slice().command({ CaptureText }).event({ TextCaptured }, () => ({ noteId: m.generate() }))

// --- a call ends in the external event that brings the data back -------------

const Shop = m.external()

// @ts-expect-error "Shop" is a string, not an external system
m.event({ listId: t.string() }).external("Shop")

// @ts-expect-error an external system's events join it; they are not declared inside it
m.external({ CartUpdated: m.event({ listId: t.string() }) })

// An external event's fields come from outside, so nothing before it need carry them.
const CartUpdated = m.event({ listId: t.string(), unavailable: t.array(t.string()) }).external(Shop)
m.slice().command({ AddItem }).event({ CartUpdated }).actor(User)
m.slice().translation({ CartUpdated }).command({ NameList }, () => ({ name: t.literal("") })).event({ ListCreated })

// @ts-expect-error an external event starts a translation, not an automation
m.slice().automation({ CartUpdated })

// @ts-expect-error a translation starts with an external event
m.slice().translation({ ListCreated })

// @ts-expect-error nor does a view start one
m.slice().translation({ TodoList })
const polled: Parameters<typeof start.translation<{ TodoList: typeof TodoList }>>[0] = "is a view: poll it with .automation()"

// @ts-expect-error ItemAdded is ours, so it still needs a title: the outside event the call gets back has none
m.slice().command({ AddItem }).event({ CartUpdated }).event({ ItemAdded })

// The fields of the outside event a call gets back join what is before the events after it: by name, or in a mapping's argument.
const CartKept = m.event({ listId: t.string(), unavailable: t.array(t.string()) })
const ItemsMissing = m.event({ listId: t.string(), items: t.array(t.string()) })
m.slice().command({ AddItem }).event({ CartUpdated }).event({ CartKept }, (c) => ({ listId: c.AddItem.listId })).actor(User)

// @ts-expect-error AddItem and the CartUpdated it gets back both carry listId: the mapping says which
m.slice().command({ AddItem }).event({ CartUpdated }).event({ CartKept })
declare const calling: Commanded<readonly [readonly ["AddItem", typeof AddItem.__fields, never], readonly ["CartUpdated", typeof CartUpdated.__fields, never]], typeof AddItem.__fields, "change">
const twice: Bare<typeof calling.event<{ CartKept: typeof CartKept }>> = "listId comes from AddItem and CartUpdated: set it in the mapping"

m.slice().command({ AddItem }).event({ CartUpdated }).event({ ItemsMissing }, (c) => ({ listId: c.AddItem.listId, items: c.CartUpdated.unavailable })).event({ ItemAdded }, (c) => ({ listId: c.AddItem.listId, title: c.AddItem.text }))
m.slice().automation({ ListCreated }).command({ AddItem }, () => ({ text: t.literal("") })).event({ CartUpdated }).event({ CartKept }, (c) => ({ listId: c.AddItem.listId }))
m.slice().command({ AddItem }).event({ CartUpdated }).event({ ItemAdded }, (c) => ({ listId: c.AddItem.listId, title: m.generate(c.CartUpdated.unavailable) }))

// @ts-expect-error the outside event comes before the event that keeps it
m.slice().command({ AddItem }).event({ CartKept }).event({ CartUpdated })

// @ts-expect-error without the outside event, AddItem lacks unavailable
m.slice().command({ AddItem }).event({ ItemAdded }, (c) => ({ title: c.AddItem.text })).event({ CartKept })

// @ts-expect-error a mapping's argument is what is before the step: no outside event yet, so no unavailable
m.slice().command({ AddItem }).event({ ItemsMissing }, (c) => ({ items: c.CartUpdated.unavailable })).event({ CartUpdated })

// @ts-expect-error a mapping must still set what nothing before the step carries
m.slice().command({ AddItem }).event({ CartUpdated }).event({ ItemsMissing }, (c) => ({ listId: c.AddItem.listId }))

// @ts-expect-error CartUpdated's unavailable is a list, and a title a string
m.slice().command({ AddItem }).event({ CartUpdated }).event({ ItemAdded }, (c) => ({ listId: c.AddItem.listId, title: c.CartUpdated.unavailable }))

// @ts-expect-error a declaration has no .fields: a mapping reads an outside event's field from its argument
m.view({ unavailable: CartUpdated.fields.unavailable })

// @ts-expect-error the eighteenth event is checked as the first: ItemAdded lacks title
m.slice().command({ CreateList }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ListCreated }).event({ ItemAdded })

// @ts-expect-error an external event isn't stored, so it builds no view
m.slice().view({ TodoList }).event({ CartUpdated })

// @ts-expect-error nor beside an event of ours
m.slice().view({ TodoList }).event({ ListCreated }).event({ CartUpdated })

// The outside event a call gets back fills an event of ours by name: pageId comes from PageCreated.
const Wiki = m.external()
const PageCreated = m.event({ pageId: t.string() }).external(Wiki)
const SyncNote = m.command({ noteId: t.uuid(), text: t.string() })
const NoteLinked = m.event({ noteId: t.uuid(), pageId: t.string() })
m.slice().command({ SyncNote }).event({ PageCreated }).event({ NoteLinked }).chapter(Ch)

// --- everything is declared with m.command or m.event, so a spec can name it --

// @ts-expect-error a command is not declared in place
m.slice().command("AddItem", { text: t.string() })

// @ts-expect-error an event is not declared in place
m.slice().command({ CreateList }).event("ListNamed", { name: t.string() })

// @ts-expect-error nor is a second event
m.slice().command({ CreateList }).event({ ListCreated }).event("ListNamed", { name: t.string() })

// @ts-expect-error an automation's command is not declared in place
m.slice().automation({ ListCreated }).command("Archive", { listId: t.string() })

// --- a state view: its mapping reads the event and sets columns --------------

// @ts-expect-error TodoList has no column done
m.slice().view({ TodoList }).event({ ListCreated }, () => ({ done: t.literal(true) }))

// @ts-expect-error itemCount is a number
m.slice().view({ TodoList }).event({ ListCreated }, () => ({ itemCount: t.literal("0") }))

// @ts-expect-error every event is checked the same: itemCount is a number
m.slice().view({ TodoList }).event({ ListCreated }).event({ ItemAdded }, () => ({ itemCount: t.literal("0") }))

// A field that flows by name into a column must fit it.
const Basket = m.view({ listId: t.uuid(), name: t.string() })

// @ts-expect-error ListCreated's listId is a string, and Basket's a uuid
m.slice().view({ Basket }).event({ ListCreated })
declare const basket: Viewing<typeof Basket.__fields>
const unfit: Bare<typeof basket.event<{ ListCreated: typeof ListCreated }>> = "listId does not fit: set it to a field of its type, a t.literal() or m.generate()"

// @ts-expect-error beside a mapped event too
m.slice().view({ Basket }).event({ ListCreated }, () => ({ listId: m.generate() })).event({ ListCreated })

// @ts-expect-error a mapping that leaves it to flow must set it
m.slice().view({ Basket }).event({ ListCreated }, () => ({ name: t.literal("x") }))
m.slice().view({ Basket }).event({ ListCreated }, () => ({ listId: m.generate() })).event({ ItemAdded }, () => ({ listId: m.generate() }))

// --- .test() -----------------------------------------------------------------

const create = m.slice().command({ CreateList }).event({ ListCreated }).actor(User).service(TodoService)

// @ts-expect-error when is the slice's command
create.test("x", { when: AddItem({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })

// @ts-expect-error then is the slice's events, not any event
create.test("x", { when: CreateList({ listId: "l-1" }), then: ItemAdded({ listId: "l-1" }) })

// @ts-expect-error a specification has then or reject, not both
create.test("x", { when: CreateList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }), reject: "nope" })

// @ts-expect-error a specification has then or reject, not neither
create.test("x", { when: CreateList({ listId: "l-1" }) })

// @ts-expect-error a rejection is written in the specification, not declared on m
m.reject

// @ts-expect-error a state view's when is its context's values, never a command
m.slice().view({ TodoList }).event({ ListCreated }).test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({}), then: TodoList({}) })

// A state view's when is its context's values; its then, rows of the view it shows.
const Shelf = m.view({ shelfId: t.string() }).key("shelfId")
const inbox = m.slice().view({ TodoList }).event({ ListCreated }).context({ name: t.string() })

// @ts-expect-error name is a string
inbox.test("x", { when: { name: 1 }, then: [] })

// @ts-expect-error the context has no field nope
inbox.test("x", { when: { name: "a", nope: 1 }, then: [] })

// @ts-expect-error a state view with a context is asked with its values
inbox.test("x", { then: [] })

// @ts-expect-error a state view with no context has no when
m.slice().view({ TodoList }).event({ ListCreated }).test("x", { when: { name: "a" }, then: [] })

// @ts-expect-error then is rows of what the view shows, and it does not show Shelf
inbox.test("x", { when: { name: "a" }, then: Shelf({ shelfId: "s-1" }) })

// @ts-expect-error then is rows, not events
inbox.test("x", { when: { name: "a" }, then: ListCreated({ listId: "l-1" }) })

// @ts-expect-error a state view cannot reject: a view cannot refuse an event
inbox.test("x", { when: { name: "a" }, then: [], reject: "nope" })

// @ts-expect-error an example is not a use in a slice
m.slice().command({ CreateList }).event(ListCreated({ listId: "l-1" }))

// --- t: every field has a protobuf type and a JSON Schema --------------------

// @ts-expect-error a field computes nothing: no .transform()
t.string().transform((s: string) => s.length)

// @ts-expect-error nor .refine()
t.string().refine((s: string) => s.length > 0)

// @ts-expect-error nor .default(): a value the handler makes is m.generate()
t.int().default(0)

// @ts-expect-error nor .nullable(): a field that may have no value is .optional()
t.string().nullable()

// @ts-expect-error nor .brand()
t.uuid().brand("NoteId")

// @ts-expect-error t has no custom field, which would have no protobuf type
t.custom()

// @ts-expect-error nor a union: t.oneOf() names its cases
t.union([t.string(), t.int()])

// @ts-expect-error nor coercion
t.coerce.number()

const GameEnded = m.event({ id: t.uuid(), email: t.email(), site: t.url(), day: t.date(), at: t.datetime(), takes: t.duration(), n: t.number(), i: t.int(), on: t.boolean(), side: t.enum(["white", "black"]), x: t.literal("x"), sans: t.array(t.string()), rows: t.array({ ply: t.int() }), by: t.object({ id: t.string() }), clocks: t.record(t.int()), result: t.oneOf({ win: t.enum(["white", "black"]), draw: t.object({}) }), note: t.string().optional().describe("Why") })
GameEnded({ result: { win: "white" }, rows: [{ ply: 1 }], by: { id: "a" }, clocks: { white: 1 } })

// @ts-expect-error a oneOf holds exactly one of its cases
GameEnded({ result: { win: "white", draw: {} } })

// --- calling a declaration: its fields, with t's types -----------------------

// @ts-expect-error nickname is not a field of CreateList
CreateList({ listId: "l-1", nickname: "shopping" })

// @ts-expect-error listId is a string
CreateList({ listId: 42 })

// @ts-expect-error a declaration is called for an example; there is no .with()
CreateList.with({ listId: "l-1" })

// @ts-expect-error a key is one of the view's columns
m.view({ shelfId: t.string() }).key("nope")

// @ts-expect-error a key is named on the view with .key(), not marked on m
m.key

// @ts-expect-error a table built from events is declared with m.view
m.readModel({ shelfId: t.string() })

// @ts-expect-error what a handler reads is named with .query()
m.slice().command({ CreateList }).readModel(TodoList)

// @ts-expect-error not with .view(), which starts a state view
m.slice().command({ CreateList }).view({ TodoList })

// The legal forms of the same calls, so a check that fires too widely also fails.
create.test("x", { given: ListCreated({ listId: "l-1" }), when: CreateList({ listId: "l-2" }), then: [ListCreated({ listId: "l-2" })] })
create.test("x", { given: [ListCreated({ listId: "l-1" })], when: CreateList({ listId: "l-1" }), reject: "nope" })
m.slice().automation({ ListCreated }).command({ NameList }).event({ ListCreated }).test("x", { given: ListCreated({ listId: "l-1" }), when: NameList({ listId: "l-1" }), then: ListCreated({ listId: "l-1" }) })
m.slice().view({ TodoList }).event({ ListCreated }, () => ({ itemCount: t.literal(0) })).event({ ItemAdded }, (c) => ({ itemCount: m.generate(c.ItemAdded), name: c.ItemAdded.title }))
inbox.test("x", { given: [ListCreated({ listId: "l-1", name: "a" }), ItemAdded({ listId: "l-1" })], when: { name: "a" }, then: [TodoList({ listId: "l-1" })] })
// then may describe an outcome its examples cannot show.
create.test("x", { when: CreateList({ listId: "l-1" }), then: ["The list is new", ListCreated({ listId: "l-1" })] })
inbox.test("x", { when: { name: "a" }, then: "No list is named a" })
m.slice().view({ TodoList }).event({ ListCreated }).test("x", { given: ListCreated({ listId: "l-1" }), then: TodoList({ listId: "l-1" }) })
m.event({ noteId: t.string() }).stream(Notes)
// A specification may be a function, and m.generate() is a value of any field's type.
create.test("x", () => { const listId = m.generate(); return { when: CreateList({ listId, name: m.generate() }), then: ListCreated({ listId }) } })
inbox.test("x", { given: ListCreated({ listId: m.generate() }), when: { name: m.generate() }, then: [] })
