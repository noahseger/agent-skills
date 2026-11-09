// The story starts with a user, the API they use, and what they do to lists.

import { m, z } from "#em"

// A person who keeps todo lists.
export const User = m.actor()

// The API every list operation goes through.
export const TodoService = m.service("todo.v1")

// One list, open: its items are added, completed and deleted here.
export const ListScreen = m.screen()

// Two lanes in the diagram: what happens to items, and what happens to the lists that hold them.
export const Items = m.stream()
export const Lists = m.stream()

// A user creates a named list.
export const CreateList = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
export const ListCreated = m
  .event({ listId: z.string(), userId: z.string(), name: z.string() })
  .note("Names are unique per user.")
  .stream(Lists)

// A user adds an item to a list. A list holds at most 3.
export const AddItem = m.command({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
  text: z.string(),
})
export const ItemAdded = m
  .event({
    userId: z.string(),
    listId: z.string(),
    itemId: z.string(),
    title: z.string(),
  })
  .stream(Items)

// A user marks an item done.
export const CompleteItem = m.command({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
})
export const ItemCompleted = m
  .event({ userId: z.string(), listId: z.string(), itemId: z.string() })
  .stream(Items)

// A user removes an item from a list.
export const DeleteItem = m.command({ listId: z.string(), itemId: z.string() })
export const ItemDeleted = m.event({ listId: z.string(), itemId: z.string() }).stream(Items)

// A user deletes a whole list, items included.
export const DeleteList = m.command({ userId: z.string(), listId: z.string() })
export const ListDeleted = m.event({ userId: z.string(), listId: z.string() }).stream(Lists)

const groceries = ListCreated({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })

export const ListManagement = m.chapter()

m.slice()
  .command(CreateList, ListCreated)
  .chapter(ListManagement)
  .actor(User)
  .service(TodoService)
  .test("User creates a new list", {
    when: CreateList({ userId: "u-1", listId: "list-1", name: "Groceries" }),
    then: groceries,
  })
  .test("Duplicate list name rejected", {
    given: groceries,
    when: CreateList({ userId: "u-1", listId: "list-2", name: "Groceries" }),
    reject: "list name already exists",
  })

m.slice()
  .command(
    AddItem,
    ItemAdded((c) => ({ title: c.text })),
  )
  .chapter(ListManagement)
  .actor(User)
  .screen(ListScreen)
  .service(TodoService)
  .test("User adds an item to a list", {
    given: groceries,
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
    then: milk,
  })
  .test("Adding a fourth item is rejected", {
    given: [
      milk,
      ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" }),
      ItemAdded({ userId: "u-1", listId: "list-1", itemId: "item-3", title: "Bread" }),
    ],
    when: AddItem({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Butter" }),
    reject: "maximum 3 items per list",
  })

m.slice()
  .command(CompleteItem, ItemCompleted)
  .chapter(ListManagement)
  .actor(User)
  .screen(ListScreen)
  .service(TodoService)
  .test("User completes an item", {
    given: milk,
    when: CompleteItem({ userId: "u-1", listId: "list-1", itemId: "item-1" }),
    then: ItemCompleted({ userId: "u-1", listId: "list-1", itemId: "item-1" }),
  })

m.slice()
  .command(DeleteItem, ItemDeleted)
  .chapter(ListManagement)
  .actor(User)
  .screen(ListScreen)
  .service(TodoService)
  .test("User deletes an item from a list", {
    given: milk,
    when: DeleteItem({ listId: "list-1", itemId: "item-1" }),
    then: ItemDeleted({ listId: "list-1", itemId: "item-1" }),
  })

m.slice()
  .command(DeleteList, ListDeleted)
  .chapter(ListManagement)
  .actor(User)
  .service(TodoService)
  .test("User deletes a list", {
    given: groceries,
    when: DeleteList({ userId: "u-1", listId: "list-1" }),
    then: ListDeleted({ userId: "u-1", listId: "list-1" }),
  })
