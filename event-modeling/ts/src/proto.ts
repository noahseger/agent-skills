// The assembled model -> protobuf. The model already knows each service, its
// methods, and the fields every request and response carries, so the IDL is
// generated rather than written a second time. `buf generate` and
// `buf breaking` own it from there.
//
// Zod is read through `z.toJSONSchema`, which is public API, not Zod's
// internals. A type outside the README's table is an error naming the
// declaration and the field, never a guess.
import { z } from "zod"

import type { DeclData, Fields, ModelData, ServiceData, SliceData } from "./types.ts"

export interface ProtoFile {
  /** Under the output directory, where the package puts it for buf. */
  path: string
  source: string
}

interface Field {
  name: string
  type: string
  number: number
  label: "" | "repeated " | "optional "
}

interface Message {
  name: string
  fields: Field[]
  /** A `z.object()` field is a message nested in this one. */
  nested: Message[]
}

interface Method {
  name: string
  /** Request, then the read models it repeats, then response: print order. */
  messages: Message[]
}

/** As much of `z.toJSONSchema`'s output as the mapping reads. */
interface JsonSchema {
  type?: string
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
}

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
const unmappable = (where: string, why: string) => new Error(`${where} has no protobuf type: ${why}`)

/** The proto type of one schema. An object becomes a message nested in `parent`. */
function typeOf(schema: JsonSchema, where: string, field: string, parent: Message): string {
  switch (schema.type) {
    case "string":
      return "string"
    case "integer":
      return "int32"
    case "number":
      return "double"
    case "boolean":
      return "bool"
    case "object": {
      const nested = message(pascal(field), schema, where)
      parent.nested.push(nested)
      return nested.name
    }
    default:
      throw unmappable(where, `JSON schema type ${JSON.stringify(schema.type ?? "unknown")}`)
  }
}

/** Fields are numbered in property order, which is declaration order. */
function message(name: string, schema: JsonSchema, where: string): Message {
  const required = new Set(schema.required ?? [])
  const msg: Message = { name, fields: [], nested: [] }
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    const at = `${where}.${field}`
    const repeated = property.type === "array"
    const leaf = repeated ? property.items : property
    if (!leaf) throw unmappable(at, "an array with no item type")
    msg.fields.push({
      name: snake(field),
      type: typeOf(leaf, at, field, msg),
      number: msg.fields.length + 1,
      // proto3 has no optional repeated field.
      label: repeated ? "repeated " : required.has(field) ? "" : "optional ",
    })
  }
  return msg
}

/**
 * Fields convert one at a time. Converting the object at once is fewer calls,
 * but Zod's own failure names neither the field nor the declaration.
 */
function toMessage(name: string, fields: Fields, where = name): Message {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [field, schema] of Object.entries(fields)) {
    try {
      properties[field] = z.toJSONSchema(schema, { io: "input" }) as JsonSchema
    } catch (cause) {
      throw unmappable(`${where}.${field}`, cause instanceof Error ? cause.message : String(cause))
    }
    if (!schema.safeParse(undefined).success) required.push(field)
  }
  return message(name, { type: "object", properties, required }, where)
}

const empty = (name: string): Message => ({ name, fields: [], nested: [] })

/** A read model prints once per file, before the first response that repeats it. */
function methodOf(slice: SliceData, printed: Set<DeclData>): Method {
  const name = slice.service?.method ?? slice.command?.name ?? ""
  if (slice.command) {
    // Events are internal, so the response has nothing to carry.
    const request = toMessage(`${name}Request`, slice.command.fields, slice.command.name)
    return { name, messages: [request, empty(`${name}Response`)] }
  }
  const unprinted = slice.reads.filter((r) => !printed.has(r))
  for (const r of unprinted) printed.add(r)
  // A query that names every key column of a read model picks one row.
  const query = new Set(Object.keys(slice.query ?? {}))
  const one = (r: DeclData) => r.keys.length > 0 && r.keys.every((k) => query.has(k))
  const response: Message = {
    name: `${name}Response`,
    fields: slice.reads.map((r, i) => ({
      name: snake(r.name ?? ""),
      type: r.name ?? "",
      number: i + 1,
      label: one(r) ? "" : "repeated ",
    })),
    nested: [],
  }
  return {
    name,
    messages: [
      toMessage(`${name}Request`, slice.query ?? {}),
      ...unprinted.map((r) => toMessage(r.name ?? "", r.fields)),
      response,
    ],
  }
}

function render(msg: Message, indent = ""): string {
  if (msg.fields.length === 0) return `${indent}message ${msg.name} {}`
  return [
    `${indent}message ${msg.name} {`,
    ...msg.nested.map((n) => render(n, `${indent}  `)),
    ...msg.fields.map((f) => `${indent}  ${f.label}${f.type} ${f.name} = ${f.number};`),
    `${indent}}`,
  ].join("\n")
}

/** One file per service that has a method, at the path its package implies. */
export function generateProto(model: ModelData): ProtoFile[] {
  const byService = new Map<ServiceData, SliceData[]>()
  for (const chapter of model.chapters) {
    for (const slice of chapter.slices) {
      if (!slice.service) continue
      const service = slice.service.service
      byService.set(service, [...(byService.get(service) ?? []), slice])
    }
  }
  return [...byService].map(([service, slices]) => {
    const printed = new Set<DeclData>()
    const methods = slices.map((s) => methodOf(s, printed))
    const rpcs = methods.map((m) => `  rpc ${m.name}(${m.name}Request) returns (${m.name}Response);\n`)
    const name = service.name ?? ""
    return {
      path: `${service.pkg.replaceAll(".", "/")}/${snake(name)}.proto`,
      source: [
        'syntax = "proto3";\n',
        `package ${service.pkg};\n`,
        `service ${name} {\n${rpcs.join("")}}\n`,
        ...methods.flatMap((m) => m.messages).map((m) => `${render(m)}\n`),
      ].join("\n"),
    }
  })
}
