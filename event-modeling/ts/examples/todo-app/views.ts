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

export const Views = m.chapter()

m.slice()
  .projection(
    TodoList,
    ListCreated(() => ({ itemCount: 0, status: "open" })),
  )
  .chapter(Views)
  .event(ItemAdded((e, { generate }) => ({ itemCount: generate(e) })))
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
  })

m.slice()
  .view(TodoList)
  .chapter(Views)
  .query({ userId: z.string() })
  .actor(User)
  .service(TodoService, "ListTodoLists")
  .test("A user sees only their own lists", {
    given: [groceries, ListCreated({ listId: "list-2", userId: "u-2", name: "Hardware" })],
    when: { userId: "u-1" },
    then: TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "open",
    }),
  })

m.slice()
  .projection(
    ItemSearch,
    ItemAdded(() => ({ done: false, deleted: false })),
  )
  .chapter(Views)
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
  })

m.slice()
  .view(ItemSearch)
  .chapter(Views)
  .query({ listId: z.string() })
  .actor(User)
  .screen(ListScreen)
  .service(TodoService, "GetList")
  .test("A list shows its own items", {
    given: [
      groceries,
      milk,
      eggs,
      ItemAdded({ userId: "u-1", listId: "list-2", itemId: "item-3", title: "Nails" }),
    ],
    when: { listId: "list-1" },
    then: [
      ItemSearch({
        itemId: "item-1",
        listId: "list-1",
        title: "Milk",
        done: false,
        deleted: false,
      }),
      ItemSearch({
        itemId: "item-2",
        listId: "list-1",
        title: "Eggs",
        done: false,
        deleted: false,
      }),
    ],
  })

m.slice()
  .view(ItemSearch)
  .chapter(Views)
  .query({ text: z.string() })
  .actor(User)
  .service(TodoService, "SearchItems")
  .test("A search finds a done item by its title", {
    given: [milk, milkDone],
    when: { text: "Milk" },
    then: ItemSearch({
      itemId: "item-1",
      listId: "list-1",
      title: "Milk",
      done: true,
      deleted: false,
    }),
  })

export const Automations = m.chapter()

m.slice("ListCompleter")
  .trigger(ItemCompleted, CompleteList, ListCompleted)
  .chapter(Automations)
  .readModel(ItemSearch)
  .test("List completes when every item is done", {
    given: [milk, milkDone],
    when: CompleteList({ listId: "list-1" }),
    then: ListCompleted({ listId: "list-1" }),
  })

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

export const Integrations = m.chapter()

m.slice()
  .trigger(
    TaskScheduled,
    AddItem,
    ItemAdded((c) => ({ title: c.text })),
  )
  .chapter(Integrations)
  .test("A scheduled task becomes an item", {
    given: [
      groceries,
      TaskScheduled({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    ],
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    then: ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-4", title: "Flour" }),
  })
