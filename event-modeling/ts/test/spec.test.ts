// The model as event-modeling-spec JSON: each slice type, and each place the
// JSON goes past the spec, which the README's "The JSON" section lists.
import assert from "node:assert/strict"
import { test } from "node:test"
import { z } from "zod"
import { m } from "#em"

import { assembleModules } from "../src/assemble.ts"
import type { SpecSlice } from "../src/spec.ts"
import { validate } from "../src/validate.ts"
import { read } from "../viewer/src/read.ts"

const Clerk = m.actor()
const Boss = m.actor({ icon: "admin" })
const Shop = m.service("shop.v1")
const Till = m.screen().note("By the door.")
const Orders = m.stream()
const Payments = m.stream()
const Bank = m.external()

const PlaceOrder = m.command({ orderId: z.string(), item: z.string(), note: z.string().optional() })
const OrderPlaced = m
  .event({ orderId: z.string(), product: z.string(), placedAt: z.string() })
  .stream(Orders)
  .note("One per order.")
const OrderRefused = m.event({ orderId: z.string() }).stream(Orders)
const ChargeCard = m.command({ orderId: z.string() })
const CardCharged = m.event({ orderId: z.string(), amount: z.number().int() }).external(Bank)
const Refund = m.command({ orderId: z.string() })
const RecordPayment = m.command({ orderId: z.string(), paid: z.number().int() })
const PaymentRecorded = m.event({ orderId: z.string(), paid: z.number().int() }).stream(Payments)
const Unpaid = m
  .readModel({
    orderId: z.string(),
    product: z.string(),
    lines: z.array(z.object({ sku: z.string(), gift: z.boolean().optional() })),
    payments: z.number().int(),
    status: z.string(),
  })
  .key("orderId")
const Loose = m.event({ id: z.string() }).stream(Orders)

const Sales = m.chapter().note("Where money comes in.")
const order = { orderId: "o-1", item: "Tea" }
const slices = [
  m
    .slice()
    .command(
      PlaceOrder,
      OrderPlaced((c, { generate }) => ({ product: c.item, placedAt: generate() })),
    )
    .event(OrderRefused)
    .chapter(Sales)
    .actor(Clerk, Boss)
    .screen(Till)
    .service(Shop, "Order")
    .note("The till takes the order.")
    .test("An order is placed", {
      when: PlaceOrder(order),
      then: OrderPlaced({ orderId: "o-1", product: "Tea", placedAt: "noon" }),
    })
    .test("A banned item is refused", { when: PlaceOrder(order), reject: "banned item" }),
  m
    .slice()
    .view(
      Unpaid,
      OrderPlaced(() => ({ lines: [], payments: 0, status: "open" })),
    )
    .chapter(Sales)
    .event(
      PaymentRecorded((e, { generate }) => ({
        product: "",
        payments: generate(e),
        status: "paid",
      })),
    )
    .event(OrderRefused(() => ({ product: "", lines: [], payments: 0, status: "refused" })))
    .query({ orderId: z.string() })
    .actor(Clerk)
    .service(Shop, "ListUnpaid"),
  m.slice("Charger").automation(Unpaid, ChargeCard, CardCharged).chapter(Sales),
  m
    .slice()
    .translation(
      CardCharged,
      RecordPayment((e) => ({ paid: e.amount })),
      PaymentRecorded,
    )
    .readModel(Unpaid),
  m.slice("Refunder").automation(PaymentRecorded, Refund, OrderRefused).chapter(Sales),
]
const exports = {
  ...{ Clerk, Boss, Shop, Till, Orders, Payments, Bank, Sales, Loose },
  ...{ PlaceOrder, OrderPlaced, OrderRefused, ChargeCard, CardCharged },
  ...{ Refund, RecordPayment, PaymentRecorded, Unpaid },
  default: m.model("Shop", { description: "A small shop." }),
}
const feed = assembleModules([exports], { partial: true })
const json = JSON.parse(JSON.stringify(feed.model)) as { slices: SpecSlice[] }
const [place, view, charge, refund, translate] = json.slices
const titles = (els: { title: string }[] | undefined) => (els ?? []).map((e) => e.title)

test("the model validates against the vendored schema, and a broken one says where", () => {
  assert.deepEqual(validate(json), [])
  assert.deepEqual(validate({ slices: [{ ...place, sliceType: "VIEW", extra: 1 }] }), [
    "/slices/0 must NOT have additional properties: extra",
    "/slices/0/sliceType must be equal to one of the allowed values STATE_CHANGE, STATE_VIEW, AUTOMATION, TRANSLATION",
  ])
})

test("each slice has its spec type, in story order, its chapter as its context", () => {
  assert.equal(json.slices.length, slices.length)
  assert.deepEqual(
    json.slices.map((s) => [s.index, s.title, s.sliceType, s.context]),
    [
      [0, "PlaceOrder", "STATE_CHANGE", "Sales"],
      [1, "Unpaid", "STATE_VIEW", "Sales"],
      [2, "Charger", "AUTOMATION", "Sales"],
      [3, "Refunder", "AUTOMATION", "Sales"],
      [4, "RecordPayment", "TRANSLATION", undefined],
    ],
  )
})

test("a state change: a screen per slice, the endpoint on the command, events in their stream", () => {
  assert.ok(place)
  assert.deepEqual(place.actors, [
    { name: "Clerk", authRequired: false },
    { name: "Boss", authRequired: false, tags: ["admin"] },
  ])
  const [screen] = place.screens
  assert.equal(screen?.title, "Till")
  assert.equal(screen?.description, "By the door.")
  assert.deepEqual(titles(screen?.fields.map((f) => ({ title: f.name }))), [
    "orderId",
    "item",
    "note",
  ])
  const [command] = place.commands
  assert.deepEqual([command?.service, command?.apiEndpoint], ["Shop", "Order"])
  assert.equal(command?.fields.find((f) => f.name === "note")?.optional, true)
  assert.deepEqual(
    command?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "Till"],
      ["OUTBOUND", "OrderPlaced"],
      ["OUTBOUND", "OrderRefused"],
    ],
  )
  assert.deepEqual(
    place.events.map((e) => [e.title, e.aggregate, e.description]),
    [
      ["OrderPlaced", "Orders", "One per order."],
      ["OrderRefused", "Orders", undefined],
    ],
  )
  assert.deepEqual(place.aggregates, ["Orders"])
  assert.deepEqual(place.storylines?.[0]?.title, "The till takes the order.")
})

test("a mapping says where each field comes from: a field, generated, or = a value", () => {
  const placed = place?.events[0]?.fields
  assert.deepEqual(placed, [
    { name: "orderId", type: "String" },
    { name: "product", type: "String", mapping: "item" },
    { name: "placedAt", type: "String", generated: true },
  ])
  assert.deepEqual(translate?.commands[0]?.fields[1], {
    name: "paid",
    type: "Int",
    mapping: "amount",
  })
  // A read model several events build maps a column once per event.
  const columns = Object.fromEntries((view?.readmodels[0]?.fields ?? []).map((f) => [f.name, f]))
  assert.deepEqual(columns.orderId, { name: "orderId", type: "String", idAttribute: true })
  assert.deepEqual(columns.lines, {
    name: "lines",
    type: "Custom",
    subfields: [
      { name: "sku", type: "String" },
      { name: "gift", type: "Boolean", optional: true },
    ],
    cardinality: "List",
    mapping: "OrderPlaced: = []\nOrderRefused: = []",
  })
  assert.equal(
    columns.payments?.mapping,
    "OrderPlaced: = 0\nPaymentRecorded: generate(PaymentRecorded)\nOrderRefused: = 0",
  )
  const board = read(feed)
  const slice = (i: number) => board.chapters.flatMap((c) => c.slices)[i]
  assert.deepEqual(slice(0)?.mapping, {
    OrderPlaced: { product: { from: "item" }, placedAt: { generate: [] } },
  })
  assert.deepEqual(slice(1)?.mapping?.PaymentRecorded, {
    product: { value: "" },
    payments: { generate: ["PaymentRecorded"] },
    status: { value: "paid" },
  })
})

test("a view is one state view: events in, its read model, a screen out", () => {
  assert.deepEqual(titles(view?.events), ["OrderPlaced", "PaymentRecorded", "OrderRefused"])
  assert.equal(view?.aggregates, undefined, "a slice that stores nothing names no aggregate")
  const [table] = view?.readmodels ?? []
  assert.deepEqual([table?.service, table?.apiEndpoint], ["Shop", "ListUnpaid"])
  assert.deepEqual(
    table?.dependencies.map((d) => [d.type, d.title]),
    [
      ["INBOUND", "OrderPlaced"],
      ["INBOUND", "PaymentRecorded"],
      ["INBOUND", "OrderRefused"],
      ["OUTBOUND", "ListUnpaid"],
    ],
  )
  assert.deepEqual(
    view?.screens[0]?.fields.map((f) => f.name),
    ["orderId"],
    "a view's screen asks for the query",
  )
  const drawn = read(feed).chapters[0]?.slices[1]
  assert.deepEqual(
    [drawn?.actor, drawn?.ui, drawn?.trigger?.length, drawn?.read_models?.length],
    ["clerk", "Shop/ListUnpaid", 3, 1],
    "drawn as one column: the events feed the read model, the clerk's screen shows it",
  )
})

test("an automation: a processor between what starts it and its command", () => {
  assert.deepEqual(titles(charge?.processors), ["Charger"])
  const todo = charge?.readmodels[0]
  assert.deepEqual(
    todo?.dependencies.map((d) => [d.type, d.elementType]),
    [["OUTBOUND", "AUTOMATION"]],
    "the polled read model feeds the processor",
  )
  const trigger = refund?.events[0]
  assert.deepEqual(
    [trigger?.title, trigger?.dependencies.map((d) => d.elementType)],
    ["PaymentRecorded", ["AUTOMATION"]],
  )
  assert.deepEqual(
    refund?.commands[0]?.dependencies.map((d) => [d.type, d.elementType]),
    [
      ["INBOUND", "AUTOMATION"],
      ["OUTBOUND", "EVENT"],
    ],
  )
  const board = read(feed).chapters.flatMap((c) => c.slices)
  assert.deepEqual([board[2]?.automation, board[2]?.polls], ["Charger", "Unpaid"])
  assert.deepEqual(
    [board[3]?.automation, board[3]?.trigger],
    ["Refunder", "PaymentRecorded(orderId, paid)"],
  )
})

test("a system we do not own: its events are EXTERNAL, and their service names it", () => {
  const charged = charge?.events[0]
  assert.deepEqual(
    [charged?.context, charged?.service, charged?.aggregate],
    ["EXTERNAL", "Bank", undefined],
  )
  const into = translate?.events[0]
  assert.deepEqual([into?.title, into?.context, into?.service], ["CardCharged", "EXTERNAL", "Bank"])
  assert.deepEqual(titles(translate?.readmodels), ["Unpaid"], "what the handler reads")
  const board = read(feed)
  const slices = board.chapters.flatMap((c) => c.slices)
  assert.deepEqual(slices[2]?.calls, [{ actor: "bank", event: "CardCharged(orderId, amount)" }])
  assert.deepEqual(
    [slices[4]?.actor, slices[4]?.external_event],
    ["bank", "CardCharged(orderId, amount)"],
  )
})

test("a specification has example values, and a rejection is a SPEC_ERROR", () => {
  const [placed, refused] = place?.specifications ?? []
  assert.deepEqual(placed?.when, [
    {
      id: "place-order:spec:0:when:0",
      title: "PlaceOrder",
      type: "SPEC_COMMAND",
      examples: [order],
    },
  ])
  assert.equal(placed?.then[0]?.type, "SPEC_EVENT")
  assert.deepEqual(refused?.then, [
    { id: "place-order:spec:1:then:0", title: "banned item", type: "SPEC_ERROR" },
  ])
  assert.equal(refused?.linkedId, "place-order")
})

test("what the spec has no place for travels beside it, to the viewer", () => {
  assert.deepEqual([feed.name, feed.description], ["Shop", "A small shop."])
  assert.deepEqual(feed.chapters, [{ name: "Sales", note: "Where money comes in." }])
  assert.deepEqual(feed.streams, ["Orders", "Payments"])
  assert.deepEqual(feed.actors, [{ name: "Bank", authRequired: false, tags: ["external"] }])
  assert.deepEqual(titles(feed.loose), ["Loose"])
  assert.ok(feed.warnings?.some((w) => w.message === "Loose isn't in a slice yet."))
  const board = read(feed)
  assert.equal(board.notes.Sales, "Where money comes in.")
  assert.deepEqual(
    board.chapters.map((c) => c.name),
    ["Sales", ""],
  )
  assert.deepEqual(board.loose?.[0], { kind: "event", element: "Loose(id)", aggregate: "orders" })
})

test("a model from elsewhere draws from the spec alone", () => {
  const board = read({
    name: "model",
    model: {
      slices: [
        {
          id: "s",
          title: "Order",
          sliceType: "STATE_CHANGE",
          commands: [{ id: "c", title: "Order", type: "COMMAND", fields: [], dependencies: [] }],
          events: [
            {
              id: "e",
              title: "Ordered",
              type: "EVENT",
              aggregate: "Cart",
              fields: [{ name: "id", type: "UUID" }],
              dependencies: [],
            },
          ],
          readmodels: [],
          screens: [{ id: "u", title: "Cart", type: "SCREEN", fields: [], dependencies: [] }],
          processors: [],
          tables: [],
          specifications: [],
        },
      ],
    },
  })
  const [slice] = board.chapters[0]?.slices ?? []
  assert.deepEqual(board.aggregates, [{ id: "cart", name: "Cart" }])
  assert.deepEqual(
    [slice?.actor, slice?.ui, slice?.screen, slice?.events],
    ["user", "Order", "Cart", ["Ordered(id)"]],
    "a screen nobody is said to see is a User's",
  )
})

test("a file that breaks the schema below its slices is drawn as far as its lists go", () => {
  const warnings = [{ message: "x.json/slices/0/events/0 must be object", element: "" }]
  const board = read({
    name: "x",
    model: JSON.parse(
      '{"slices":[null,{"title":"x","events":[null],"commands":"c","specifications":[null,{"title":"t","given":null}]}]}',
    ),
    chapters: JSON.parse("[null]"),
    loose: JSON.parse("[null]"),
    warnings,
  })
  assert.deepEqual(
    board.chapters.flatMap((c) => c.slices.map((s) => [s.name, s.tests])),
    [["x", [{ name: "t", given: [], when: "", then: [] }]]],
  )
  assert.deepEqual(board.warnings, warnings)
})
