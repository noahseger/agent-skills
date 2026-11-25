// The declarations test/typecheck.ts checks against. em types writes d.d.ts beside it,
// which types d for test/typecheck.ts; this module runs, and that file does not.
import { d, m, t } from "#em"

m.actor("User")
m.actor("Admin", { icon: "admin" })
m.actor("Syncer", { icon: "system" })
m.service("TodoService", "todo.v1")
m.command("CreateList", { listId: t.string(), name: t.string() })
m.event("ListCreated", { listId: t.string(), name: t.string() })
m.command("AddItem", { listId: t.string(), text: t.string() })
m.event("ItemAdded", { listId: t.string(), title: t.string() })
m.view("TodoList", { listId: t.string().key(), name: t.string(), itemCount: t.int() })
m.command("NameList", { listId: t.string(), name: t.string() })
m.screen("Lock")
m.chapter("Ch", 1).note("A run of slices.")
m.stream("Notes")
m.event("ItemShared", { listId: t.string(), title: t.string().optional() })
m.command("AddDraft", { listId: t.string(), text: t.string().optional() })
m.event("PriceChanged", { productId: t.uuid(), oldPrice: t.number(), newPrice: t.number() })
m.view("CartsWithProducts", {
  aggregateId: t.uuid().key(),
  productId: t.uuid().key(),
  itemId: t.uuid(),
})
m.command("ArchiveItem", { aggregateId: t.uuid(), productId: t.uuid() })
// The same fields as ArchiveItem, and still another command.
m.command("ArchiveCart", { aggregateId: t.uuid(), productId: t.uuid() })
m.event("ItemArchived", { aggregateId: t.uuid(), itemId: t.uuid() })
m.event("ItemRepriced", { aggregateId: t.uuid(), newPrice: t.number() })
m.event("ProductRepriced", { changedProductId: t.uuid(), newPrice: t.number() })
m.command("ArchiveCartItem", { cartId: t.uuid(), productId: t.uuid() })
m.event("CartItemArchived", { cartId: t.uuid(), itemId: t.uuid() })
m.event("ProductNamed", { productId: t.string() })
m.command("Restock", { shelfId: t.string() })
m.view("Shelves", t.array({ shelfId: t.string().key(), sku: t.string() }))
m.view("Stock", { shelves: t.int() })
m.event("NoteCaptured", {
  noteId: t.uuid(),
  text: t.string(),
  status: t.enum(["inbox", "filed"]),
  count: t.int(),
})
m.command("CaptureNote", { noteId: t.uuid(), text: t.string(), n: t.number(), at: t.datetime() })
m.command("CaptureText", { noteId: t.string(), text: t.string() })
m.event("TextCaptured", { noteId: t.uuid(), text: t.string() })
m.external("Shop")
m.event("CartUpdated", { listId: t.string(), unavailable: t.array(t.string()) }).external(d.Shop)
m.event("CartKept", { listId: t.string(), unavailable: t.array(t.string()) })
m.event("ItemsMissing", { listId: t.string(), items: t.array(t.string()) })
m.external("Wiki")
m.event("PageCreated", { pageId: t.string() }).external(d.Wiki)
m.command("SyncNote", { noteId: t.uuid(), text: t.string() })
m.event("NoteLinked", { noteId: t.uuid(), pageId: t.string() })
m.view("Basket", { listId: t.uuid(), name: t.string() })
m.view("Shelf", { shelfId: t.string().key() })
m.event("GameEnded", {
  id: t.uuid(),
  email: t.email(),
  site: t.url(),
  day: t.date(),
  at: t.datetime(),
  takes: t.duration(),
  n: t.number(),
  i: t.int(),
  on: t.boolean(),
  side: t.enum(["white", "black"]),
  x: t.literal("x"),
  sans: t.array(t.string()),
  rows: t.array({ ply: t.int() }),
  by: t.object({ id: t.string() }),
  clocks: t.record(t.int()),
  result: t.oneOf({ win: t.enum(["white", "black"]), draw: t.object({}) }),
  note: t.string().optional().describe("Why"),
})
m.view("Drafts", { listId: t.string().key(), text: t.string() })
// Its first state view gives the context test/typecheck.ts's later one is read with.
m.slice()
  .view(d.Drafts)
  .event(d.ItemAdded, (c) => ({ text: c.ItemAdded.title }))
  .context({ listId: t.string() })
