// The assembled model as protobuf, one file per service. A field with no protobuf equivalent, such
// as a list of records, is an error, never a guess.
import { z } from "zod"

import type { Assembled, Fields, ServiceData, SliceData } from "./types.ts"

/** A service's file, or what stops it: its slices' own dead ends, or a field with no protobuf equivalent. */
export type ProtoFile = {
  /** Under the output directory, where the package puts it for buf. */
  path: string
} & ({ source: string } | { problems: string[] })

interface Field {
  name: string
  type: string
  number: number
  label: "" | "repeated " | "optional "
  /** Its `.describe()`, the comment above it. */
  description?: string
  /** The `oneof` it is a case of. */
  oneof?: string
}

interface Message {
  name: string
  fields: Field[]
  /** A `t.object()` field is a message nested in this one. */
  nested: Message[]
}

interface Method {
  name: string
  /** Request, then the views it repeats, then response: print order. */
  messages: Message[]
}

/** As much of `z.toJSONSchema`'s output as the mapping reads. */
interface JsonSchema {
  type?: string
  format?: string
  description?: string
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  /** A `t.record()`'s keys and values. */
  propertyNames?: JsonSchema
  additionalProperties?: JsonSchema | boolean
  /** A `t.oneOf()`'s cases, each an object of one property. */
  oneOf?: JsonSchema[]
}

/** The well-known types `t.datetime()` and `t.duration()` become, by JSON Schema format. */
const WELL_KNOWN: Record<string, [type: string, file: string]> = {
  "date-time": ["google.protobuf.Timestamp", "google/protobuf/timestamp.proto"],
  duration: ["google.protobuf.Duration", "google/protobuf/duration.proto"],
}

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
const unmappable = (where: string, why: string) =>
  new Error(`${where} can't become protobuf: ${why}. The README's Protobuf section says what can.`)

/** The proto type of one schema. An object becomes a message nested in `parent`, a record a map. */
function typeOf(schema: JsonSchema, where: string, field: string, parent: Message): string {
  const values = schema.additionalProperties
  if (schema.type === "object" && typeof values === "object") {
    if (schema.propertyNames?.type !== "string")
      throw unmappable(where, "a record not keyed by string")
    return `map<string, ${typeOf(values, where, field, parent)}>`
  }
  switch (schema.type) {
    case "string":
      return WELL_KNOWN[schema.format ?? ""]?.[0] ?? "string"
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
    if (property.oneOf) {
      for (const [name, value] of property.oneOf.flatMap((c) =>
        Object.entries(c.properties ?? {}),
      )) {
        const type = value.type === "array" ? "" : typeOf(value, `${at}.${name}`, name, msg)
        if (type === "" || type.startsWith("map<"))
          throw unmappable(`${at}.${name}`, "a oneOf case that is a list or a record")
        msg.fields.push({
          name: snake(name),
          type,
          number: msg.fields.length + 1,
          label: "",
          oneof: snake(field),
        })
      }
      continue
    }
    const repeated = property.type === "array"
    const leaf = repeated ? property.items : property
    if (!leaf) throw unmappable(at, "an array with no item type")
    const type = typeOf(leaf, at, field, msg)
    const map = type.startsWith("map<")
    if (repeated && map) throw unmappable(at, "a list of records")
    msg.fields.push({
      name: snake(field),
      type,
      number: msg.fields.length + 1,
      // proto3 has no optional repeated field or map.
      label: repeated ? "repeated " : required.has(field) || map ? "" : "optional ",
      ...(property.description !== undefined && { description: property.description }),
    })
  }
  return msg
}

/** Converts field by field so an error can name the field. */
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

/** The view a state view shows prints before the response that repeats it. */
function methodOf(slice: SliceData): Method {
  const command = slice.command?.decl
  const name = slice.service?.method ?? command?.name ?? ""
  if (command) {
    // Events are internal, so the response has nothing to carry.
    const request = toMessage(`${name}Request`, command.fields, command.name)
    return { name, messages: [request, empty(`${name}Response`)] }
  }
  const shown = slice.view
  // A context that names every key column of a view that is no list picks one row.
  const context = new Set(Object.keys(slice.context ?? {}))
  const one = shown && !shown.list && shown.keys.every((k) => context.has(k))
  const response: Message = {
    name: `${name}Response`,
    fields: shown
      ? [
          {
            name: snake(shown.name ?? ""),
            type: shown.name ?? "",
            number: 1,
            label: one ? "" : "repeated ",
          },
        ]
      : [],
    nested: [],
  }
  return {
    name,
    messages: [
      toMessage(`${name}Request`, slice.context ?? {}),
      ...(shown ? [toMessage(shown.name ?? "", shown.fields)] : []),
      response,
    ],
  }
}

/** The cases of one `oneof` are consecutive fields, written inside it. */
function render(msg: Message, indent = ""): string {
  if (msg.fields.length === 0) return `${indent}message ${msg.name} {}`
  const inner = `${indent}  `
  return [
    `${indent}message ${msg.name} {`,
    ...msg.nested.map((n) => render(n, inner)),
    ...msg.fields.flatMap((f, i) => {
      const at = f.oneof === undefined ? inner : `${inner}  `
      const opens = f.oneof !== undefined && msg.fields[i - 1]?.oneof !== f.oneof
      const closes = f.oneof !== undefined && msg.fields[i + 1]?.oneof !== f.oneof
      return [
        ...(opens ? [`${inner}oneof ${f.oneof} {`] : []),
        ...(f.description?.split("\n").map((line) => `${at}// ${line}`) ?? []),
        `${at}${f.label}${f.type} ${f.name} = ${f.number};`,
        ...(closes ? [`${inner}}`] : []),
      ]
    }),
    `${indent}}`,
  ].join("\n")
}

/** One file per service that has a method, at the path its package implies. */
export function generateProto({
  chapters,
  unchaptered,
  unfinished,
}: Pick<Assembled, "chapters" | "unchaptered" | "unfinished">): ProtoFile[] {
  const byService = new Map<ServiceData, SliceData[]>()
  for (const slice of [...chapters.flatMap((c) => c.slices), ...unchaptered]) {
    if (!slice.service) continue
    const service = slice.service.service
    byService.set(service, [...(byService.get(service) ?? []), slice])
  }
  return [...byService].map(([service, slices]) => {
    const name = service.name ?? ""
    const path = `${service.pkg.replaceAll(".", "/")}/${snake(name)}.proto`
    const problems = slices.flatMap((s) => unfinished.get(s) ?? [])
    if (problems.length > 0) return { path, problems }
    let methods: Method[]
    try {
      methods = slices.map(methodOf)
    } catch (error) {
      return { path, problems: [error instanceof Error ? error.message : String(error)] }
    }
    const rpcs = methods.map(
      (m) => `  rpc ${m.name}(${m.name}Request) returns (${m.name}Response);\n`,
    )
    const messages = methods.flatMap((m) => m.messages).map((m) => `${render(m)}\n`)
    const imports = Object.values(WELL_KNOWN).flatMap(([type, file]) =>
      messages.some((m) => m.includes(`${type} `)) ? [`import "${file}";`] : [],
    )
    return {
      path,
      source: [
        'syntax = "proto3";\n',
        `package ${service.pkg};\n`,
        ...(imports.length > 0 ? [`${imports.join("\n")}\n`] : []),
        `service ${name} {\n${rpcs.join("")}}\n`,
        ...messages,
      ].join("\n"),
    }
  })
}
