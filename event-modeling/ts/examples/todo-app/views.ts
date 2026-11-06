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
  Lists,
  TodoService,
  User,
} from "./list-management.ts"

// When the last item is done, the list completes.
export const CompleteList = m.command({ listId: z.string() })
export const ListCompleted = m.event({ listId: z.string() }).stream(Lists)

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

const groceries = ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })
const milkDone = ItemCompleted({ listId: "list-1", itemId: "item-1" })
const eggs = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" })

export const Views = [
  m
    .slice()
    .projection(
      TodoList,
      ListCreated(() => ({ itemCount: 0, status: "open" })),
    )
    .event(ItemAdded((e, { count }) => ({ itemCount: count(e) })))
    .event(ListCompleted(() => ({ status: "completed" })))
    .event(ListDeleted(() => ({ status: "deleted" })))
    .test("A new list shows with no items", {
      given: groceries,
      then: TodoList({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "open",
      }),
    })
    .test("Items are counted as they are added", {
      given: [groceries, milk, eggs],
      then: TodoList({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 2,
        status: "open",
      }),
    })
    .test("A completed list shows as completed", {
      given: [groceries, ListCompleted({ listId: "list-1" })],
      then: TodoList({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "completed",
      }),
    })
    .test("A deleted list shows as deleted", {
      given: [groceries, ListDeleted({ listId: "list-1" })],
      then: TodoList({
        userId: "u-1",
        listId: "list-1",
        name: "Groceries",
        itemCount: 0,
        status: "deleted",
      }),
    }),

  m
    .slice()
    .view(TodoList)
    .query({ userId: z.string() })
    .actor(User)
    .service(TodoService, "ListTodoLists"),

  m
    .slice()
    .projection(
      ItemSearch,
      ItemAdded(() => ({ done: false, deleted: false })),
    )
    .event(ItemCompleted(() => ({ done: true })))
    .event(ItemDeleted(() => ({ deleted: true })))
    .test("A completed item shows as done", {
      given: [milk, milkDone],
      then: ItemSearch({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: true,
        deleted: false,
      }),
    })
    .test("An added item shows as not done", {
      given: milk,
      then: ItemSearch({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: false,
        deleted: false,
      }),
    })
    .test("A deleted item shows as deleted", {
      given: [milk, ItemDeleted({ listId: "list-1", itemId: "item-1" })],
      then: ItemSearch({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: false,
        deleted: true,
      }),
    }),

  m
    .slice()
    .view(ItemSearch)
    .query({ listId: z.string() })
    .actor(User)
    .screen(ListScreen)
    .service(TodoService, "GetList"),

  m
    .slice()
    .view(ItemSearch)
    .query({ text: z.string() })
    .actor(User)
    .service(TodoService, "SearchItems"),
]

export const Automations = [
  m
    .slice("ListCompleter")
    .trigger(ItemCompleted, CompleteList, ListCompleted)
    .readModel(ItemSearch)
    .test("List completes when every item is done", {
      given: [milk, milkDone],
      when: CompleteList({ listId: "list-1" }),
      then: ListCompleted({ listId: "list-1" }),
    }),
]

// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external()

export const TaskScheduled = m
  .event({
    userId: z.string(),
    listId: z.string(),
    itemId: z.string(),
    text: z.string(),
  })
  .external(Calendar)

export const Integrations = [
  m
    .slice()
    .trigger(
      TaskScheduled,
      AddItem,
      ItemAdded((c) => ({ title: c.text })),
    )
    .test("A scheduled task becomes an item", {
      given: groceries,
      when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
      then: ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-4", title: "Flour" }),
    }),
]
