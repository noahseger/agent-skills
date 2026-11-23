// What the system knows about lists, and what it does on its own.

import { m, t } from "#em"

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
export const CompleteList = m.command({ userId: t.string(), listId: t.string() })
export const ListCompleted = m.event({ userId: t.string(), listId: t.string() }).stream(Lists)

// A user's lists, one row per list.
export const TodoList = m.view({
  userId: t.string().key(),
  listId: t.string().key(),
  name: t.string(),
  itemCount: t.int(),
  status: t.enum(["open", "completed", "deleted"]),
})

// The items of each list.
export const ListItems = m.view({
  listId: t.string().key(),
  itemId: t.string().key(),
  title: t.string(),
  done: t.boolean(),
  deleted: t.boolean(),
})

// Every item in every list, searchable by title.
export const ItemSearch = m.view({
  itemId: t.string().key(),
  listId: t.string(),
  title: t.string(),
  done: t.boolean(),
  deleted: t.boolean(),
})

const groceries = ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })
const milkDone = ItemCompleted({ userId: "u-1", listId: "list-1", itemId: "item-1" })
const eggs = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" })

export const Views = m.chapter(2)

m.slice()
  .view({ TodoList })
  .event({ ListCreated }, () => ({ itemCount: t.literal(0), status: t.literal("open") }))
  .event({ ItemAdded }, (c) => ({ itemCount: m.generate(c.ItemAdded) }))
  .event({ ListCompleted }, () => ({ status: t.literal("completed") }))
  .event({ ListDeleted }, () => ({ status: t.literal("deleted") }))
  .context({ userId: t.string() })
  .chapter(Views)
  .actor(User)
  .service(TodoService, "ListTodoLists")
  .test("A new list shows with no items", {
    given: groceries,
    when: { userId: "u-1" },
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
    when: { userId: "u-1" },
    then: TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 2,
      status: "open",
    }),
  })
  .test("A completed list shows as completed", {
    given: [groceries, ListCompleted({ userId: "u-1", listId: "list-1" })],
    when: { userId: "u-1" },
    then: TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "completed",
    }),
  })
  .test("A deleted list shows as deleted", {
    given: [groceries, ListDeleted({ userId: "u-1", listId: "list-1" })],
    when: { userId: "u-1" },
    then: TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "deleted",
    }),
  })
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
  .view({ ListItems })
  .event({ ItemAdded }, () => ({ done: t.literal(false), deleted: t.literal(false) }))
  .event({ ItemCompleted }, () => ({ done: t.literal(true) }))
  .event({ ItemDeleted }, () => ({ deleted: t.literal(true) }))
  .context({ listId: t.string() })
  .chapter(Views)
  .actor(User)
  .screen(ListScreen)
  .service(TodoService, "GetList")
  .test("A completed item shows as done", {
    given: [milk, milkDone],
    when: { listId: "list-1" },
    then: ListItems({
      listId: "list-1",
      itemId: "item-1",
      title: "Milk",
      done: true,
      deleted: false,
    }),
  })
  .test("A deleted item shows as deleted", {
    given: [milk, ItemDeleted({ listId: "list-1", itemId: "item-1" })],
    when: { listId: "list-1" },
    then: ListItems({
      listId: "list-1",
      itemId: "item-1",
      title: "Milk",
      done: false,
      deleted: true,
    }),
  })
  .test("A list shows its own items", {
    given: [
      groceries,
      milk,
      eggs,
      ItemAdded({ userId: "u-1", listId: "list-2", itemId: "item-3", title: "Nails" }),
    ],
    when: { listId: "list-1" },
    then: [
      ListItems({
        listId: "list-1",
        itemId: "item-1",
        title: "Milk",
        done: false,
        deleted: false,
      }),
      ListItems({
        listId: "list-1",
        itemId: "item-2",
        title: "Eggs",
        done: false,
        deleted: false,
      }),
    ],
  })

m.slice()
  .view({ ItemSearch })
  .event({ ItemAdded }, () => ({ done: t.literal(false), deleted: t.literal(false) }))
  .event({ ItemCompleted }, () => ({ done: t.literal(true) }))
  .event({ ItemDeleted }, () => ({ deleted: t.literal(true) }))
  .context({ text: t.string() })
  .chapter(Views)
  .actor(User)
  .service(TodoService, "SearchItems")
  .test("An added item shows as not done", {
    given: milk,
    when: { text: "Milk" },
    then: ItemSearch({
      itemId: "item-1",
      listId: "list-1",
      title: "Milk",
      done: false,
      deleted: false,
    }),
  })
  .test("A search finds a deleted item as deleted", {
    given: [milk, ItemDeleted({ listId: "list-1", itemId: "item-1" })],
    when: { text: "Milk" },
    then: ItemSearch({
      itemId: "item-1",
      listId: "list-1",
      title: "Milk",
      done: false,
      deleted: true,
    }),
  })
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

export const Automations = m.chapter(3)

m.slice("ListCompleter")
  .automation({ ItemCompleted })
  .command({ CompleteList })
  .query({ TodoList }, (c) => ({ userId: c.CompleteList.userId, listId: c.CompleteList.listId }))
  .event({ ListCompleted })
  .chapter(Automations)
  .test("List completes when every item is done", {
    given: [groceries, milk, milkDone],
    when: CompleteList({ userId: "u-1", listId: "list-1" }),
    then: ListCompleted({ userId: "u-1", listId: "list-1" }),
  })

// The calendar pushes a scheduled task in, and we translate it into an item.
export const Calendar = m.external()

export const TaskScheduled = m
  .event({
    userId: t.string(),
    listId: t.string(),
    itemId: t.string(),
    text: t.string(),
  })
  .external(Calendar)

export const Integrations = m.chapter(4)

m.slice()
  .translation({ TaskScheduled })
  .command({ AddItem })
  .event({ ItemAdded }, (c) => ({ title: c.AddItem.text }))
  .chapter(Integrations)
  .test("A scheduled task becomes an item", {
    given: [
      groceries,
      TaskScheduled({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    ],
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    then: ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-4", title: "Flour" }),
  })
