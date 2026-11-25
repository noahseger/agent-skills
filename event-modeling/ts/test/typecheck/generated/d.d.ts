// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, External, ExternalEvent, Field, Screen, Service, Stream, SystemActor, View } from "#em"

declare module "#em" {
  interface Registry {
    AddDraft: Command<"AddDraft", { listId: Field<string>; text: Field<string | undefined> }>
    AddItem: Command<"AddItem", { listId: Field<string>; text: Field<string> }>
    Admin: Actor
    ArchiveCart: Command<"ArchiveCart", { aggregateId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    ArchiveCartItem: Command<"ArchiveCartItem", { cartId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    ArchiveItem: Command<"ArchiveItem", { aggregateId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    Basket: View<"Basket", { listId: Field<string, "uuid">; name: Field<string> }, false>
    CaptureNote: Command<"CaptureNote", { noteId: Field<string, "uuid">; text: Field<string>; n: Field<number>; at: Field<string, "datetime"> }>
    CaptureText: Command<"CaptureText", { noteId: Field<string>; text: Field<string> }>
    CartItemArchived: Event<"CartItemArchived", { cartId: Field<string, "uuid">; itemId: Field<string, "uuid"> }>
    CartKept: Event<"CartKept", { listId: Field<string>; unavailable: Field<string[]> }>
    CartUpdated: ExternalEvent<"CartUpdated", { listId: Field<string>; unavailable: Field<string[]> }>
    CartsWithProducts: View<"CartsWithProducts", { aggregateId: Field<string, "uuid", true>; productId: Field<string, "uuid", true>; itemId: Field<string, "uuid"> }, false>
    Ch: Chapter
    CreateList: Command<"CreateList", { listId: Field<string>; name: Field<string> }>
    Drafts: View<"Drafts", { listId: Field<string, string, true>; text: Field<string> }, false, { listId: Field<string> }>
    GameEnded: Event<"GameEnded", { id: Field<string, "uuid">; email: Field<string, "email">; site: Field<string, "url">; day: Field<string, "date">; at: Field<string, "datetime">; takes: Field<string, "duration">; n: Field<number>; i: Field<number>; on: Field<boolean>; side: Field<"white" | "black">; x: Field<"x">; sans: Field<string[]>; rows: Field<({ ply: number })[]>; by: Field<{ id: string }>; clocks: Field<Record<string, number>>; result: Field<{ win: "white" | "black"; draw?: never } | { draw: {}; win?: never }>; note: Field<string | undefined> }>
    ItemAdded: Event<"ItemAdded", { listId: Field<string>; title: Field<string> }>
    ItemArchived: Event<"ItemArchived", { aggregateId: Field<string, "uuid">; itemId: Field<string, "uuid"> }>
    ItemRepriced: Event<"ItemRepriced", { aggregateId: Field<string, "uuid">; newPrice: Field<number> }>
    ItemShared: Event<"ItemShared", { listId: Field<string>; title: Field<string | undefined> }>
    ItemsMissing: Event<"ItemsMissing", { listId: Field<string>; items: Field<string[]> }>
    ListCreated: Event<"ListCreated", { listId: Field<string>; name: Field<string> }>
    Lock: Screen
    NameList: Command<"NameList", { listId: Field<string>; name: Field<string> }>
    NoteCaptured: Event<"NoteCaptured", { noteId: Field<string, "uuid">; text: Field<string>; status: Field<"inbox" | "filed">; count: Field<number> }>
    NoteLinked: Event<"NoteLinked", { noteId: Field<string, "uuid">; pageId: Field<string> }>
    Notes: Stream
    PageCreated: ExternalEvent<"PageCreated", { pageId: Field<string> }>
    PriceChanged: Event<"PriceChanged", { productId: Field<string, "uuid">; oldPrice: Field<number>; newPrice: Field<number> }>
    ProductNamed: Event<"ProductNamed", { productId: Field<string> }>
    ProductRepriced: Event<"ProductRepriced", { changedProductId: Field<string, "uuid">; newPrice: Field<number> }>
    Restock: Command<"Restock", { shelfId: Field<string> }>
    Shelf: View<"Shelf", { shelfId: Field<string, string, true> }, false>
    Shelves: View<"Shelves", { shelfId: Field<string, string, true>; sku: Field<string> }, true>
    Shop: External
    Stock: View<"Stock", { shelves: Field<number> }, false>
    SyncNote: Command<"SyncNote", { noteId: Field<string, "uuid">; text: Field<string> }>
    Syncer: SystemActor
    TextCaptured: Event<"TextCaptured", { noteId: Field<string, "uuid">; text: Field<string> }>
    TodoList: View<"TodoList", { listId: Field<string, string, true>; name: Field<string>; itemCount: Field<number> }, false>
    TodoService: Service
    User: Actor
    Wiki: External
  }
}
//# sourceMappingURL=d.d.ts.map
