---
name: event-modeling
description: Use to model a system's behavior as domain events, extract an event model from existing code, design event-driven architectures, or document workflows as timelines of commands, events, and state views
---

# Event Modeling

## Overview

Event modeling captures a system as a left-to-right **timeline** connecting five elements: **interfaces** (real entry points), **commands** (what actors intend), **events** (facts that happened), **read models** (what the system knows), and **automations** (event-driven side effects).

The visualization uses two kinds of swim lanes:
- **Actor lanes** at the top — one row per actor (user, admin, external system), containing the real interfaces they use
- **Aggregate lanes** in the middle — one row per DDD aggregate / event stream, containing commands and events

## Why Event Modeling

Most software projects suffer from **feature explosion** — each new feature adds coupling, and coupling makes the next feature more expensive. The cost curve steepens until deadlines slip, budgets explode, and teams build the wrong thing because of **bad communication**, **wrong assumptions**, and **misunderstood requirements**. Building the wrong thing is the most expensive mistake in any project.

The root cause is never technology. No amount of architectural refinement fixes a communication problem. Event modeling solves this by providing a **shared language** that engineers, business experts, and AI agents all understand — five elements, four patterns, read left to right. One model, one truth, readable by anyone.

## When to Use

- Documenting an existing system's behavior
- Designing a new feature or system with event sourcing
- Understanding domain boundaries and bounded contexts
- Creating integration contracts between teams
- Planning vertical slices for parallel development

## The Practice

Event modeling is **capture, not design**. The goal is to discover and record what happens in a system — the events, the commands that cause them, and the read models that make sense of them. The language is "identify," "discover," "capture" — never "design" or "architect."

The practice follows a natural progression:

1. **Storm** — Brainstorm domain events on a timeline. No commands, no read models yet. Just "what happened?"
2. **Capture** — Organize events into aggregates and chapters. Identify commands that cause events and read models that make sense of them.
3. **Specify** — Write GWT tests with concrete example data for each slice. The tests ARE the specification.
4. **Deliver** — Extract vertical slices for parallel development. Each slice is independently buildable and testable.
5. **Evolve** — Update the model as production reveals gaps. New events, new slices, revised read models.

When extracting from existing code, you're doing Capture and Specify simultaneously — the code already tells you what commands produce what events. When modeling from scratch, start with Storm.

## The V Pattern

Every state-change slice follows a **V-shaped information flow**:

1. User sees a **read model** (green) — "here's what the system knows"
2. User submits a **command** (blue) — "here's what I want to happen"
3. System records an **event** (orange) — "here's what happened"
4. Event updates the **read model** (green) — ready for the next step

The V shape is the heartbeat of the system. Read model feeds the UI, UI triggers a command, command produces an event, event updates the read model. Repeat. Every feature is one or more V's on the timeline.

## Information Completeness

**You cannot start implementation until the model is information complete.** Information completeness is checked **within each slice** — every field must be traceable to a data source that exists inside that slice.

Two directions, both required:

1. **Read model ← Event (projection):** Every field displayed in a read model must trace back to a field in an event. If a view shows "total price," there must be an event carrying that data.

2. **Event ← Inputs (provenance):** Every field in an event must trace back to a data source within the slice. Those sources are:
   - **Command parameters** — fields the actor provides (e.g. `PlaceOrder(customerId, items)`)
   - **Trigger event** — for automation slices, the event that triggered the automation
   - **External event** — for external event slices, the inbound event from outside the system
   - **Consumed read models** — read models the slice reads to do its work, declared in GWT `given` clauses

If an event contains a field that doesn't appear in any of these sources, the model has an information gap — that field's data comes from somewhere not captured in the model. This is the most common information completeness mistake: an event field that materializes from a hidden data source.

**Example — automation consuming a read model:**

An `OnOrderPlaced` automation triggers `ReserveInventory`. The trigger event `OrderPlaced` carries `orderId, items`. But the automation also needs current stock levels to decide which warehouse to reserve from. The `InventoryLevel` read model (with `sku, available, reserved`) appears in the GWT `given` clause. Now `InventoryReserved(orderId, items, warehouseId)` is information complete: `orderId` and `items` come from the trigger, `warehouseId` comes from the consumed `InventoryLevel` read model.

**Example — hidden data source (antipattern):**

A `StartSync` command takes `(bucket, path)` from the operator, but the `SyncStarted` event records `(bucket, path, remoteCount, localCount)`. Where do `remoteCount` and `localCount` come from? The command handler secretly reads remote and local state — but those data sources aren't declared anywhere in the slice. The fix: either move the computation to a downstream automation that explicitly consumes the read models, or add the consumed read models to the slice's GWT `given` clause so the data sources are visible.

Missing information blocks work. A field with no source might depend on another team's API with a 3-month backlog — discovering this during implementation instead of during modeling is the most expensive mistake you can make.

The `event_model.py` validator enforces both directions:

1. **Projection check (State Change / Automation)** — every `read_models` entry must share at least one field with the slice's events.
2. **Projection check (State View) — strict** — every field in a State View's read model must appear in the union of trigger event fields and consumed read model fields (from `reads`). For multi-trigger State Views, the union of all trigger fields is used.
3. **Provenance check** — every event field must be connected to its inputs: the command, trigger(s), external event, or consumed read model in `reads`. Fields that don't trace by name are flagged as warnings when `reads` is present, or errors when `reads` is empty.
4. **Automation command strictness** — every field in an automation command must trace to a non-command source (trigger, external event, consumed read models). Commands receive data; they don't invent it.
5. **Cross-reference check** — every read model name in `reads` must exist in some other slice's `read_models`.

**Commands declare their full interface** — not just what they receive, but the complete set of fields the handler works with. For transformation steps like encoding or exporting, include both input and output field names in the command schema. This makes every event field traceable by name to a declared schema.

## Tooling: event_model.py

The `event_model.py` script in this skill directory is the primary tool for creating and visualizing event models. It enforces a Pydantic schema with invariant validation and renders SVG diagrams.

### Commands

```bash
python event_model.py validate <model.json>   # Validate schema + invariants
python event_model.py render <model.json>      # Render to SVG
python event_model.py schema                   # Print JSON schema
python event_model.py init <model.json>        # Create template
```

### Schema Enforcement

The tool validates these invariants automatically:
- **Events must be past tense** (e.g. OrderPlaced, UserRegistered — not PlaceOrder)
- **External events must be past tense** (e.g. ExternalPaymentReceived — not ExternalReceivePayment)
- **Commands must be imperative** (e.g. PlaceOrder, RegisterUser — not OrderPlaced)
- **Automations must have a trigger** — every gear is driven by an event or a TODO-list read model
- **GWT tests must include concrete example data** — real values like `userId=42, amount=59.98`
- **Actor and aggregate references must exist** in the model's actor/aggregate lists
- **Read model fields must overlap with events** — at least one field in a read model must exist in the slice's events. Additive events (e.g. ItemAdded) carry all view fields; destructive events (e.g. ItemRemoved, CartCleared) carry only identifying fields needed to update or delete rows

### JSON Model Structure

```json
{
  "name": "Order Management",
  "source_base": "https://github.com/org/repo/blob/main",
  "actors": [
    { "id": "customer", "name": "Customer", "type": "user" },
    { "id": "warehouse", "name": "Warehouse System", "type": "system" },
    { "id": "payments", "name": "Payment Provider", "type": "external" }
  ],
  "aggregates": [
    { "id": "order", "name": "Order" },
    { "id": "inventory", "name": "Inventory" }
  ],
  "chapters": [
    {
      "name": "Order Lifecycle",
      "slices": [
        {
          "name": "Place Order",
          "actor": "customer",
          "aggregate": "order",
          "ui": "POST /v1/orders",
          "command": "PlaceOrder(customerId, items, shippingAddress)",
          "events": ["OrderPlaced(orderId, customerId, items, total)"],
          "read_models": ["OrderSummary(orderId, customerId, status, total)"],
          "tests": [
            {
              "name": "Customer places order with two items",
              "given": [],
              "when": "PlaceOrder(customerId=c-42, items=[sku-1, sku-2], shippingAddress=123 Main St)",
              "then": ["OrderPlaced(orderId=ord-100, customerId=c-42, items=[sku-1, sku-2], total=59.98)"]
            }
          ]
        },
        {
          "name": "View Order",
          "actor": "customer",
          "aggregate": "order",
          "ui": "GET /v1/orders/{orderId}",
          "read_models": ["OrderSummary(orderId, customerId, status, total)"],
          "tests": []
        }
      ]
    },
    {
      "name": "Fulfillment",
      "slices": [
        {
          "name": "Reserve Inventory",
          "actor": "warehouse",
          "aggregate": "inventory",
          "automation": "OnOrderPlaced",
          "trigger": "OrderPlaced",
          "command": "ReserveInventory(orderId, items)",
          "events": ["InventoryReserved(orderId, items, warehouseId)"],
          "read_models": ["InventoryLevel(sku, warehouseId, available, reserved)"],
          "tests": [
            {
              "name": "Inventory reserved after order placed",
              "given": [
                "OrderPlaced(orderId=ord-100, items=[sku-1])",
                "InventoryLevel(sku=sku-1, available=50, reserved=0)"
              ],
              "when": "ReserveInventory(orderId=ord-100, items=[sku-1])",
              "then": ["InventoryReserved(orderId=ord-100, items=[sku-1], warehouseId=wh-east)"]
            }
          ]
        }
      ]
    },
    {
      "name": "External Payment Events",
      "slices": [
        {
          "name": "Confirm Payment",
          "actor": "payments",
          "aggregate": "order",
          "external_event": "ExternalPaymentReceived(orderId, amount, transactionId)",
          "command": "ConfirmPayment(orderId, amount, transactionId)",
          "events": ["PaymentConfirmed(orderId, amount, transactionId)"],
          "read_models": ["OrderSummary(orderId, customerId, status, total)"],
          "tests": [
            {
              "name": "Payment confirmed updates order status",
              "given": ["ExternalPaymentReceived(orderId=ord-100, amount=59.98, transactionId=txn-7)"],
              "when": "ConfirmPayment(orderId=ord-100, amount=59.98, transactionId=txn-7)",
              "then": ["PaymentConfirmed(orderId=ord-100, amount=59.98, transactionId=txn-7)"]
            }
          ]
        }
      ]
    }
  ]
}
```

### Slice Types

Every slice has an optional **`name`** field — a short human-readable label (e.g. "Place Order", "OAuth Callback"). When present, names render as column headers in the SVG diagram and appear in validation error messages. Always provide a name.

The model supports three kinds of slices:

| Slice Type | Required Fields | Description |
|-----------|----------------|-------------|
| **Command slice** | `ui` + `command` + `events` | Actor uses an interface to issue a command that produces events |
| **External event slice** | `external_event` + `command` + `events` | An event from outside the system boundary triggers an internal command |
| **View-only slice** | `ui` + `read_models` (no command/events) | Actor queries a read model through an interface — no state change |
| **Automation slice** | `automation` + `trigger` + `command` + `events` | An event triggers an automated side effect |
| **State View slice** | `trigger` + `read_models` (no command/events/ui) | Event triggers a read model projection |

**State View with reads:** A State View can declare `reads` to access data from consumed read models in addition to its trigger event. The trigger is the availability signal ("this data is ready"); the reads provide the actual data. The validator checks that every read model field appears in the union of trigger fields AND consumed read model fields.

```json
{
  "name": "Project Archive Games",
  "trigger": "PeriodExported(period, gameCount, gcsPath)",
  "reads": ["BufferedGames"],
  "read_models": ["ArchiveGames*(*period, gameCount, gcsPath, gameKey, endedAt, ...)"]
}
```

**Multi-trigger State Views:** A State View's `trigger` field can be a single event string or a list of event strings. When a read model accumulates data from multiple event types (common in CQRS projections), list all the events the projection subscribes to. The validator checks that every read model field appears in the **union** of all trigger event fields.

### Cardinality Notation

Read models and fields use `*` to indicate cardinality and aggregate pointers:

- **`ReadModel*`** — suffix `*` on the name indicates a collection (many rows), not a singleton
- **`*field`** — prefix `*` on a field name indicates an aggregate pointer / partition key

```json
"read_models": ["BufferedGames*(*period, gameKey, endedAt, startedAt, variant, ...)"]
```

This says: BufferedGames is a collection partitioned by period, containing game records with all their fields. Downstream slices that `reads: ["BufferedGames"]` have access to the full schema.

### Processor Naming

Automation slices should use descriptive processor names that describe WHAT the automation does, not WHAT triggers it. The trigger event is already shown via the `trigger` field.

| Instead of | Use |
|-----------|-----|
| `OnOrderPlaced` | `InventoryReserver` |
| `OnPeriodAggregated` | `PeriodExporter` |
| `OnMonthPeriodsDownloaded` | `MonthEncoder` |

The `On*` naming duplicates information that's already in the trigger field and tells the reader nothing about what the processor actually does.

### Source Code Annotations

Cards can link to source code with the `refs` field on slices and `source_base` on the model. Keys are the full element label (matching `command`, `events[]`, `read_models[]`, `ui`, `external_event`). Values are lists of `{label, path}` objects.

- **`source_base`** (model-level, optional): URL prefix for relative paths (e.g. `"https://github.com/org/repo/blob/main"`)
- **`refs`** (slice-level, optional): `dict[str, list[SourceRef]]` mapping element labels to annotations
- **Single ref**: card becomes clickable (`<a href>`) with `↗` indicator and tooltip
- **Multiple refs**: annotation panel renders below the card with clickable `↗ Label` links
- **Layout**: aggregate lanes and actor lanes expand automatically when annotation panels are present. Models without refs render identically to before.

```json
{
  "refs": {
    "AddItem(aggregateId, itemId, productId)": [
      { "label": "Command", "path": "src/main/kotlin/.../AddItemCommand.kt#L7" },
      { "label": "Handler", "path": "src/main/kotlin/.../CartAggregate.kt#L35" }
    ],
    "ItemAdded(aggregateId, itemId, productId)": [
      { "label": "Event", "path": "src/main/kotlin/.../ItemAddedEvent.kt#L8" }
    ]
  }
}
```

Paths can be relative (resolved against `source_base`) or absolute URLs (`https://...`, `vscode://...`).

### SVG Diagram Layout

The rendered diagram uses this vertical layout:

1. **Title** — model name
2. **Chapter headers** — blue bars spanning each chapter's columns
3. **Actor swimlanes** — one row per actor, containing:
   - UI/interface cards (grey) for internal entry points
   - External event cards (orange) for events arriving from outside the system boundary
   - Automation gears (purple) for event-driven side effects
4. **Read model row** — green cards near the top (they feed the interfaces above), shifted right to clear down-flow arrows
5. **Aggregate swim lanes** — horizontal bands per DDD aggregate, containing:
   - Command cards (blue) in the upper part
   - Event cards (orange) in the lower part
6. **GWT tests** — Given/When/Then cards aligned under each slice, with wrapped test names

### Arrow Semantics

- **Interface → Command**: solid grey down arrow from actor lane to aggregate lane (actor initiates)
- **External Event → Command**: dashed orange down arrow from actor lane to aggregate lane (external system pushes data in)
- **Automation → Command**: solid purple down arrow from actor lane to aggregate lane (gear triggers)
- **Command → Event**: solid grey down arrow within aggregate lane
- **Event → Read Model**: dashed green up arrow from aggregate lane to read model row (projection)
- **Read Model → Interface**: dashed green up arrow (feeds screen, view-only slices)
- **Event → Automation**: L-shaped dashed purple arrow from event up to gear in actor lane
- **NEVER event → event** — events are facts, they don't cause each other
- **Down-flow arrows offset left (35%)**, up-flow arrows offset right (65%) — prevents visual overlap

## Process

### Phase 0: Event Storm (Greenfield or Discovery)

When modeling a new system or discovering behavior before reading code, start by brainstorming events:

1. List everything that happens in the domain — past tense facts like `OrderPlaced`, `PaymentReceived`, `ItemShipped`
2. Arrange events on a left-to-right timeline
3. Sketch rough screens — ugly wireframes showing what users see and what buttons they click. Spend no more than 2 minutes per screen. Screens drive read model discovery: what information does the user need to see?
4. Don't worry about commands, read models, or aggregates yet — just events and screens
5. Group related events to discover natural aggregate boundaries

This phase is optional when extracting from code (Phase 1 covers discovery through code reading), but valuable when:
- Starting a new feature with no existing code
- Onboarding domain experts who think in terms of "what happens"
- The codebase is too large to read first — brainstorm then validate against code

### Phase 1: Clone and Read the Code (Extraction)

**When extracting from existing code, this is the foundation.** You MUST read the actual source code before modeling.

1. Clone the repository into `./workspace/`
2. Read entry points: REST controllers, RPC/gRPC service implementations, Kafka consumers, message handlers
3. Identify actors: users, admins, external systems, scheduled jobs
4. Identify aggregates: the core entities whose state changes matter
5. List the core workflows as user stories (beginning, middle, end)

### Phase 2: Identify Real Interfaces and External Events

**NEVER hallucinate interface names.** Use `ui` for internal entry points and `external_event` for inbound events from outside the system boundary.

**Internal interfaces** (`ui` field) — entry points the system exposes:

| Interface Type | Example | What to Look For |
|---------------|---------|-----------------|
| REST endpoint | `POST /v1/orders` | Controller classes, route definitions |
| gRPC/RPC service | `OrderService.PlaceOrder` | Proto files, service implementations |
| Cron/scheduled job | `CronJob: daily-cleanup` | Scheduler configs, job classes |
| Query endpoint | `GET /v1/orders/{orderId}` | Read-only controllers (view-only slices) |

**External events** (`external_event` field) — events arriving from outside the system boundary:

| Source | Example | What to Look For |
|--------|---------|-----------------|
| Kafka topic | `ExternalPriceChanged(productId, newPrice, oldPrice)` | Kafka consumers, message handlers |
| Webhook | `ExternalPaymentReceived(orderId, amount)` | Webhook controllers, event handlers |
| Message queue | `ExternalAccountCreated(userId, username)` | SQS/RabbitMQ consumers |

**Key distinction:** If an external system pushes data *into* your system via a message/event, use `external_event` (rendered as an orange card with a dashed orange arrow). If a user or system calls an endpoint you expose, use `ui` (rendered as a grey card with a solid grey arrow).

### Phase 3: Walk the Happy Path

For one workflow at a time, trace from trigger to completion:

| Element | Convention | Example |
|---------|-----------|---------|
| **Interface** | Real entry point from code | `POST /v1/orders` |
| **External Event** | CamelCase past tense, prefixed with External | `ExternalPaymentReceived(orderId, amount)` |
| **Command** | CamelCase imperative, with schema | `PlaceOrder(customerId, items)` |
| **Event** | CamelCase past tense, with schema | `OrderPlaced(orderId, items, total)` |
| **Read Model** | CamelCase noun, with schema | `OrderSummary(orderId, status, total)` |
| **Automation** | CamelCase descriptive processor name | `InventoryReserver` |

### Phase 4: Organize

1. Group events by **aggregate** (Order, Inventory, Payment, etc.) — these become swim lanes
2. Arrange on timeline left-to-right
3. Group related slices into **chapters** (Order Lifecycle, Fulfillment, etc.)
4. One command per slice — if there are 2 commands, the slice is too big

### Phase 5: Define Test Specifications

Define GWT tests **collaboratively with business experts** — not in isolation. Each slice gets GWT tests with **concrete example data** — real IDs, real numbers, real outcomes. Business knowledge becomes an executable specification in code:

```json
{
  "name": "Inventory reserved after order placed",
  "given": [
    "OrderPlaced(orderId=ord-100, items=[sku-1])",
    "InventoryLevel(sku=sku-1, available=50, reserved=0)"
  ],
  "when": "ReserveInventory(orderId=ord-100, items=[sku-1])",
  "then": [
    "InventoryReserved(orderId=ord-100, items=[sku-1], warehouseId=wh-east)"
  ]
}
```

**Projection check:** For each read model in a slice, verify that the read model shares at least one field with the slice's events. Additive events (e.g. `ItemAdded`) should carry all the data the view needs. Destructive events (e.g. `ItemRemoved`, `CartCleared`) only need identifying fields — enough to locate and remove rows. The validator enforces field overlap automatically.

### Phase 6: Generate the Diagram

```bash
python event_model.py render model.json -o model.svg
```

Open the SVG in a browser to review. Iterate on the model until the diagram clearly tells the story of the system.

### Phase 7: Extract Vertical Slices for Delivery

Each slice in the model is an independently buildable and testable unit of work:

1. Identify slices with no dependencies on other slices — these can be built first
2. Map automation triggers to find natural ordering — a slice producing an event that triggers an automation defines a build dependency
3. Assign independent slices to developers for parallel implementation
4. Use the GWT tests from Phase 5 as acceptance criteria for each slice

### Phase 8: Evolve the Model

Event models are living documents. When production reveals gaps:

1. Observe unexpected behavior or missing capabilities in the running system
2. Add new events, commands, or slices to the model to capture the gap
3. Re-validate and re-render to verify the model still tells a coherent story
4. Treat the updated model as the specification for the fix

## Slices as Work Items

Each slice in the event model is a **natural work item** — independently buildable, testable, and assignable. The event model IS the backlog. Detailed Jira tickets are unnecessary when every slice already captures the interface, command, events, read models, and GWT acceptance criteria.

Slices follow a simple status progression: **planned → in progress → done**. Pick the next planned slice, implement it, verify the GWT tests pass, mark it done. The model tracks what's been built and what remains.

Because slices are independent — **events are the only contract between them** — multiple developers or agents can work on different slices in parallel without conflicts. Adding more people to the project makes it faster, not slower.

## AI Agent Integration

Event models are the perfect input for AI code generation. Each slice is **exactly the right level of abstraction** for an AI agent — small enough to fit in context, specific enough to produce correct code, and testable via GWT.

The combination works like this:
- **Static code generation** handles the repeatable boilerplate — every slice produces the same predictable structure (route, command handler, event, projection, test file)
- **AI agents** handle the business logic — the part that varies between slices, guided by GWT tests as guardrails
- **GWT tests are executable specifications** — defined collaboratively with business experts, they become the acceptance criteria that verify the agent built what was specified

Each slice type (state change, state view, automation) follows a known pattern. Agents don't need to invent architecture — they fill in the business-specific details within a well-defined structure.

## Key Invariants

- **Events are immutable facts** in past tense — never update, only append
- **Commands are imperative intents** — each produces one or a small cluster of events
- **Read models are pure functions of events** — given same events, same view
- **Projections are State View slices** — each read model projection gets its own State View slice with `trigger` (the event it subscribes to) and `read_models` (what it builds). State Change slices produce events; State View slices project events into read models. `reads` lists read models consumed by the slice's command (inputs from other slices). The read model names in `reads` must exist in some State View slice's `read_models`.
- **Event fields must trace to declared sources** — every field in an event must come from: (1) the command, trigger, or external event, (2) a consumed read model declared in `reads`, or (3) a produced read model of the same slice (transformation output). The validator enforces this exhaustively. If a command handler reads external state, that state must be declared in `reads`.
- **Not every event needs a read model** — terminal events that cross the system boundary outward (e.g. publishing to a Kafka topic for other bounded contexts) have no projection within this system. They are valid dead ends on the timeline.
- **Read models feed interfaces** — they belong near the top, close to the entry points they serve
- **External events represent inbound data from outside the system** — Kafka topics, webhooks, message queues. Use `external_event` (not `ui`) for these. They render as orange cards with dashed orange arrows.
- **View-only slices show read model consumption** — `ui` + `read_models` without command/events. They render a green dashed arrow from read model up to the interface.
- **Actor swimlanes show real interfaces** — REST endpoints, RPC methods — NEVER made-up screen names
- **Aggregate swimlanes contain commands and events** — grouped by DDD aggregate / event stream
- **Automations are driven by events or TODO lists** — never standalone, always show the trigger
- **Every state change appears on the timeline** — no hidden triggers or side effects
- **Names are CamelCase** — no spaces, e.g. `PlaceOrder` not `Place Order`
- **GWT uses concrete data** — real IDs, real numbers, real outcomes
- **Business language only** — no "DAO persisted" or "saga timed out"
- **Each slice is independently buildable and testable** — events are the only contract between slices. No slice depends on another slice's internals. This independence enables parallel work by multiple developers or AI agents.
- **One command per slice** — if there are 2 commands, break it into 2 slices
- **Every event connects forward** — each event should either feed a read model (projection) or trigger an automation. Events that connect to nothing are dead ends (unless they cross the system boundary outward, e.g. publishing to Kafka for another bounded context).
- **Read models grow progressively** — a single read model can accumulate fields as more events project into it. Don't invent separate read models per phase when one growing projection captures the domain.
- **Capture, don't design** — event modeling discovers what happens in a system. Use language like "identify," "capture," "discover" — not "design" or "architect." The model records reality, it doesn't prescribe it.

## Plain English

- event: "something that happened in the system"
- external event: "something that happened outside the system that we need to react to" — arrives via Kafka, webhook, message queue
- command: "something we want to happen in the system"
- read model: "making sense of what happened in the system"
- interface: "the real entry point where actors interact with the system" — a REST endpoint, RPC method, or cron job
- automation: "side effect of what happens in the system" — always driven by an event or TODO list, always issues a command

## Antipatterns

- **Hallucinated interfaces** — using made-up screen names like "OrderDashboard" instead of the actual `POST /v1/orders` endpoint
- **Using `ui` for external events** — if a Kafka consumer or webhook receives data from another system, use `external_event` not `ui`. The arrow direction and rendering are different.
- **One command always producing multiple events simultaneously** (suggests the events should be combined into one). Note: alternative outcomes from one command (success/failure) are NOT an antipattern — model the primary outcome in `events` and capture alternatives in GWT `then` clauses.
- One slice with multiple commands
- Many events updating the same read model
- Events with arrows into other events (events don't cause each other)
- Read models at the bottom of the diagram (they feed interfaces, put them near the top)
- Swim lanes for element types (Commands/Events/ReadModels) instead of aggregates
- Names with spaces instead of CamelCase
- GWT with placeholder schemas instead of concrete example data
- Standalone automations not driven by an event or TODO-list read model
- "The thing" — too much business logic in a single slice
- **Dead-end events** — events that don't feed any read model or trigger any automation, with no justification (terminal boundary events are the exception)
- **Invented read model names** — read models should use domain terms the team already uses. If you can't name it from the domain vocabulary, it may not be a real concept.
- **Inline projections** — putting read models as outputs of state change slices instead of giving each projection its own State View slice. Projections are their own slices: a State View with a `trigger` (the event it subscribes to) and `read_models` (what it builds). State Change slices produce events; State View slices project events into read models.
- **Hidden data sources in events** — an event field that doesn't trace to any input within the slice (command, trigger, external event, or consumed read model in `given`). Example: `SyncStarted(bucket, path, remoteCount)` where `remoteCount` comes from querying an external system that isn't declared as a consumed read model. Fix: add the consumed read model to the GWT `given`, or move the computation to a downstream automation that explicitly consumes the read model.
- **"Design" language** — saying "design the read models" or "architect the commands." Event modeling captures what happens; it doesn't prescribe what should happen.
