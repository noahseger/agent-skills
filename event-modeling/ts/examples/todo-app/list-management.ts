// The story starts with a user, the API they use, and what they do to lists.

import { z } from "zod"
import { m } from "#em"

// A person who keeps todo lists.
export const User = m.actor()

// The API every list operation goes through.
export const TodoService = m.service("todo.v1")

// A user creates a named list.
export const CreateList = m.command({ userId: z.string(), listId: z.string(), name: z.string() })
export const ListCreated = m
  .event({ listId: z.string(), userId: z.string(), name: z.string() })
  .note("Names are unique per user.")
export const DuplicateName = m.rejected("list name already exists")

// A user adds an item to a list. A list holds at most 3.
export const AddItem = m.command({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
  text: z.string(),
})
export const ItemAdded = m.event({
  userId: z.string(),
  listId: z.string(),
  itemId: z.string(),
  title: z.string(),
})
export const TooManyItems = m.rejected("maximum 3 items per list")

// A user marks an item done.
export const CompleteItem = m.command({ listId: z.string(), itemId: z.string() })
export const ItemCompleted = m.event({ listId: z.string(), itemId: z.string() })

// A user removes an item from a list.
export const DeleteItem = m.command({ listId: z.string(), itemId: z.string() })
export const ItemDeleted = m.event({ listId: z.string(), itemId: z.string() })

// A user deletes a whole list, items included.
export const DeleteList = m.command({ listId: z.string() })
export const ListDeleted = m.event({ listId: z.string() })

const groceries = ListCreated.with({ listId: "list-1", userId: "u-1", name: "Groceries" })
const milk = ItemAdded.with({ userId: "u-1", listId: "list-1", itemId: "item-1", title: "Milk" })

export const ListManagement = m.chapter([
  m
    .slice()
    .actor(User)
    .service(TodoService)
    .command(CreateList)
    .emits(ListCreated)
    .test("User creates a new list", {
      when: CreateList.with({ userId: "u-1", listId: "list-1", name: "Groceries" }),
      then: groceries,
    })
    .test("Duplicate list name rejected", {
      given: groceries,
      when: CreateList.with({ userId: "u-1", listId: "list-2", name: "Groceries" }),
      then: DuplicateName,
    }),

  m
    .slice()
    .actor(User)
    .service(TodoService)
    .command(AddItem)
    .emits(ItemAdded, (c) => ({ title: c.text }))
    .test("User adds an item to a list", {
      given: groceries,
      when: AddItem.with({ userId: "u-1", listId: "list-1", itemId: "item-1", text: "Milk" }),
      then: milk,
    })
    .test("Adding a fourth item is rejected", {
      given: [
        milk,
        ItemAdded.with({ userId: "u-1", listId: "list-1", itemId: "item-2", title: "Eggs" }),
        ItemAdded.with({ userId: "u-1", listId: "list-1", itemId: "item-3", title: "Bread" }),
      ],
      when: AddItem.with({ userId: "u-1", listId: "list-1", itemId: "item-4", text: "Butter" }),
      then: TooManyItems,
    }),

  m
    .slice()
    .actor(User)
    .service(TodoService)
    .command(CompleteItem)
    .emits(ItemCompleted)
    .test("User completes an item", {
      given: milk,
      when: CompleteItem.with({ listId: "list-1", itemId: "item-1" }),
      then: ItemCompleted.with({ listId: "list-1", itemId: "item-1" }),
    }),

  m
    .slice()
    .actor(User)
    .service(TodoService)
    .command(DeleteItem)
    .emits(ItemDeleted)
    .test("User deletes an item from a list", {
      given: milk,
      when: DeleteItem.with({ listId: "list-1", itemId: "item-1" }),
      then: ItemDeleted.with({ listId: "list-1", itemId: "item-1" }),
    }),

  m
    .slice()
    .actor(User)
    .service(TodoService)
    .command(DeleteList)
    .emits(ListDeleted)
    .test("User deletes a list", {
      given: groceries,
      when: DeleteList.with({ listId: "list-1" }),
      then: ListDeleted.with({ listId: "list-1" }),
    }),
])

// Two lanes in the diagram: what happens to lists, and what happens to items.
export const Lists = m.stream({ CreateList, ListCreated, DeleteList, ListDeleted })
export const Items = m.stream({
  AddItem,
  ItemAdded,
  CompleteItem,
  ItemCompleted,
  DeleteItem,
  ItemDeleted,
})
