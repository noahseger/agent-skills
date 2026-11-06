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

A TypeScript model is checked in both directions as it assembles: a field nothing fills, or a column no event writes, is an error that names the slice. A model written as JSON is checked against the schema only, so the tracing is yours.

**A command lists what the actor sends.** When the handler renames a field or computes one, say where it comes from in the field's `mapping` (see "Spec JSON") instead of padding the command with output fields. Every event field then traces either by name or through the mapping.

## Finish the Model

Event modeling earns its keep by moving discovery to the cheapest phase. A gap found while modeling costs a sentence; the same gap found during implementation costs a rewrite; found in production it costs an incident. Closing every loop now — so no one pays for it later — is the disciplined and genuinely *lazy* move.

When a thread leads somewhere, follow it to the end:

- An event feeds a read model or triggers an automation (see "Every event connects forward").
- A read model that tracks a condition the domain reacts to — a count nearing a limit, a status, a deadline — has a slice that acts on that condition. State that leads nowhere is a gap one level up from a dead-end event. If an `IllegalMoveTally` reaches the count that ends the game, some slice must consume that threshold.
- A domain rule you uncover while modeling — "a second illegal move forfeits the game," "an invoice unpaid after 30 days is written off" — gets captured, not shelved.

**Don't put domain truths to a vote.** When the domain determines something and it traces to a source, model it — don't surface a real, traceable rule as an optional add-on. Flagging a rule you already understand instead of capturing it just relocates the decision, and the work, to a more expensive moment. Reserve questions for genuine forks: real disagreement, irreversible cost, or facts only a domain expert holds. Everything the domain already decides, you model.

The same discipline runs in reverse — **invent nothing.** No event, read model, or slice that isn't a real domain concept (see "Invented read model names"). Model every real thing; add nothing spurious. Both halves serve one goal: minimize the total work the system demands over its life.

## Tooling: two ways in

Write the model as TypeScript in `ts/`, or write it directly as [event-modeling-spec](https://github.com/dilgerma/event-modeling-spec) JSON. The TypeScript emits that same JSON (`npx em json model/`), and the viewer draws either.

Write TypeScript for a system you are about to build. The compiler and the assembler enforce most of this document: a reference is a value, so an unknown event cannot be written; a slice is a chain of calls that starts with its whole pattern, so an illegal or incomplete slice does not compile; a field nothing fills is an assembly error. The same model generates the protobuf for the service it describes. See `ts/README.md`.

Keep `npx em view model/` running while you write the model: after every save its terminal lists everything left to fix, compiler errors included.

Write spec JSON directly when extracting a model from a system that already exists, especially one written in another language. The TypeScript names interfaces as RPC methods it will generate. Inventing those for a service written in Go or Kotlin is the hallucinated-interface antipattern below. An extracted model names the real entry points: `POST /v1/orders`, `OrderService.PlaceOrder`, a Kafka topic. Check it with `npx em view model.json`: it draws the file, lists each place it breaks the schema above the picture, and redraws on save.

### Naming

Name events as facts, usually in the past tense (`OrderPlaced`), and commands as intents (`PlaceOrder`), in the domain's own words. A name the domain already uses, like `MenuReady`, beats a grammatical one. The tool does not check names.

### Spec JSON

The file is `{ "slices": [...] }`, validated by `ts/schema/eventmodeling.schema.json`. Each slice lists its elements by kind, each element its `fields`, and `dependencies` point along the arrows. `ts/README.md` ("The JSON") maps every concept; these are the ones an extraction needs.

| `sliceType` | Elements | Meaning |
|---|---|---|
| `STATE_CHANGE` | screen → command → events | An actor uses an interface to issue a command that records events |
| `STATE_VIEW` | events → read model | A projection: events build a read model |
| `STATE_VIEW` | read model → screen | A view: an actor queries a read model, with no state change |
| `AUTOMATION` | event or to-do read model → processor → command → events | An event, or a list of work, drives a command with no actor |
| `TRANSLATION` | external event → processor → command → events | An event from outside the system boundary becomes one of ours |

- **Interfaces**: one `SCREEN` per slice with an actor, titled with the real entry point, and the actors in the slice's `actors`. The command's `apiEndpoint` says the same; `service` names an RPC service.
- **Streams**: each event's `aggregate`. One lane per aggregate.
- **Chapters**: each slice's `context`.
- **External events**: `"context": "EXTERNAL"`, with `service` naming the system they come from. They have no `aggregate`; we never store them. A command's outbound event that is external is a call to that system.
- **What a handler reads**: a read model with an `OUTBOUND` dependency on the command. One pointing at the processor is the automation's to-do list.
- **Key columns**: `"idAttribute": true`. A list: `"cardinality": "List"`.
- **Mapping**: a field filled by a renamed source gives the source field's name in `mapping`; `count()` is a tally of the event, `= 0` a constant, and `"generated": true` a value the handler assigns, such as an id or a clock.
- **Specifications**: `given`, `when` and `then` steps, each with one example in `examples`. A refusal is a `SPEC_ERROR` step titled with the reason. A view's `when` is a `SPEC_COMMAND` step titled with its screen, holding the query's values; its `then`, `SPEC_READMODEL` rows.
- **Notes**: an element's `description`.

```json
{
  "slices": [
    {
      "id": "place-order",
      "title": "PlaceOrder",
      "context": "OrderLifecycle",
      "sliceType": "STATE_CHANGE",
      "actors": [{ "name": "Customer", "authRequired": true }],
      "screens": [
        { "id": "s1", "title": "POST /v1/orders", "type": "SCREEN", "fields": [],
          "dependencies": [{ "id": "c1", "type": "OUTBOUND", "title": "PlaceOrder", "elementType": "COMMAND" }] }
      ],
      "commands": [
        { "id": "c1", "title": "PlaceOrder", "type": "COMMAND", "apiEndpoint": "POST /v1/orders",
          "fields": [{ "name": "customerId", "type": "String" }, { "name": "items", "type": "String", "cardinality": "List" }],
          "dependencies": [{ "id": "e1", "type": "OUTBOUND", "title": "OrderPlaced", "elementType": "EVENT" }] }
      ],
      "events": [
        { "id": "e1", "title": "OrderPlaced", "type": "EVENT", "aggregate": "Order",
          "fields": [
            { "name": "orderId", "type": "UUID", "generated": true },
            { "name": "customerId", "type": "String" },
            { "name": "items", "type": "String", "cardinality": "List" }
          ],
          "dependencies": [{ "id": "c1", "type": "INBOUND", "title": "PlaceOrder", "elementType": "COMMAND" }] }
      ],
      "readmodels": [], "processors": [], "tables": [],
      "specifications": [
        { "id": "t1", "title": "Customer places an order with two items", "linkedId": "place-order",
          "given": [],
          "when": [{ "id": "t1w", "title": "PlaceOrder", "type": "SPEC_COMMAND",
                     "examples": [{ "customerId": "c-42", "items": ["sku-1", "sku-2"] }] }],
          "then": [{ "id": "t1t", "title": "OrderPlaced", "type": "SPEC_EVENT",
                     "examples": [{ "orderId": "ord-100", "customerId": "c-42", "items": ["sku-1", "sku-2"] }] }] }
      ]
    },
    {
      "id": "inventory-reserver",
      "title": "InventoryReserver",
      "context": "Fulfillment",
      "sliceType": "AUTOMATION",
      "events": [
        { "id": "e2", "title": "OrderPlaced", "type": "EVENT", "aggregate": "Order", "fields": [],
          "dependencies": [{ "id": "p1", "type": "OUTBOUND", "title": "InventoryReserver", "elementType": "AUTOMATION" }] },
        { "id": "e3", "title": "InventoryReserved", "type": "EVENT", "aggregate": "Inventory",
          "fields": [{ "name": "orderId", "type": "UUID" }, { "name": "warehouseId", "type": "String" }],
          "dependencies": [{ "id": "c2", "type": "INBOUND", "title": "ReserveInventory", "elementType": "COMMAND" }] }
      ],
      "processors": [
        { "id": "p1", "title": "InventoryReserver", "type": "AUTOMATION", "fields": [],
          "dependencies": [{ "id": "c2", "type": "OUTBOUND", "title": "ReserveInventory", "elementType": "COMMAND" }] }
      ],
      "commands": [
        { "id": "c2", "title": "ReserveInventory", "type": "COMMAND",
          "fields": [{ "name": "orderId", "type": "UUID" }],
          "dependencies": [{ "id": "e3", "type": "OUTBOUND", "title": "InventoryReserved", "elementType": "EVENT" }] }
      ],
      "readmodels": [
        { "id": "r1", "title": "InventoryLevel", "type": "READMODEL",
          "fields": [{ "name": "sku", "type": "String", "idAttribute": true }, { "name": "warehouseId", "type": "String" }],
          "dependencies": [{ "id": "c2", "type": "OUTBOUND", "title": "ReserveInventory", "elementType": "COMMAND" }] }
      ],
      "screens": [], "tables": [], "specifications": []
    },
    {
      "id": "confirm-payment",
      "title": "ConfirmPayment",
      "context": "Payments",
      "sliceType": "TRANSLATION",
      "events": [
        { "id": "e4", "title": "PaymentReceived", "type": "EVENT", "context": "EXTERNAL", "service": "PaymentProvider",
          "fields": [{ "name": "orderId", "type": "UUID" }, { "name": "amount", "type": "Decimal" }],
          "dependencies": [{ "id": "p2", "type": "OUTBOUND", "title": "PaymentConfirmer", "elementType": "AUTOMATION" }] },
        { "id": "e5", "title": "PaymentConfirmed", "type": "EVENT", "aggregate": "Order",
          "fields": [{ "name": "orderId", "type": "UUID" }, { "name": "paid", "type": "Decimal", "mapping": "amount" }],
          "dependencies": [] }
      ],
      "processors": [{ "id": "p2", "title": "PaymentConfirmer", "type": "AUTOMATION", "fields": [], "dependencies": [] }],
      "commands": [{ "id": "c3", "title": "ConfirmPayment", "type": "COMMAND", "fields": [{ "name": "orderId", "type": "UUID" }, { "name": "amount", "type": "Decimal" }], "dependencies": [] }],
      "readmodels": [], "screens": [], "tables": [], "specifications": []
    }
  ]
}
```

### Automations: two forms

An automation issues a command with no actor. One of two things drives it.

| Form | Spec JSON | TypeScript | Use it when |
|---|---|---|---|
| event-driven | the event points at the processor | `.trigger(Event, Command, Event)` | One event is enough to decide, and the work is quick and safe to repeat |
| todo list | the read model points at the processor | `.todoList(ReadModel, Command, Event)` | The work is slow, can fail, calls another system, or must not run twice |

A todo list is a read model of the work to do. A projection adds a row when the work becomes due and marks it done when the event that finishes it arrives. The processor reads the list on its own schedule and issues the command for each open row. This buys three things:

- **Idempotence** — a row marked done is not processed again, so a retry or a restart is safe.
- **Consistency** — the list is built from events, not from the processor's memory, so it is right after a crash.
- **A state you can reason about** — the list shows what is pending, what is done, and what is stuck.

An event-driven automation has none of this. If the handler fails after the event, the work is lost unless the transport replays it.

### Processor Naming

Automation slices should use descriptive processor names that describe WHAT the automation does, not WHAT triggers it. The trigger event is already shown by its arrow into the processor.

| Instead of | Use |
|-----------|-----|
| `OnOrderPlaced` | `InventoryReserver` |
| `OnPeriodAggregated` | `PeriodExporter` |
| `OnMonthPeriodsDownloaded` | `MonthEncoder` |

The `On*` naming duplicates information that's already in the trigger and tells the reader nothing about what the processor actually does.

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

**NEVER hallucinate interface names.** Use a screen for internal entry points and an external event for inbound events from outside the system boundary.

**Internal interfaces** (a `SCREEN` titled with the entry point) — entry points the system exposes:

| Interface Type | Example | What to Look For |
|---------------|---------|-----------------|
| REST endpoint | `POST /v1/orders` | Controller classes, route definitions |
| gRPC/RPC service | `OrderService.PlaceOrder` | Proto files, service implementations |
| Cron/scheduled job | `CronJob: daily-cleanup` | Scheduler configs, job classes |
| Query endpoint | `GET /v1/orders/{orderId}` | Read-only controllers (view-only slices) |

**External events** (`"context": "EXTERNAL"`, starting a `TRANSLATION`) — events arriving from outside the system boundary:

| Source | Example | What to Look For |
|--------|---------|-----------------|
| Kafka topic | `ExternalPriceChanged(productId, newPrice, oldPrice)` | Kafka consumers, message handlers |
| Webhook | `ExternalPaymentReceived(orderId, amount)` | Webhook controllers, event handlers |
| Message queue | `ExternalAccountCreated(userId, username)` | SQS/RabbitMQ consumers |

**Key distinction:** If an external system pushes data *into* your system via a message/event, use an external event, drawn in that system's lane. If a user or system calls an endpoint you expose, use a screen, drawn in the actor's lane.

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

```ts
.test("Inventory reserved after order placed", {
  given: [OrderPlaced({ orderId: "ord-100", items: ["sku-1"] }), InventoryLevel({ sku: "sku-1", available: 50, reserved: 0 })],
  when:  ReserveInventory({ orderId: "ord-100", items: ["sku-1"] }),
  then:  InventoryReserved({ orderId: "ord-100", items: ["sku-1"], warehouseId: "wh-east" }),
})
```

In spec JSON each of these is a step with its values in `examples`, as in the example above.

**Projection check:** For each read model, verify that the events that build it carry its fields. Additive events (e.g. `ItemAdded`) should carry all the data the view needs. Destructive events (e.g. `ItemRemoved`, `CartCleared`) only need identifying fields — enough to locate and remove rows.

### Phase 6: Look at the Diagram

```bash
npx em view model/                        # the TypeScript model; redraws on save
npx em view model.json                    # a spec JSON model; redraws on save
npx em export model/ -o model.html        # one self-contained page, for sharing
```

Iterate on the model until the diagram clearly tells the story of the system and nothing is left to do above it.

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
3. Look at it again in `em view` to verify the model still tells a coherent story
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
- **Projections are State View slices** — each read model projection gets its own State View slice: the events it subscribes to, and the read model it builds. State Change slices produce events; State View slices project events into read models. A read model a slice's handler reads is an input from another slice, and some State View slice must build it.
- **Event fields must trace to declared sources** — every field in an event must come from: (1) the command, trigger, or external event, (2) a read model the handler reads, or (3) a mapping that says how it is computed. If a command handler reads external state, that state must be a read model it reads.
- **Not every event needs a read model** — terminal events that cross the system boundary outward (e.g. publishing to a Kafka topic for other bounded contexts) have no projection within this system. They are valid dead ends on the timeline.
- **Read models feed interfaces** — they belong near the top, close to the entry points they serve
- **External events represent inbound data from outside the system** — Kafka topics, webhooks, message queues. Use an external event (not a screen) for these, drawn in the system's lane.
- **View-only slices show read model consumption** — a read model and a screen without command or events, drawn with an arrow from the read model up to the interface.
- **Actor swimlanes show real interfaces** — REST endpoints, RPC methods — NEVER made-up screen names
- **Aggregate swimlanes contain commands and events** — grouped by DDD aggregate / event stream
- **Automations are driven by events or TODO lists** — never standalone; the event or the TODO-list read model points at the processor (see "Automations: two forms")
- **Every state change appears on the timeline** — no hidden triggers or side effects
- **Names are CamelCase** — no spaces, e.g. `PlaceOrder` not `Place Order`
- **GWT uses concrete data** — real IDs, real numbers, real outcomes
- **Business language only** — no "DAO persisted" or "saga timed out"
- **Each slice is independently buildable and testable** — events are the only contract between slices. No slice depends on another slice's internals. This independence enables parallel work by multiple developers or AI agents.
- **One command per slice** — if there are 2 commands, break it into 2 slices
- **Every event connects forward** — each event should either feed a read model (projection) or trigger an automation. Events that connect to nothing are dead ends (unless they cross the system boundary outward, e.g. publishing to Kafka for another bounded context).
- **State connects forward too** — a read model that tracks a condition the domain acts on (a threshold, status, or deadline) must have a slice that consumes it. A tally that reaches a process-ending count with nothing acting on it is a gap, exactly like a dead-end event.
- **Finish the model — don't put domain truths to a vote** — when the domain determines something and it traces to a source, capture it. Modeling is the cheap phase to close gaps; a rule you noticed but shelved as "optional" resurfaces during implementation, the most expensive place to find it. Reserve questions for genuine forks, not for work you can already do.
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
- **Using a screen for external events** — if a Kafka consumer or webhook receives data from another system, use an external event, not a screen. The lane and the arrow are different.
- **One command always producing multiple events simultaneously** (suggests the events should be combined into one). Note: alternative outcomes from one command (success/failure) are NOT an antipattern — list each as an event the command can record, and let each GWT `then` show which one happened.
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
- **Inline projections** — putting read models as outputs of state change slices instead of giving each projection its own State View slice. Projections are their own slices: a State View with the events it subscribes to and the read model it builds. State Change slices produce events; State View slices project events into read models.
- **Hidden data sources in events** — an event field that doesn't trace to any input within the slice (command, trigger, external event, or a read model the handler reads). Example: `SyncStarted(bucket, path, remoteCount)` where `remoteCount` comes from querying an external system that isn't declared as a consumed read model. Fix: add the consumed read model to the GWT `given`, or move the computation to a downstream automation that explicitly consumes the read model.
- **"Design" language** — saying "design the read models" or "architect the commands." Event modeling captures what happens; it doesn't prescribe what should happen.
- **Dead-end state** — a read model that tracks a condition the domain reacts to (a count nearing a limit, a status, a deadline) with no slice that consumes it. The same defect as a dead-end event, one level up.
- **Punting a known rule** — flagging a real, traceable domain rule as an optional add-on instead of modeling it. Deferring a rule you already understand just moves the work to a more expensive phase. Model it; report what you modeled.
