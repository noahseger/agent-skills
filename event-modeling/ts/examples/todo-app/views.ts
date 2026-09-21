// What the system knows about lists, and what it does on its own.

import { m, z } from "#em"

import {
  AddItem,
  ItemAdded,
  ItemCompleted,
  ItemDeleted,
  ListCreated,
  ListDeleted,
  ListScreen,
  ListsScreen,
  TodoService,
  User,
} from "./list-management.ts"

// Search has a screen of its own.
export const SearchScreen = m.screen(User, TodoService)

// The process that completes a list when its last item is done.
export const ListCompleter = m.automation()

// When the last item is done, the list completes.
export const CompleteList = m.command({ listId: z.string() })
export const ListCompleted = m.event({ listId: z.string() })

// A user's lists, one row per list.
export const TodoList = m.readModel({
  userId: m.key(z.string()),
  listId: m.key(z.string()),
  name: z.string(),
  itemCount: z.number().int(),
  status: z.enum(["open", "completed", "deleted"]),
})

// Every item in every list, searchable by title.
export const ItemSearch = m.readModel({
  itemId: m.key(z.string()),
  listId: z.string(),
  title: z.string(),
  done: z.boolean(),
  deleted: z.boolean(),
})

const groceries = ListCreated.with({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = ItemAdded.with({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })
const milkDone = ItemCompleted.with({ listId: "list-1", itemId: "item-1" })
const eggs = ItemAdded.with({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" })

export const Views = m.chapter([
  TodoList.on(ListCreated, () => ({ itemCount: 0, status: "open" }))
    .on(ItemAdded, (e) => ({ itemCount: m.count(e) }))
    .on(ListCompleted, () => ({ status: "completed" }))
    .on(ListDeleted, () => ({ status: "deleted" }))
    .test("A new list shows with no items", {
      given: groceries,
      then: TodoList.with({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "open",
      }),
    })
    .test("Items are counted as they are added", {
      given: [groceries, milk, eggs],
      then: TodoList.with({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 2,
        status: "open",
      }),
    })
    .test("A completed list shows as completed", {
      given: [groceries, ListCompleted.with({ listId: "list-1" })],
      then: TodoList.with({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "completed",
      }),
    })
    .test("A deleted list shows as deleted", {
      given: [groceries, ListDeleted.with({ listId: "list-1" })],
      then: TodoList.with({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "deleted",
      }),
    }),

  ListsScreen.view("ListTodoLists").query({ userId: z.string() }).reads(TodoList),

  ItemSearch.on(ItemAdded, () => ({ done: false, deleted: false }))
    .on(ItemCompleted, () => ({ done: true }))
    .on(ItemDeleted, () => ({ deleted: true }))
    .test("A completed item shows as done", {
      given: [milk, milkDone],
      then: ItemSearch.with({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: true,
        deleted: false,
      }),
    })
    .test("An added item shows as not done", {
      given: milk,
      then: ItemSearch.with({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: false,
        deleted: false,
      }),
    })
    .test("A deleted item shows as deleted", {
      given: [milk, ItemDeleted.with({ listId: "list-1", itemId: "item-1" })],
      then: ItemSearch.with({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: false,
        deleted: true,
      }),
    }),

  ListScreen.view("GetList").query({ listId: z.string() }).reads(ItemSearch),

  SearchScreen.view("SearchItems").query({ text: z.string() }).reads(ItemSearch),
])

export const Automations = m.chapter([
  ListCompleter.on(ItemCompleted)
    .reads(ItemSearch)
    .command(CompleteList)
    .emits(ListCompleted)
    .test("List completes when every item is done", {
      given: [milk, milkDone],
      when: CompleteList.with({ listId: "list-1" }),
      then: ListCompleted.with({ listId: "list-1" }),
    }),
])

// The calendar pushes a scheduled task in, and we translate it into an item.
export const TaskScheduled = m.event({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
  text: z.string(),
})
export const Calendar = m.external({ TaskScheduled })

// Ours: it turns the calendar's task into an item on the list.
export const CalendarImport = m.automation()

export const Integrations = m.chapter([
  CalendarImport.on(TaskScheduled)
    .command(AddItem)
    .emits(ItemAdded, (c) => ({ title: c.text })),
])

// The same lane as list-management.ts declares; the CLI merges them by name.
export const Lists = m.stream({ CompleteList, ListCompleted })
