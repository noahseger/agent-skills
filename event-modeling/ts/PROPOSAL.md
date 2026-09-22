# Proposal: modeling as an event storm

Status: for review. The code on #25 follows an earlier draft of this; the document rules.

## Problem

Modeling felt like typing a chain blind. A screen and an automation existed only inside a slice,
so nothing showed until a slice was whole. `m.slice(x, name?)` took three kinds of thing and a
name that one of them needed, so the editor could not say what to type next. The order of work
was the order of the chain, not the order of an event storm.

## Principles

1. **Every primitive is a declaration, and every declaration is drawn the moment it exists.**
   Events, commands, read models, actors, screens and automations each stand on their own in the
   picture until a slice uses them.
2. **A slice starts from the declaration that triggers it.** Type `OrderScreen.` and the editor
   lists what a screen can do, and nothing else. There is no `m.slice`.
3. **A slice at any stage is drawn.** The chapter takes it, the picture shows what it has, and
   the to-do list above the picture names the missing call. Strict assembly refuses it.
4. **A required thing is a required argument.** A view's method is `.view("Method")`, not an
   optional second parameter.

## Declarations

| Call | What it is | Drawn as, before any slice uses it |
|---|---|---|
| `m.event({...})` | something that happened | a card in its stream lane |
| `m.command({...})` | something an actor wants to happen | a card in the middle row |
| `m.readModel({...})` | a table built from events | a card in the middle row |
| `m.actor(options?)` | who acts | an empty lane |
| `m.screen(actor, service?)` | what an actor sees and acts through | an empty wireframe in the actor's lane |
| `m.automation()` | a process of ours | a gear in the Automations lane |
| `m.service("pkg")` | the API a screen calls | not drawn; named on the screen's wireframe |
| `m.external({...})` | a system we do not own | its events, in its own lane |
| `m.stream({...})` | a lane | the lane |

Every declaration is named by its export. Every declaration takes `.note("...")`. Fields are Zod
schemas, and the package exports `z`, so a model has one import.

## Starting a slice

| From | Offers | Pattern | Column heading |
|---|---|---|---|
| `Screen.command(C)` | `.emits(E, fn?)`, `.test()`, `.note()` | state change | the command |
| `Screen.reads(RM)` | `.reads()`, `.command(C)` | state change that reads first | the command |
| `Screen.view("Method")` | `.query({...})`, `.reads(RM)`, `.note()` | view | the method |
| `Automation.on(E)` | `.reads()`, `.command(C)` then `.emits()` | automation | the command |
| `Automation.polls(RM)` | `.reads()`, `.command(C)` then `.emits()` | automation through a list | the command |
| `ReadModel.on(E, fn?)` | `.on()`, `.test()`, `.note()` | state view | the read model |

The heading of a state change is also its service method, so `ListsScreen.command(CreateList)`
is `rpc CreateList`. A view's method is its heading and its RPC. A screen without a service draws
but generates no RPC.

A slice may stop after any call. The chapter takes it and the picture draws it.

## A modeling session

What you type, and what the picture shows after each save.

```ts
export const Drinker = m.actor()
export const BeerOrdered = m.event({ beer: z.string() })
export const BeerPoured  = m.event({ beer: z.string() })
export const Bar = m.stream({ BeerOrdered, BeerPoured })
export default m.model("Bar")
```

An empty Drinker lane, two event cards in the Bar lane, each marked `!`. Above the picture:
`BeerOrdered is in no slice.` and the same for `BeerPoured`. The terminal says the same on every
save.

```ts
export const BarService  = m.service("bar.v1")
export const OrderScreen = m.screen(Drinker, BarService)
export const Pourer      = m.automation()
export const OrderDrink  = m.command({ beer: z.string() })
export const PourBeer    = m.command({ beer: z.string() })
```

An empty wireframe in the Drinker lane, a gear in the Automations lane, two command cards. All
marked. Nothing is wired; every primitive is on the table.

```ts
export const Ordering = m.chapter([OrderScreen.command(OrderDrink)])
```

A column called Order Drink: the wireframe now shows a form with a `beer` field and an Order Drink
button, an arrow into the command. The list says the slice still needs `.emits(event)`.

```ts
export const Ordering = m.chapter([
  OrderScreen.command(OrderDrink).emits(BeerOrdered),
  Pourer.on(BeerOrdered).command(PourBeer).emits(BeerPoured),
])
```

Two columns. The gear sits in the Automations lane under an arrow from Beer Ordered. Nothing is
marked except Beer Poured, which nothing consumes yet. `em json` still refuses the model; `em view`
draws it.

## What checks when

| Check | Where | Example |
|---|---|---|
| A slot takes one kind | compiler | `Screen.command(BeerOrdered)` does not compile |
| Each call offers only what can come next | compiler | no `.emits()` before a command, no `.command()` after `.view()` |
| A view has a method | compiler | `.view()` without an argument does not compile |
| A mapping function fills the target from the source | compiler | `(c) => ({ title: c.nope })` |
| A specification fits its slice | compiler | `when` is the slice's command |
| A slice is whole | assembly | `slice 'OrderDrink' in 'Ordering' is not finished: it still needs .emits(event).` |
| A declaration is in some slice | assembly | `Pourer is in no slice.` |
| Every event is emitted and consumed; every read model projected and read | assembly | `... emits BeerPoured, which nothing consumes` |
| Every field is filled | assembly | `BeerPoured.beer is filled by nothing` |
| One service method per name | assembly | `... both claim BarService/OrderDrink` |

Assembly runs two ways. `view` and `export` run partial: every finding is a warning, listed above
the picture and printed to the terminal, and the picture draws what it can. `json`, `render` and
`proto` run strict: the first finding is an error and nothing is written.

## Decisions

Each with a recommendation. Rule on any you see differently.

1. **The service lives on the screen.** `m.screen(Drinker, BarService)`, not on each slice. A
   screen calls one API; its slices are that API's methods. Recommended: yes.
2. **An automation slice is headed by its command.** The gear already carries the automation's
   name, so the column says what happens, and matches state-change columns. Recommended: yes.
3. **No override of the RPC method name.** The command names the method. If a method must differ,
   rename the command. Recommended: yes; `m.slice("Name")` is gone.
4. **One screen per place the actor stands.** `ListsScreen` for all lists, `ListScreen` for one
   list open. Several slices share a screen; each column draws the screen's wireframe for its own
   command or read model. Recommended: guidance in the README, not a check.
5. **A specification attaches only to a whole slice.** `.test()` is offered after `.emits()` and
   after a projection's first `.on()`, not before. Recommended: yes; an example of half a slice
   has nothing to assert.
6. **A screen that reads and commands is one slice.** `Screen.reads(Menu).command(OrderDrink)`:
   the read is the decision's input, drawn dashed into the command. Recommended: yes, as today.
7. **A terminal event stays a finding.** An event nothing consumes is a warning under `view` and
   an error under `json`. No opt-out: in practice a projection consumes it, and the check found
   real dead ends in both examples. Recommended: no opt-out.
8. **Publishing an event outward is not in this proposal.** A slice that emits to an external
   system is the translation's write half. It needs its own design. Recommended: later.

## Not in this proposal

The hotel example, the release, and the ruled notes still open: `.note()` on `m.rejected`, D5 in
the README.
