// What the system knows about lists, and what it does on its own.

import { d, m, t } from "#em"

// When the last item is done, the list completes.
m.command("CompleteList", { userId: t.string(), listId: t.string() })
m.event("ListCompleted", { userId: t.string(), listId: t.string() }).stream(d.Lists)

// A user's lists, one row per list.
m.view("TodoList", {
  userId: t.string().key(),
  listId: t.string().key(),
  name: t.string(),
  itemCount: t.int(),
  status: t.enum(["open", "completed", "deleted"]),
})

// The items of each list.
m.view("ListItems", {
  listId: t.string().key(),
  itemId: t.string().key(),
  title: t.string(),
  done: t.boolean(),
  deleted: t.boolean(),
})

// Every item in every list, searchable by title.
m.view("ItemSearch", {
  itemId: t.string().key(),
  listId: t.string(),
  title: t.string(),
  done: t.boolean(),
  deleted: t.boolean(),
})

const groceries = d.ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })
const milkDone = d.ItemCompleted({ userId: "u-1", listId: "list-1", itemId: "item-1" })
const eggs = d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" })

m.chapter("Views", 2)

m.slice()
  .view(d.TodoList)
  .event(d.ListCreated, () => ({ itemCount: t.literal(0), status: t.literal("open") }))
  .event(d.ItemAdded, (c) => ({ itemCount: m.generate(c.ItemAdded) }))
  .event(d.ListCompleted, () => ({ status: t.literal("completed") }))
  .event(d.ListDeleted, () => ({ status: t.literal("deleted") }))
  .context({ userId: t.string() })
  .chapter(d.Views)
  .actor(d.User)
  .service(d.TodoService, "ListTodoLists")
  .test("A new list shows with no items", {
    given: groceries,
    when: { userId: "u-1" },
    then: d.TodoList({
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
    then: d.TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 2,
      status: "open",
    }),
  })
  .test("A completed list shows as completed", {
    given: [groceries, d.ListCompleted({ userId: "u-1", listId: "list-1" })],
    when: { userId: "u-1" },
    then: d.TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "completed",
    }),
  })
  .test("A deleted list shows as deleted", {
    given: [groceries, d.ListDeleted({ userId: "u-1", listId: "list-1" })],
    when: { userId: "u-1" },
    then: d.TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "deleted",
    }),
  })
  .test("A user sees only their own lists", {
    given: [groceries, d.ListCreated({ listId: "list-2", userId: "u-2", name: "Hardware" })],
    when: { userId: "u-1" },
    then: d.TodoList({
      userId: "u-1",
      listId: "list-1",
      name: "Groceries",
      itemCount: 0,
      status: "open",
    }),
  })

m.slice()
  .view(d.ListItems)
  .event(d.ItemAdded, () => ({ done: t.literal(false), deleted: t.literal(false) }))
  .event(d.ItemCompleted, () => ({ done: t.literal(true) }))
  .event(d.ItemDeleted, () => ({ deleted: t.literal(true) }))
  .context({ listId: t.string() })
  .chapter(d.Views)
  .actor(d.User)
  .screen(d.ListScreen)
  .service(d.TodoService, "GetList")
  .test("A completed item shows as done", {
    given: [milk, milkDone],
    when: { listId: "list-1" },
    then: d.ListItems({
      listId: "list-1",
      itemId: "item-1",
      title: "Milk",
      done: true,
      deleted: false,
    }),
  })
  .test("A deleted item shows as deleted", {
    given: [milk, d.ItemDeleted({ listId: "list-1", itemId: "item-1" })],
    when: { listId: "list-1" },
    then: d.ListItems({
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
      d.ItemAdded({ userId: "u-1", listId: "list-2", itemId: "item-3", title: "Nails" }),
    ],
    when: { listId: "list-1" },
    then: [
      d.ListItems({
        listId: "list-1",
        itemId: "item-1",
        title: "Milk",
        done: false,
        deleted: false,
      }),
      d.ListItems({
        listId: "list-1",
        itemId: "item-2",
        title: "Eggs",
        done: false,
        deleted: false,
      }),
    ],
  })

m.slice()
  .view(d.ItemSearch)
  .event(d.ItemAdded, () => ({ done: t.literal(false), deleted: t.literal(false) }))
  .event(d.ItemCompleted, () => ({ done: t.literal(true) }))
  .event(d.ItemDeleted, () => ({ deleted: t.literal(true) }))
  .context({ text: t.string() })
  .chapter(d.Views)
  .actor(d.User)
  .service(d.TodoService, "SearchItems")
  .test("An added item shows as not done", {
    given: milk,
    when: { text: "Milk" },
    then: d.ItemSearch({
      itemId: "item-1",
      listId: "list-1",
      title: "Milk",
      done: false,
      deleted: false,
    }),
  })
  .test("A search finds a deleted item as deleted", {
    given: [milk, d.ItemDeleted({ listId: "list-1", itemId: "item-1" })],
    when: { text: "Milk" },
    then: d.ItemSearch({
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
    then: d.ItemSearch({
      itemId: "item-1",
      listId: "list-1",
      title: "Milk",
      done: true,
      deleted: false,
    }),
  })

m.chapter("Automations", 3)

m.slice("ListCompleter")
  .automation(d.ItemCompleted)
  .command(d.CompleteList)
  .query(d.TodoList, (c) => ({ userId: c.CompleteList.userId, listId: c.CompleteList.listId }))
  .event(d.ListCompleted)
  .chapter(d.Automations)
  .test("List completes when every item is done", {
    given: [groceries, milk, milkDone],
    when: d.CompleteList({ userId: "u-1", listId: "list-1" }),
    then: d.ListCompleted({ userId: "u-1", listId: "list-1" }),
  })

// The calendar pushes a scheduled task in, and we translate it into an item.
m.external("Calendar")

m.event("TaskScheduled", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  text: t.string(),
}).external(d.Calendar)

m.chapter("Integrations", 4)

m.slice()
  .translation(d.TaskScheduled)
  .command(d.AddItem)
  .event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
  .chapter(d.Integrations)
  .test("A scheduled task becomes an item", {
    given: [
      groceries,
      d.TaskScheduled({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    ],
    when: d.AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Flour" }),
    then: d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-4", title: "Flour" }),
  })
