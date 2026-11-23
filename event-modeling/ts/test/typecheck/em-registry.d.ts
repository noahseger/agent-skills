// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, External, ExternalEventDecl, Field, Screen, Service, Stream, SystemActor, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    AddDraft: CommandDecl<"AddDraft", { listId: Field<string>; text: Field<string | undefined> }>
    AddItem: CommandDecl<"AddItem", { listId: Field<string>; text: Field<string> }>
    Admin: Actor
    ArchiveCart: CommandDecl<"ArchiveCart", { aggregateId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    ArchiveCartItem: CommandDecl<"ArchiveCartItem", { cartId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    ArchiveItem: CommandDecl<"ArchiveItem", { aggregateId: Field<string, "uuid">; productId: Field<string, "uuid"> }>
    Basket: ViewDecl<"Basket", { listId: Field<string, "uuid">; name: Field<string> }, false>
    CaptureNote: CommandDecl<"CaptureNote", { noteId: Field<string, "uuid">; text: Field<string>; n: Field<number>; at: Field<string, "datetime"> }>
    CaptureText: CommandDecl<"CaptureText", { noteId: Field<string>; text: Field<string> }>
    CartItemArchived: EventDecl<"CartItemArchived", { cartId: Field<string, "uuid">; itemId: Field<string, "uuid"> }>
    CartKept: EventDecl<"CartKept", { listId: Field<string>; unavailable: Field<string[]> }>
    CartUpdated: ExternalEventDecl<"CartUpdated", { listId: Field<string>; unavailable: Field<string[]> }>
    CartsWithProducts: ViewDecl<"CartsWithProducts", { aggregateId: Field<string, "uuid", true>; productId: Field<string, "uuid", true>; itemId: Field<string, "uuid"> }, false>
    Ch: Chapter
    CreateList: CommandDecl<"CreateList", { listId: Field<string>; name: Field<string> }>
    GameEnded: EventDecl<"GameEnded", { id: Field<string, "uuid">; email: Field<string, "email">; site: Field<string, "url">; day: Field<string, "date">; at: Field<string, "datetime">; takes: Field<string, "duration">; n: Field<number>; i: Field<number>; on: Field<boolean>; side: Field<"white" | "black">; x: Field<"x">; sans: Field<string[]>; rows: Field<({ ply: number })[]>; by: Field<{ id: string }>; clocks: Field<Record<string, number>>; result: Field<{ win: "white" | "black"; draw?: never } | { draw: {}; win?: never }>; note: Field<string | undefined> }>
    ItemAdded: EventDecl<"ItemAdded", { listId: Field<string>; title: Field<string> }>
    ItemArchived: EventDecl<"ItemArchived", { aggregateId: Field<string, "uuid">; itemId: Field<string, "uuid"> }>
    ItemRepriced: EventDecl<"ItemRepriced", { aggregateId: Field<string, "uuid">; newPrice: Field<number> }>
    ItemShared: EventDecl<"ItemShared", { listId: Field<string>; title: Field<string | undefined> }>
    ItemsMissing: EventDecl<"ItemsMissing", { listId: Field<string>; items: Field<string[]> }>
    ListCreated: EventDecl<"ListCreated", { listId: Field<string>; name: Field<string> }>
    Lock: Screen
    NameList: CommandDecl<"NameList", { listId: Field<string>; name: Field<string> }>
    NoteCaptured: EventDecl<"NoteCaptured", { noteId: Field<string, "uuid">; text: Field<string>; status: Field<"inbox" | "filed">; count: Field<number> }>
    NoteLinked: EventDecl<"NoteLinked", { noteId: Field<string, "uuid">; pageId: Field<string> }>
    Notes: Stream
    PageCreated: ExternalEventDecl<"PageCreated", { pageId: Field<string> }>
    PriceChanged: EventDecl<"PriceChanged", { productId: Field<string, "uuid">; oldPrice: Field<number>; newPrice: Field<number> }>
    ProductNamed: EventDecl<"ProductNamed", { productId: Field<string> }>
    ProductRepriced: EventDecl<"ProductRepriced", { changedProductId: Field<string, "uuid">; newPrice: Field<number> }>
    Restock: CommandDecl<"Restock", { shelfId: Field<string> }>
    Shelf: ViewDecl<"Shelf", { shelfId: Field<string, string, true> }, false>
    Shelves: ViewDecl<"Shelves", { shelfId: Field<string, string, true>; sku: Field<string> }, true>
    Shop: External
    Stock: ViewDecl<"Stock", { shelves: Field<number> }, false>
    SyncNote: CommandDecl<"SyncNote", { noteId: Field<string, "uuid">; text: Field<string> }>
    Syncer: SystemActor
    TextCaptured: EventDecl<"TextCaptured", { noteId: Field<string, "uuid">; text: Field<string> }>
    TodoList: ViewDecl<"TodoList", { listId: Field<string, string, true>; name: Field<string>; itemCount: Field<number> }, false>
    TodoService: Service
    User: Actor
    Wiki: External
  }
}
//# sourceMappingURL=em-registry.d.ts.map
