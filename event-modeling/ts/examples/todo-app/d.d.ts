// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, External, ExternalEventDecl, Field, Screen, Service, Stream, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    AddItem: CommandDecl<"AddItem", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; text: Field<string> }>
    Automations: Chapter
    Calendar: External
    CompleteItem: CommandDecl<"CompleteItem", { userId: Field<string>; listId: Field<string>; itemId: Field<string> }>
    CompleteList: CommandDecl<"CompleteList", { userId: Field<string>; listId: Field<string> }>
    CreateList: CommandDecl<"CreateList", { userId: Field<string>; listId: Field<string>; name: Field<string> }>
    DeleteItem: CommandDecl<"DeleteItem", { listId: Field<string>; itemId: Field<string> }>
    DeleteList: CommandDecl<"DeleteList", { userId: Field<string>; listId: Field<string> }>
    Integrations: Chapter
    ItemAdded: EventDecl<"ItemAdded", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; title: Field<string> }>
    ItemCompleted: EventDecl<"ItemCompleted", { userId: Field<string>; listId: Field<string>; itemId: Field<string> }>
    ItemDeleted: EventDecl<"ItemDeleted", { listId: Field<string>; itemId: Field<string> }>
    ItemSearch: ViewDecl<"ItemSearch", { itemId: Field<string, string, true>; listId: Field<string>; title: Field<string>; done: Field<boolean>; deleted: Field<boolean> }, false, { text: Field<string> }>
    Items: Stream
    ListCompleted: EventDecl<"ListCompleted", { userId: Field<string>; listId: Field<string> }>
    ListCreated: EventDecl<"ListCreated", { listId: Field<string>; userId: Field<string>; name: Field<string> }>
    ListDeleted: EventDecl<"ListDeleted", { userId: Field<string>; listId: Field<string> }>
    ListItems: ViewDecl<"ListItems", { listId: Field<string, string, true>; itemId: Field<string, string, true>; title: Field<string>; done: Field<boolean>; deleted: Field<boolean> }, false, { listId: Field<string> }>
    ListManagement: Chapter
    ListScreen: Screen
    Lists: Stream
    TaskScheduled: ExternalEventDecl<"TaskScheduled", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; text: Field<string> }>
    TodoList: ViewDecl<"TodoList", { userId: Field<string, string, true>; listId: Field<string, string, true>; name: Field<string>; itemCount: Field<number>; status: Field<"open" | "completed" | "deleted"> }, false, { userId: Field<string> }>
    TodoService: Service
    User: Actor
    Views: Chapter
  }
}
//# sourceMappingURL=d.d.ts.map
