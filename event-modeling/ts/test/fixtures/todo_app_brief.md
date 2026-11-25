# Todo List Application

## Overview

A simple application where users manage personal todo lists. Each list has a name and contains items that can be checked off.

## Requirements

1. Users can create a named todo list. List names must be unique per user — no two lists can share the same name.
2. Users can add items to a list. Each item has a title. A list can hold a maximum of 3 items.
3. Users can mark an item as done.
4. Users can delete an item from a list.
5. Users can delete an entire todo list (and all its items).
6. Users can view all their todo lists (name and item count for each).
7. Users can view a single list with all its items and their done/not-done status.
8. When all items in a list are marked done, the list is automatically marked as completed.
9. An external calendar system can push scheduled tasks into a list as new items.

## API

- `POST /v1/lists` — create a list
- `POST /v1/lists/{listId}/items` — add an item
- `PATCH /v1/lists/{listId}/items/{itemId}` — mark item done
- `DELETE /v1/lists/{listId}/items/{itemId}` — delete an item
- `DELETE /v1/lists/{listId}` — delete a list
- `GET /v1/lists` — view all lists
- `GET /v1/lists/{listId}` — view a single list with items

## Business Rules

- Maximum 3 items per list
- List names must be unique per user
- Deleting a list removes all its items
- A list is auto-completed when every item is done
