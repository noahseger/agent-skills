// The story starts with a user, the API they use, and what they do to lists.

import { d, m, t } from "#em"

// A person who keeps todo lists.
m.actor("User")

// The API every list operation goes through.
m.service("TodoService", "todo.v1")

// One list, open: its items are added, completed and deleted here.
m.screen("ListScreen")

// Two lanes in the diagram: what happens to items, and what happens to the lists that hold them.
m.stream("Items")
m.stream("Lists")

// A user creates a named list.
m.command("CreateList", { userId: t.string(), listId: t.string(), name: t.string() })
m.event("ListCreated", { listId: t.string(), userId: t.string(), name: t.string() })
  .note("Names are unique per user.")
  .stream(d.Lists)

// A user adds an item to a list. A list holds at most 3.
m.command("AddItem", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  text: t.string(),
})
m.event("ItemAdded", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
  title: t.string(),
}).stream(d.Items)

// A user marks an item done.
m.command("CompleteItem", {
  userId: t.string(),
  listId: t.string(),
  itemId: t.string(),
})
m.event("ItemCompleted", { userId: t.string(), listId: t.string(), itemId: t.string() }).stream(
  d.Items,
)

// A user removes an item from a list.
m.command("DeleteItem", { listId: t.string(), itemId: t.string() })
m.event("ItemDeleted", { listId: t.string(), itemId: t.string() }).stream(d.Items)

// A user deletes a whole list, items included.
m.command("DeleteList", { userId: t.string(), listId: t.string() })
m.event("ListDeleted", { userId: t.string(), listId: t.string() }).stream(d.Lists)

const groceries = d.ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })

m.chapter("ListManagement", 1)

m.slice()
  .command(d.CreateList)
  .event(d.ListCreated)
  .chapter(d.ListManagement)
  .actor(d.User)
  .service(d.TodoService)
  .spec("User creates a new list", {
    when: d.CreateList({ userId: "u-1", listId: "list-1", name: "Groceries" }),
    then: groceries,
  })
  .spec("Duplicate list name rejected", {
    given: groceries,
    when: d.CreateList({ userId: "u-1", listId: "list-2", name: "Groceries" }),
    reject: "list name already exists",
  })

m.slice()
  .command(d.AddItem)
  .event(d.ItemAdded, (c) => ({ title: c.AddItem.text }))
  .chapter(d.ListManagement)
  .actor(d.User)
  .screen(d.ListScreen)
  .service(d.TodoService)
  .spec("User adds an item to a list", {
    given: groceries,
    when: d.AddItem({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
    then: milk,
  })
  .spec("Adding a fourth item is rejected", {
    given: [
      milk,
      d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" }),
      d.ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-3", title: "Bread" }),
    ],
    when: d.AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Butter" }),
    reject: "maximum 3 items per list",
  })

m.slice()
  .command(d.CompleteItem)
  .event(d.ItemCompleted)
  .chapter(d.ListManagement)
  .actor(d.User)
  .screen(d.ListScreen)
  .service(d.TodoService)
  .spec("User completes an item", {
    given: milk,
    when: d.CompleteItem({ userId: "u-1", listId: "list-1", itemId: "item-1" }),
    then: d.ItemCompleted({ userId: "u-1", listId: "list-1", itemId: "item-1" }),
  })

m.slice()
  .command(d.DeleteItem)
  .event(d.ItemDeleted)
  .chapter(d.ListManagement)
  .actor(d.User)
  .screen(d.ListScreen)
  .service(d.TodoService)
  .spec("User deletes an item from a list", {
    given: milk,
    when: d.DeleteItem({ listId: "list-1", itemId: "item-1" }),
    then: d.ItemDeleted({ listId: "list-1", itemId: "item-1" }),
  })

m.slice()
  .command(d.DeleteList)
  .event(d.ListDeleted)
  .chapter(d.ListManagement)
  .actor(d.User)
  .service(d.TodoService)
  .spec("User deletes a list", {
    given: groceries,
    when: d.DeleteList({ userId: "u-1", listId: "list-1" }),
    then: d.ListDeleted({ userId: "u-1", listId: "list-1" }),
  })
