// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, External, ExternalEvent, Field, Screen, Service, Stream, View } from "#em"

declare module "#em" {
  interface Registry {
    AddItem: Command<"AddItem", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; text: Field<string> }>
    Automations: Chapter
    Calendar: External
    CompleteItem: Command<"CompleteItem", { userId: Field<string>; listId: Field<string>; itemId: Field<string> }>
    CompleteList: Command<"CompleteList", { userId: Field<string>; listId: Field<string> }>
    CreateList: Command<"CreateList", { userId: Field<string>; listId: Field<string>; name: Field<string> }>
    DeleteItem: Command<"DeleteItem", { listId: Field<string>; itemId: Field<string> }>
    DeleteList: Command<"DeleteList", { userId: Field<string>; listId: Field<string> }>
    Integrations: Chapter
    ItemAdded: Event<"ItemAdded", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; title: Field<string> }>
    ItemCompleted: Event<"ItemCompleted", { userId: Field<string>; listId: Field<string>; itemId: Field<string> }>
    ItemDeleted: Event<"ItemDeleted", { listId: Field<string>; itemId: Field<string> }>
    ItemSearch: View<"ItemSearch", { itemId: Field<string, string, true>; listId: Field<string>; title: Field<string>; done: Field<boolean>; deleted: Field<boolean> }, false, { text: Field<string> }>
    Items: Stream
    ListCompleted: Event<"ListCompleted", { userId: Field<string>; listId: Field<string> }>
    ListCreated: Event<"ListCreated", { listId: Field<string>; userId: Field<string>; name: Field<string> }>
    ListDeleted: Event<"ListDeleted", { userId: Field<string>; listId: Field<string> }>
    ListItems: View<"ListItems", { listId: Field<string, string, true>; itemId: Field<string, string, true>; title: Field<string>; done: Field<boolean>; deleted: Field<boolean> }, false, { listId: Field<string> }>
    ListManagement: Chapter
    ListScreen: Screen
    Lists: Stream
    TaskScheduled: ExternalEvent<"TaskScheduled", { userId: Field<string>; listId: Field<string>; itemId: Field<string>; text: Field<string> }>
    TodoList: View<"TodoList", { userId: Field<string, string, true>; listId: Field<string, string, true>; name: Field<string>; itemCount: Field<number>; status: Field<"open" | "completed" | "deleted"> }, false, { userId: Field<string> }>
    TodoService: Service
    User: Actor
    Views: Chapter
  }
}
//# sourceMappingURL=d.d.ts.map
