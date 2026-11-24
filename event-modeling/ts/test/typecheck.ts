// One case per row of the README's compiler table. `tsc` fails if an expected
// error stops happening, so this file is the test: a check is only real while
// its line refuses to compile. No formatter may touch this file: a directive
// binds to the next line, and moving a call off that line disarms the check.
import { type Commanded, d, m, type Start, t, type Triggered, type Viewing } from "#em"

// The declarations are in typecheck/model.ts, and em-registry.d.ts beside it types d.

/** A step's parameter when it is called bare: the editor's error is this type, the sentence. */
type Bare<F> = F extends { (a: infer A): unknown; (a: never, b: never): unknown } ? A : never
declare const start: Start

// --- any reference: a reference is d.Name, so a string is not one ------------

// @ts-expect-error "User" is a string, not an actor
m.slice().command(d.CreateList).event(d.ListCreated).actor("User")

// @ts-expect-error "Lock" is a string, not a screen
m.slice().command(d.CreateList).event(d.ListCreated).actor(d.User).screen("Lock")

// @ts-expect-error "Notes" is a string, not a stream, so a typo cannot make a lane
m.event("NoteKept", { noteId: t.string() }).stream("Notes")

// @ts-expect-error "Ch" is a string, not a chapter, so a typo cannot make a heading
m.slice().command(d.CreateList).event(d.ListCreated).chapter("Ch")

// @ts-expect-error a model lists no chapters: a slice joins one where it is written
m.model("x", { chapters: { Ch: [m.slice().command(d.CreateList).event(d.ListCreated)] } })

// A chapter's number places it in the story, and while storming it may have none yet
m.chapter("Storming")

// @ts-expect-error a command is drawn in the lane of the event it records
m.command("RenameList", { listId: t.string() }).stream(d.Notes)

// @ts-expect-error a lane is a stream, and an actor is not one
m.event("NoteKept", { noteId: t.string() }).stream(d.User)

// --- a step takes one kind ---------------------------------------------------

// @ts-expect-error an event is not a command
m.slice().command(d.ListCreated)

// @ts-expect-error a command is not an event
m.slice().command(d.CreateList).event(d.CreateList)

// @ts-expect-error a command is not an event, in any place
m.slice().command(d.CreateList).event(d.ListCreated).event(d.CreateList)

// @ts-expect-error a command is not a view
m.slice().view(d.CreateList)

// @ts-expect-error an event is not a view
m.slice().view(d.ListCreated)

// @ts-expect-error a state view shows one view: what follows it is an event
m.slice().view(d.TodoList).event(d.TodoList)

// @ts-expect-error a command starts no automation: an event or a view does
m.slice().automation(d.CreateList)

// --- a call takes its declaration as d.Name: a mapping reads it by that name --

// @ts-expect-error a step takes d.Name, not what declaring it returns
m.slice().command(m.command("RenameList", { listId: t.string() }))
const kind: Parameters<typeof start.command<typeof d.ListCreated>>[0] = "ListCreated: is an event; pass a command."

// @ts-expect-error one declaration per call
m.slice().command(d.CreateList, d.NameList)

// @ts-expect-error a name nothing declares is no member of d
m.slice().command(d.CreateLists)

// @ts-expect-error two commands with the same fields are still two
const same: typeof d.ArchiveItem = d.ArchiveCart

// @ts-expect-error and a mapping reads only what is before its step, by name
m.slice().command(d.ArchiveItem).event(d.ItemArchived, (c) => ({ itemId: c.ArchiveCart.aggregateId }))

// @ts-expect-error a mapping reads a field through its declaration
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.text }))

// @ts-expect-error a field two declarations before the step carry flows from neither: the mapping says which
m.slice().command(d.CreateList).query(d.TodoList, "listId").event(d.ListCreated)

// --- the chain: a slice is written in story order -----------------------------

// @ts-expect-error a slice does not start with .event(): its command comes first
m.slice().event(d.ItemAdded)

// @ts-expect-error nor does an automation's event come before its command
m.slice().automation(d.ListCreated).event(d.ListCreated)

// @ts-expect-error a slice does not start with .actor()
m.slice().actor(d.User)

// @ts-expect-error a slice does not start with .query()
m.slice().query({ listId: t.string() })

// @ts-expect-error a slice does not start with .service()
m.slice().service(d.TodoService)

// @ts-expect-error a read comes before the events: .query() after an event
m.slice().command(d.CreateList).event(d.ListCreated).query(d.TodoList, "listId")

// @ts-expect-error a state view reads nothing: its events build it
m.slice().view(d.TodoList).query(d.TodoList, "listId")

// An incomplete slice compiles and is drawn as far as it goes. From its first step it takes a chapter, an
// actor, a screen, a service and a note, each keeping its stage; .spec() waits for its events.

// @ts-expect-error a slice not yet started joins no chapter
m.slice().chapter(d.Ch)

m.slice().command(d.CreateList).chapter(d.Ch)
m.slice().automation(d.ListCreated).chapter(d.Ch)
m.slice().automation(d.ListCreated).command(d.NameList).chapter(d.Ch)
m.slice().view(d.TodoList).chapter(d.Ch)
m.slice().command(d.CreateList).chapter(d.Ch).actor(d.User).screen(d.Lock).service(d.TodoService).note("x").event(d.ListCreated)
m.slice().automation(d.ListCreated).chapter(d.Ch).actor(d.Syncer).command(d.NameList).event(d.ListCreated)
m.slice().view(d.TodoList).chapter(d.Ch).actor(d.User).service(d.TodoService, "GetList").event(d.ListCreated)

// @ts-expect-error a state change with no event has no specification yet
m.slice().command(d.CreateList).spec("x", { when: d.CreateList({ listId: "l-1" }), then: [] })

// @ts-expect-error nor an automation with no command
m.slice().automation(d.ListCreated).spec("x", { when: d.NameList({ listId: "l-1" }), then: [] })

// @ts-expect-error a machine of ours runs an automation, not a person, from its first step
m.slice().automation(d.ListCreated).actor(d.User)

// @ts-expect-error a state view shows a view
m.slice().view()

// Each start offers only its own next steps.

// @ts-expect-error a machine of ours runs an automation, not a person
m.slice().automation(d.ListCreated).command(d.NameList).event(d.ListCreated).actor(d.User)

// @ts-expect-error an automation polls a view without a service
m.slice().automation(d.TodoList).command(d.NameList).event(d.ListCreated).service(d.TodoService)

// @ts-expect-error a state view issues no command
m.slice().view(d.TodoList).event(d.ListCreated).command(d.CreateList)

// @ts-expect-error an automation has no screen: no one sees it
m.slice().automation(d.ListCreated).command(d.NameList).event(d.ListCreated).screen(d.Lock)

// @ts-expect-error a state change has no context
m.slice().command(d.CreateList).event(d.ListCreated).context({ listId: t.string() })

// @ts-expect-error a state change is not started twice
m.slice().command(d.CreateList).event(d.ListCreated).command(d.AddItem)

// Complete, with no actor, service or chapter: none is required. A chapter joins after the events.
m.slice().command(d.CreateList).event(d.ListCreated)
m.slice().command(d.CreateList).query(d.TodoList, "listId").event(d.ListCreated, (c) => ({ name: c.CreateList.name })).chapter(d.Ch).actor(d.User, d.Admin).service(d.TodoService)
m.slice().command(d.CreateList).event(d.ListCreated).actor(d.User).screen(d.Lock).service(d.TodoService, "StartList").chapter(d.Ch)
m.slice().view(d.TodoList).event(d.ListCreated).chapter(d.Ch)
m.slice().view(d.TodoList).event(d.ListCreated).event(d.ItemAdded).context({ listId: t.string() }).chapter(d.Ch).actor(d.User)
m.slice().view(d.TodoList).event(d.ListCreated).actor(d.User).screen(d.Lock).service(d.TodoService, "GetList")
m.slice().automation(d.ListCreated).command(d.NameList).query(d.TodoList, "listId").event(d.ListCreated, (c) => ({ name: c.NameList.name })).chapter(d.Ch)
m.slice().automation(d.TodoList).command(d.NameList).event(d.ListCreated).chapter(d.Ch)
m.slice().automation(d.ListCreated).command(d.NameList).event(d.ListCreated).actor(d.Syncer)
m.model("x", { description: "A model lists no chapters." })

// @ts-expect-error a state view names its method: it has no command to take one from
m.slice().view(d.TodoList).event(d.ListCreated).service(d.TodoService)
declare const shown: Viewing<typeof d.TodoList.__fields>
const nameless: Bare<typeof shown.service> = 'method has no name. Write .service(d.Api, "ListX").'

// --- a mapping: its argument is what is before the step, its result is the target --

// @ts-expect-error ItemAdded has no field nope, and the mapping must set title
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ nope: c.AddItem.text }))

// @ts-expect-error AddItem has no title, so ItemAdded.title has no value
m.slice().command(d.AddItem).event(d.ItemAdded)
// The editor's error is the instruction: the parameter's type is the sentence.
declare const adding: Commanded<readonly [readonly ["AddItem", typeof d.AddItem.__fields, never]], typeof d.AddItem.__fields, "change">
const said: Bare<typeof adding.event<typeof d.ItemAdded>> = "ItemAdded.title: no source. Add title to a step before .event(), or set it in the mapping."

// @ts-expect-error every event is checked the same: an event of ours is an outcome, so the second does not see the first's title
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text })).event(d.ItemAdded)

// @ts-expect-error wherever it is: the third of four lacks title
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text })).event(d.ListCreated, (c) => ({ name: c.AddItem.text })).event(d.ItemAdded).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the mapping must set title, which AddItem lacks
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ listId: c.AddItem.listId }))

// @ts-expect-error a whole declaration sets only what it carries, and AddItem has no title
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => c.AddItem)

m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
// An optional field may go unfilled in one slice; assembly checks that another fills it.
m.slice().command(d.CreateList).event(d.ItemShared)
// m.generate() fills the field nothing before the step carries.
m.slice().command(d.AddItem).event(d.ItemAdded, () => ({ title: m.generate() }))
// m.generate() says what the value is made from: fields before the step, a queried row's included.
m.slice().command(d.AddItem).query(d.TodoList, "listId").event(d.ItemAdded, (c) => ({ title: m.generate(c.AddItem.text, c.TodoList.name) }))

// @ts-expect-error a mapping is the step's second argument: called with a function, a declaration is not an example
d.ItemAdded((c) => ({ title: m.generate(c.AddItem.text) }))
m.slice().command(d.CreateList).event(d.ListCreated).event(d.ItemAdded, (c) => ({ title: c.CreateList.name }))

// @ts-expect-error a mapping takes one argument: generate is m.generate
m.slice().command(d.AddItem).event(d.ItemAdded, (c, { generate }) => ({ title: generate() }))

// @ts-expect-error title is a string
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: t.literal(42) }))

// @ts-expect-error the argument is what is before the step, and AddItem has no name
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.name }))

// @ts-expect-error the mapping is the step's second argument, not the declaration's call
m.slice().command(d.AddItem).event(d.ItemAdded((c) => ({ title: c.AddItem.text })))

// An automation's command: every field what is before it lacks is set by the mapping.

// @ts-expect-error ListCreated has no text, so AddItem.text has no value
m.slice().automation(d.ListCreated).command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the mapping must set text, which ListCreated lacks
m.slice().automation(d.ListCreated).command(d.AddItem, (c) => ({ listId: c.ListCreated.listId })).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the argument is the trigger's fields, and ListCreated has no title
m.slice().automation(d.ListCreated).command(d.AddItem, (c) => ({ text: c.ListCreated.title })).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the polled row has no text, so AddItem.text has no value
m.slice().automation(d.TodoList).command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the argument is the polled row, and TodoList has no title
m.slice().automation(d.TodoList).command(d.AddItem, (c) => ({ text: c.TodoList.title })).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// m.generate() in an automation's command compiles; assembly leaves it to do.
m.slice().automation(d.ListCreated).command(d.AddItem, () => ({ text: m.generate() })).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))

// @ts-expect-error the automation's event is filled from its command, and AddItem has no title
m.slice().automation(d.ListCreated).command(d.AddItem, (c) => ({ text: c.ListCreated.name })).event(d.ItemAdded)

m.slice().automation(d.ListCreated).command(d.AddItem, (c) => ({ text: c.ListCreated.name })).event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
// An automation's optional command field may go unfilled too.
m.slice().automation(d.ListCreated).command(d.AddDraft).event(d.ItemShared)
m.slice().automation(d.TodoList).command(d.AddItem, (c) => ({ text: c.TodoList.name })).event(d.ListCreated, (c) => ({ name: c.AddItem.text }))

// --- .query(): a view, and the filter that picks its rows ----------------------


// Many rows, before an automation's command: one command per row. The row's columns join what is before.
m.slice("ArchiveItemScheduler").automation(d.PriceChanged).query(d.CartsWithProducts, "productId").command(d.ArchiveItem).event(d.ItemArchived, () => ({ itemId: m.generate() })).chapter(d.Ch)
// The mapping form, when names differ; a mapping only where they do.
m.slice().automation(d.ProductRepriced).query(d.CartsWithProducts, (c) => ({ productId: c.ProductRepriced.changedProductId })).command(d.ArchiveCartItem, (c) => ({ cartId: c.CartsWithProducts.aggregateId })).event(d.CartItemArchived, () => ({ itemId: m.generate() })).chapter(d.Ch)
// One row: every key column named. The row's itemId reaches the event.
m.slice().command(d.ArchiveItem).query(d.CartsWithProducts, (c) => ({ aggregateId: c.ArchiveItem.aggregateId, productId: c.ArchiveItem.productId })).event(d.ItemArchived).chapter(d.Ch)
// A view queried again replaces its earlier row in c. After an automation's command, the handler's one row brings itemId.
m.slice("ArchiveItemScheduler").automation(d.PriceChanged).query(d.CartsWithProducts, "productId").command(d.ArchiveItem).query(d.CartsWithProducts, (c) => ({ aggregateId: c.ArchiveItem.aggregateId, productId: c.ArchiveItem.productId })).event(d.ItemArchived)
// In one step's context too: name flows from the later TodoList row alone.
m.slice().command(d.AddItem).query(d.TodoList, "listId").query(d.TodoList, "listId").event(d.ListCreated)

// A view nothing declares is the one error: the context stays, so ListCreated still takes listId and name from the command.
m.slice().command(d.CreateList)
  // @ts-expect-error TodoLists is declared nowhere
  .query(d.TodoLists, "listId")
  .event(d.ListCreated)

// @ts-expect-error the view has no column price
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, "price")

// @ts-expect-error nothing before the query carries itemId: map it
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, "itemId")

// @ts-expect-error the view has no column cart, in the mapping form too
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, (c) => ({ cart: c.PriceChanged.productId }))

// @ts-expect-error many rows in a state change: the filter leaves out the key column aggregateId
m.slice().command(d.ArchiveItem).query(d.CartsWithProducts, "productId")

// @ts-expect-error in the mapping form too
m.slice().command(d.ArchiveItem).query(d.CartsWithProducts, (c) => ({ productId: c.ArchiveItem.productId }))

// @ts-expect-error many rows after an automation's command: its handler reads one
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, "productId").command(d.ArchiveItem).query(d.CartsWithProducts, "productId")


// @ts-expect-error a list view gives every row its key columns match: many rows
m.slice().command(d.Restock).query(d.Shelves, "shelfId")

// A view with no key column has one row, read with no filter, or any.
m.slice().command(d.Restock).query(d.Stock).event(d.ListCreated, () => ({ listId: m.generate(), name: m.generate() }))
m.slice().command(d.Restock).query(d.Stock, () => ({})).event(d.ListCreated, () => ({ listId: m.generate(), name: m.generate() }))
// Many rows of a list, before an automation's command: one command per row.
m.slice().automation(d.ListCreated).query(d.Shelves, () => ({})).command(d.Restock)

// @ts-expect-error a view with key columns is read by them: the filter is stated
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts)
declare const priced: Triggered<readonly [readonly ["PriceChanged", typeof d.PriceChanged.__fields, never]]>
const unfiltered: Parameters<typeof priced.query<typeof d.CartsWithProducts>>[0] = "CartsWithProducts: say which rows: a column, a mapping, or () => ({}) for every row."
// A mapping that names no column reads every row.
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, () => ({}))

// @ts-expect-error a price is not a uuid: the filter's value fits its column
m.slice().automation(d.PriceChanged).query(d.CartsWithProducts, (c) => ({ productId: c.PriceChanged.oldPrice }))

// @ts-expect-error by name too: ProductNamed's productId is a string, the column a uuid
m.slice().automation(d.ProductNamed).query(d.CartsWithProducts, "productId")

// @ts-expect-error the handler sees only the command: the trigger's newPrice does not reach the event
m.slice().automation(d.PriceChanged).command(d.ArchiveItem, () => ({ aggregateId: m.generate() })).event(d.ItemRepriced)

// --- a mapping's source is its schemas, and a constant is t.literal() -------------


// @ts-expect-error a string is not a uuid
m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ noteId: c.CaptureNote.text, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a datetime is not a uuid either
m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ noteId: c.CaptureNote.at, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error status is one of inbox or filed
m.slice().command(d.CaptureNote).event(d.NoteCaptured, () => ({ status: t.literal("nope"), count: t.literal(0) }))

// @ts-expect-error text is a string, not a number
m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ text: c.CaptureNote.n, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a mapping computes nothing: a string built from a field is not a schema
m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ text: `${c.CaptureNote.text}!`, status: t.literal("inbox"), count: t.literal(0) }))

// @ts-expect-error a constant is t.literal(), not a value
m.slice().command(d.CaptureNote).event(d.NoteCaptured, () => ({ status: "inbox", count: t.literal(0) }))

m.slice().command(d.CaptureNote).event(d.NoteCaptured, (c) => ({ noteId: c.CaptureNote.noteId, text: c.CaptureNote.noteId, status: t.literal("filed"), count: t.literal(0) }))

// A field that flows by name must fit too.

// @ts-expect-error CaptureText's noteId is a string, and TextCaptured's a uuid
m.slice().command(d.CaptureText).event(d.TextCaptured)
declare const capturing: Commanded<readonly [readonly ["CaptureText", typeof d.CaptureText.__fields, never]], typeof d.CaptureText.__fields, "change">
const misfit: Bare<typeof capturing.event<typeof d.TextCaptured>> = "TextCaptured.noteId: doesn't fit. Set it to a field of its type, a t.literal() or m.generate()."
m.slice().command(d.CaptureText).event(d.TextCaptured, () => ({ noteId: m.generate() }))

// --- a call ends in the external event that brings the data back -------------


// @ts-expect-error "Shop" is a string, not an external system
m.event("ListKept", { listId: t.string() }).external("Shop")

// @ts-expect-error an external system's events join it; they are not declared inside it
m.external("Shop", { CartUpdated: m.event("CartUpdated", { listId: t.string() }) })

// An external event's fields come from outside, so nothing before it need carry them.
m.slice().command(d.AddItem).event(d.CartUpdated).actor(d.User)
m.slice().translation(d.CartUpdated).command(d.NameList, () => ({ name: t.literal("") })).event(d.ListCreated)

// @ts-expect-error an external event starts a translation, not an automation
m.slice().automation(d.CartUpdated)

// @ts-expect-error a translation starts with an external event
m.slice().translation(d.ListCreated)

// @ts-expect-error nor does a view start one
m.slice().translation(d.TodoList)
const polled: Parameters<typeof start.translation<typeof d.TodoList>>[0] = "TodoList: not an external event. Start its slice with .automation(d.TodoList)."

// @ts-expect-error ItemAdded is ours, so it still needs a title: the external event the call gets back has none
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.ItemAdded)

// The fields of the external event a call gets back join what is before the events after it: by name, or in a mapping's argument.
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.CartKept, (c) => ({ listId: c.AddItem.listId })).actor(d.User)

// @ts-expect-error AddItem and the CartUpdated it gets back both carry listId: the mapping says which
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.CartKept)
declare const calling: Commanded<readonly [readonly ["AddItem", typeof d.AddItem.__fields, never], readonly ["CartUpdated", typeof d.CartUpdated.__fields, never]], typeof d.AddItem.__fields, "change">
const twice: Bare<typeof calling.event<typeof d.CartKept>> = "CartKept.listId: comes from AddItem and CartUpdated. Set it in the mapping."

m.slice().command(d.AddItem).event(d.CartUpdated).event(d.ItemsMissing, (c) => ({ listId: c.AddItem.listId, items: c.CartUpdated.unavailable })).event(d.ItemAdded, (c) => ({ listId: c.AddItem.listId, title: c.AddItem.text }))
m.slice().automation(d.ListCreated).command(d.AddItem, () => ({ text: t.literal("") })).event(d.CartUpdated).event(d.CartKept, (c) => ({ listId: c.AddItem.listId }))
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.ItemAdded, (c) => ({ listId: c.AddItem.listId, title: m.generate(c.CartUpdated.unavailable) }))

// @ts-expect-error the external event comes before the event that keeps it
m.slice().command(d.AddItem).event(d.CartKept).event(d.CartUpdated)

// @ts-expect-error without the external event, AddItem lacks unavailable
m.slice().command(d.AddItem).event(d.ItemAdded, (c) => ({ title: c.AddItem.text })).event(d.CartKept)

// @ts-expect-error a mapping's argument is what is before the step: no external event yet, so no unavailable
m.slice().command(d.AddItem).event(d.ItemsMissing, (c) => ({ items: c.CartUpdated.unavailable })).event(d.CartUpdated)

// @ts-expect-error a mapping must still set what nothing before the step carries
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.ItemsMissing, (c) => ({ listId: c.AddItem.listId }))

// @ts-expect-error CartUpdated's unavailable is a list, and a title a string
m.slice().command(d.AddItem).event(d.CartUpdated).event(d.ItemAdded, (c) => ({ listId: c.AddItem.listId, title: c.CartUpdated.unavailable }))

// @ts-expect-error a declaration has no .fields: a mapping reads an external event's field from its argument
m.view("Unavailable", { unavailable: d.CartUpdated.fields.unavailable })

// @ts-expect-error the eighteenth event is checked as the first: ItemAdded lacks title
m.slice().command(d.CreateList).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ListCreated).event(d.ItemAdded)

// @ts-expect-error an external event isn't stored, so it builds no view
m.slice().view(d.TodoList).event(d.CartUpdated)

// @ts-expect-error nor beside an event of ours
m.slice().view(d.TodoList).event(d.ListCreated).event(d.CartUpdated)

// The external event a call gets back fills an event of ours by name: pageId comes from PageCreated.
m.slice().command(d.SyncNote).event(d.PageCreated).event(d.NoteLinked).chapter(d.Ch)

// --- everything is declared with m.command or m.event, so a spec can name it --

// @ts-expect-error a command is not declared in place
m.slice().command("AddItem", { text: t.string() })

// @ts-expect-error an event is not declared in place
m.slice().command(d.CreateList).event("ListNamed", { name: t.string() })

// @ts-expect-error nor is a second event
m.slice().command(d.CreateList).event(d.ListCreated).event("ListNamed", { name: t.string() })

// @ts-expect-error an automation's command is not declared in place
m.slice().automation(d.ListCreated).command("Archive", { listId: t.string() })

// --- a state view: its mapping reads the event and sets columns --------------

// @ts-expect-error TodoList has no column done
m.slice().view(d.TodoList).event(d.ListCreated, () => ({ done: t.literal(true) }))

// @ts-expect-error itemCount is a number
m.slice().view(d.TodoList).event(d.ListCreated, () => ({ itemCount: t.literal("0") }))

// @ts-expect-error every event is checked the same: itemCount is a number
m.slice().view(d.TodoList).event(d.ListCreated).event(d.ItemAdded, () => ({ itemCount: t.literal("0") }))

// A field that flows by name into a column must fit it.

// @ts-expect-error ListCreated's listId is a string, and Basket's a uuid
m.slice().view(d.Basket).event(d.ListCreated)
declare const basket: Viewing<typeof d.Basket.__fields>
const unfit: Bare<typeof basket.event<typeof d.ListCreated>> = "ListCreated.listId: doesn't fit. Set it to a field of its type, a t.literal() or m.generate()."

// @ts-expect-error beside a mapped event too
m.slice().view(d.Basket).event(d.ListCreated, () => ({ listId: m.generate() })).event(d.ListCreated)

// @ts-expect-error a mapping that leaves it to flow must set it
m.slice().view(d.Basket).event(d.ListCreated, () => ({ name: t.literal("x") }))
m.slice().view(d.Basket).event(d.ListCreated, () => ({ listId: m.generate() })).event(d.ItemAdded, () => ({ listId: m.generate() }))

// --- .spec() -----------------------------------------------------------------

const create = m.slice().command(d.CreateList).event(d.ListCreated).actor(d.User).service(d.TodoService)

// @ts-expect-error when is the slice's command
create.spec("x", { when: d.AddItem({ listId: "l-1" }), then: d.ListCreated({ listId: "l-1" }) })

// @ts-expect-error then is the slice's events, not any event
create.spec("x", { when: d.CreateList({ listId: "l-1" }), then: d.ItemAdded({ listId: "l-1" }) })

// @ts-expect-error a specification has then or reject, not both
create.spec("x", { when: d.CreateList({ listId: "l-1" }), then: d.ListCreated({ listId: "l-1" }), reject: "nope" })

// @ts-expect-error a specification has then or reject, not neither
create.spec("x", { when: d.CreateList({ listId: "l-1" }) })

// @ts-expect-error a state change's specification has when: only an automation's or a translation's says nothing happens
create.spec("x", { given: d.ListCreated({ listId: "l-1" }), then: [] })

// @ts-expect-error an automation's specification with no when says nothing happens, so then is []
m.slice().automation(d.ListCreated).command(d.NameList).event(d.ListCreated).spec("x", { given: d.ListCreated({ listId: "l-1" }), then: d.ListCreated({ listId: "l-1" }) })

// @ts-expect-error a rejection is written in the specification, not declared on m
m.reject

// @ts-expect-error a state view's when is its context's values, never a command
m.slice().view(d.TodoList).event(d.ListCreated).spec("x", { given: d.ListCreated({ listId: "l-1" }), when: d.CreateList({}), then: d.TodoList({}) })

// A state view's when is its context's values; its then, rows of the view it shows.
const inbox = m.slice().view(d.TodoList).event(d.ListCreated).context({ name: t.string() })

// @ts-expect-error name is a string
inbox.spec("x", { when: { name: 1 }, then: [] })

// @ts-expect-error the context has no field nope
inbox.spec("x", { when: { name: "a", nope: 1 }, then: [] })

// @ts-expect-error a state view with a context is asked with its values
inbox.spec("x", { then: [] })

// @ts-expect-error a state view with no context has no when
m.slice().view(d.TodoList).event(d.ListCreated).spec("x", { when: { name: "a" }, then: [] })

// A later state view of a view is read with the context its first gives, said once.
m.slice().view(d.Drafts).event(d.ItemShared, (c) => ({ text: m.generate(c.ItemShared) })).spec("x", { when: { listId: "l-1" }, then: [] })

// @ts-expect-error so it is asked with the context's values
m.slice().view(d.Drafts).event(d.ItemShared, (c) => ({ text: m.generate(c.ItemShared) })).spec("x", { then: [] })

// @ts-expect-error then is rows of what the view shows, and it does not show Shelf
inbox.spec("x", { when: { name: "a" }, then: d.Shelf({ shelfId: "s-1" }) })

// @ts-expect-error then is rows, not events
inbox.spec("x", { when: { name: "a" }, then: d.ListCreated({ listId: "l-1" }) })

// @ts-expect-error a state view cannot reject: a view cannot refuse an event
inbox.spec("x", { when: { name: "a" }, then: [], reject: "nope" })

// @ts-expect-error an example is not a use in a slice
m.slice().command(d.CreateList).event(d.ListCreated({ listId: "l-1" }))

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

d.GameEnded({ result: { win: "white" }, rows: [{ ply: 1 }], by: { id: "a" }, clocks: { white: 1 } })

// @ts-expect-error a oneOf holds exactly one of its cases
d.GameEnded({ result: { win: "white", draw: {} } })

// --- calling a declaration: its fields, with t's types -----------------------

// @ts-expect-error nickname is not a field of CreateList
d.CreateList({ listId: "l-1", nickname: "shopping" })

// @ts-expect-error listId is a string
d.CreateList({ listId: 42 })

// @ts-expect-error a declaration is called for an example; there is no .with()
d.CreateList.with({ listId: "l-1" })

// @ts-expect-error a view has no .key(): its key columns are marked on their fields
m.view("Shelved", { shelfId: t.string() }).key("shelfId")

// @ts-expect-error a key column is marked on its field with .key(), not on m
m.key

// @ts-expect-error only a view has key columns
m.event("Shelved", { shelfId: t.string().key() })

// @ts-expect-error a command has none either
m.command("Shelve", { shelfId: t.string().key() })

// @ts-expect-error a table built from events is declared with m.view
m.readModel({ shelfId: t.string() })

// @ts-expect-error what a handler reads is named with .query()
m.slice().command(d.CreateList).readModel(d.TodoList)

// @ts-expect-error not with .view(), which starts a state view
m.slice().command(d.CreateList).view(d.TodoList)

// The legal forms of the same calls, so a check that fires too widely also fails.
create.spec("x", { given: d.ListCreated({ listId: "l-1" }), when: d.CreateList({ listId: "l-2" }), then: [d.ListCreated({ listId: "l-2" })] })
create.spec("x", { given: [d.ListCreated({ listId: "l-1" })], when: d.CreateList({ listId: "l-1" }), reject: "nope" })
m.slice().automation(d.ListCreated).command(d.NameList).event(d.ListCreated).spec("x", { given: d.ListCreated({ listId: "l-1" }), when: d.NameList({ listId: "l-1" }), then: d.ListCreated({ listId: "l-1" }) })
// An automation's or a translation's specification with no when and then: [] says nothing happens.
m.slice().automation(d.TodoList).command(d.NameList).event(d.ListCreated).spec("x", { given: d.ListCreated({ listId: "l-1" }), then: [] })
m.slice().translation(d.CartUpdated).command(d.NameList, () => ({ name: t.literal("") })).event(d.ListCreated).spec("x", { then: [] })
m.slice().view(d.TodoList).event(d.ListCreated, () => ({ itemCount: t.literal(0) })).event(d.ItemAdded, (c) => ({ itemCount: m.generate(c.ItemAdded), name: c.ItemAdded.title }))
inbox.spec("x", { given: [d.ListCreated({ listId: "l-1", name: "a" }), d.ItemAdded({ listId: "l-1" })], when: { name: "a" }, then: [d.TodoList({ listId: "l-1" })] })
// then may describe an outcome its examples cannot show.
create.spec("x", { when: d.CreateList({ listId: "l-1" }), then: ["The list is new", d.ListCreated({ listId: "l-1" })] })
inbox.spec("x", { when: { name: "a" }, then: "No list is named a" })
m.slice().view(d.TodoList).event(d.ListCreated).spec("x", { given: d.ListCreated({ listId: "l-1" }), then: d.TodoList({ listId: "l-1" }) })
m.event("NoteKept", { noteId: t.string() }).stream(d.Notes)
// A specification may be a function, and m.generate() is a value of any field's type.
create.spec("x", () => { const listId = m.generate(); return { when: d.CreateList({ listId, name: m.generate() }), then: d.ListCreated({ listId }) } })
inbox.spec("x", { given: d.ListCreated({ listId: m.generate() }), when: { name: m.generate() }, then: [] })
