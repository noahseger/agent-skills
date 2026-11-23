// The model as event-modeling-spec JSON: each slice type, and each place the
// JSON goes past the spec, which the README's "The JSON" section lists.
import assert from "node:assert/strict"
import { test } from "node:test"
import { t } from "#em"

import { assembleModules } from "../src/assemble.ts"
import type { SpecSlice } from "../src/spec.ts"
import { validate } from "../src/validate.ts"
import { read } from "../viewer/src/read.ts"
import { type C, d, m } from "./loose.ts"

m.actor("Clerk")
m.actor("Boss", { icon: "admin" })
m.service("Shop", "shop.v1")
m.screen("Till").note("By the door.")
m.stream("Orders")
m.stream("Payments")
m.external("Bank")

const Lines = t.array(t.object({ sku: t.string(), gift: t.boolean().optional() }))
m.command("PlaceOrder", {
  orderId: t.string(),
  item: t.string(),
  lines: Lines,
  note: t.string().optional(),
})
m.event("OrderPlaced", {
  orderId: t.string(),
  product: t.string(),
  lines: Lines,
  placedAt: t.string().describe("When the till took it"),
})
  .stream(d.Orders)
  .note("One per order.")
m.event("OrderRefused", { orderId: t.string() }).stream(d.Orders)
m.command("ChargeCard", { orderId: t.string() })
m.event("CardCharged", { orderId: t.string(), amount: t.int() }).external(d.Bank)
m.command("Refund", { orderId: t.string() })
m.command("RecordPayment", { orderId: t.string(), paid: t.int() })
m.event("PaymentRecorded", { orderId: t.string(), paid: t.int() }).stream(d.Payments)
m.view("Unpaid", {
  orderId: t.string().key(),
  product: t.string(),
  lines: Lines,
  payments: t.int(),
  status: t.string(),
})
m.event("Loose", { id: t.uuid() }).stream(d.Orders)

m.chapter("Sales", 1).note("Where money comes in.")
const order = { orderId: "o-1", item: "Tea" }
const slices = [
  m
    .slice()
    .command(d.PlaceOrder)
    .event(d.OrderPlaced, (c: C) => ({ product: c.PlaceOrder.item, placedAt: m.generate() }))
    .event(d.OrderRefused)
    .chapter(d.Sales)
    .actor(d.Clerk, d.Boss)
    .screen(d.Till)
    .service(d.Shop, "Order")
    .note("The till takes the order.")
    .spec("An order is placed", {
      when: d.PlaceOrder(order),
      then: d.OrderPlaced({ orderId: "o-1", product: "Tea", placedAt: "noon" }),
    })
    .spec("A banned item is refused", { when: d.PlaceOrder(order), reject: "banned item" }),
  m
    .slice()
    .view(d.Unpaid)
    .event(d.OrderPlaced, () => ({ payments: t.literal(0), status: t.literal("open") }))
    .event(d.PaymentRecorded, (c: C) => ({
      product: t.literal(""),
      payments: m.generate(c.PaymentRecorded),
      status: t.literal("paid"),
    }))
    .event(d.OrderRefused, () => ({
      product: t.literal(""),
      payments: t.literal(0),
      status: t.literal("refused"),
    }))
    .context({ orderId: t.string() })
    .chapter(d.Sales)
    .actor(d.Clerk)
    .service(d.Shop, "ListUnpaid"),
  m
    .slice("Charger")
    .automation(d.Unpaid)
    .command(d.ChargeCard)
    .event(d.CardCharged)
    .chapter(d.Sales),
  m
    .slice()
    .translation(d.CardCharged)
    .command(d.RecordPayment, (c: C) => ({ paid: c.CardCharged.amount }))
    .query(d.Unpaid, "orderId")
    .event(d.PaymentRecorded),
  m
    .slice("Refunder")
    .automation(d.PaymentRecorded)
    .command(d.Refund)
    .event(d.OrderRefused)
    .chapter(d.Sales),
]
const feed = assembleModules([{ default: m.model("Shop", { description: "A small shop." }) }], {
  partial: true,
})
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
  assert.deepEqual(Object.keys(screen?.fields.properties ?? {}), [
    "orderId",
    "item",
    "lines",
    "note",
  ])
  const [command] = place.commands
  assert.deepEqual([command?.service, command?.apiEndpoint], ["Shop", "Order"])
  assert.equal(command?.fields.required?.includes("note"), false)
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

test("an element's fields are Zod's JSON Schema, less what repeats a format, with its key", () => {
  const lines = {
    type: "array",
    items: {
      type: "object",
      properties: { sku: { type: "string" }, gift: { type: "boolean" } },
      required: ["sku"],
    },
  }
  assert.deepEqual(place?.events[0]?.fields, {
    type: "object",
    properties: {
      orderId: { type: "string" },
      product: { type: "string" },
      lines,
      placedAt: { type: "string", description: "When the till took it" },
    },
    required: ["orderId", "product", "lines", "placedAt"],
  })
  assert.deepEqual(charge?.events[0]?.fields.properties?.amount, { type: "integer" })
  assert.deepEqual(feed.loose?.[0]?.fields.properties?.id, { type: "string", format: "uuid" })
  assert.deepEqual(view?.readmodels[0]?.key, ["orderId"])
  assert.equal(place?.commands[0]?.key, undefined)
})

test("a slice's mappings say where each field a step sets comes from: a field, generated, or = a value", () => {
  assert.deepEqual(place?.mappings, {
    OrderPlaced: { product: "item", placedAt: "generate()" },
  })
  assert.deepEqual(translate?.mappings, { RecordPayment: { paid: "amount" } })
  // A view several events build is mapped once per event.
  assert.deepEqual(view?.mappings, {
    OrderPlaced: { payments: "= 0", status: '= "open"' },
    PaymentRecorded: { product: '= ""', payments: "generate(PaymentRecorded)", status: '= "paid"' },
    OrderRefused: { product: '= ""', payments: "= 0", status: '= "refused"' },
  })
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

test("a state view slice: events in, its view, a screen out", () => {
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
    Object.keys(view?.screens[0]?.fields.properties ?? {}),
    ["orderId"],
    "a view's screen asks for the context",
  )
  const drawn = read(feed).chapters[0]?.slices[1]
  assert.deepEqual(
    [drawn?.actor, drawn?.ui, drawn?.trigger?.length, drawn?.read_models?.length],
    ["clerk", "Shop/ListUnpaid", 3, 1],
    "drawn as one column: the events feed the view, the clerk's screen shows it",
  )
})

test("an automation: a processor between what starts it and its command", () => {
  assert.deepEqual(titles(charge?.processors), ["Charger"])
  const todo = charge?.readmodels[0]
  assert.deepEqual(
    todo?.dependencies.map((d) => [d.type, d.elementType]),
    [["OUTBOUND", "AUTOMATION"]],
    "the polled view feeds the processor",
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
  assert.ok(feed.warnings?.some((w) => w.message.startsWith("Loose: nothing records it.")))
  const board = read(feed)
  assert.equal(board.notes.Sales, "Where money comes in.")
  assert.deepEqual(
    board.chapters.map((c) => c.name),
    ["Sales", ""],
  )
  assert.deepEqual(board.loose?.[0], { kind: "event", element: "Loose(id)", aggregate: "orders" })
})

test("the viewer types each field from its schema: format, enum, list, nested, oneOf, optional, described", () => {
  const board = read(feed)
  assert.deepEqual(board.fields?.OrderPlaced?.slice(2), [
    {
      name: "lines",
      type: "object[]",
      fields: [
        { name: "sku", type: "string" },
        { name: "gift", type: "boolean", optional: true },
      ],
    },
    { name: "placedAt", type: "string", description: "When the till took it" },
  ])
  const at = { type: "string", format: "date-time" }
  const kind = { type: "string", enum: ["a", "b"] }
  const result = {
    oneOf: [
      { type: "object", properties: { win: { type: "string" } }, required: ["win"] },
      { type: "object", properties: { draw: { type: "boolean" } }, required: ["draw"] },
    ],
  }
  const element = {
    id: "e",
    title: "Noted",
    type: "EVENT" as const,
    fields: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" }, at, kind, result },
    },
    key: ["id"],
    dependencies: [],
  }
  const drawn = read({ name: "x", model: { slices: [] }, loose: [element] })
  assert.deepEqual(drawn.fields?.Noted, [
    { name: "id", type: "uuid", optional: true },
    { name: "at", type: "date-time", optional: true },
    { name: "kind", type: "a | b", optional: true },
    {
      name: "result",
      type: "one of",
      optional: true,
      fields: [
        { name: "win", type: "string" },
        { name: "draw", type: "boolean" },
      ],
    },
  ])
  assert.equal(drawn.loose?.[0]?.element, "Noted(*id, at, kind, result)")
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
          commands: [{ id: "c", title: "Order", type: "COMMAND", fields: {}, dependencies: [] }],
          events: [
            {
              id: "e",
              title: "Ordered",
              type: "EVENT",
              aggregate: "Cart",
              fields: { type: "object", properties: { id: { type: "string" } } },
              dependencies: [],
            },
          ],
          readmodels: [],
          screens: [{ id: "u", title: "Cart", type: "SCREEN", fields: {}, dependencies: [] }],
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
