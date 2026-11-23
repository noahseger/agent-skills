// `em types`: what the model declares, written as the types of `d`, beside the model. A declaration
// map takes go-to-definition and rename from `d.Name` to the string that names it.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { z } from "zod"

import { isKey } from "./t.ts"
import { type DeclData, type Exported, REGISTRY, type Registered } from "./types.ts"

export const GENERATED = "em-registry.d.ts"

type Def = {
  type: string
  format?: string
  innerType?: z.ZodType
  element?: z.ZodType
  shape?: Record<string, z.ZodType>
  entries?: Record<string, string>
  values?: unknown[]
  valueType?: z.ZodType
  options?: z.ZodType[]
}

const def = (schema: z.ZodType) => schema._zod.def as unknown as Def
const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name))
const one = (types: string[]) => (types.length > 0 ? types.join(" | ") : "never")

/** The values of a field `t` built, as the compiler writes them. */
function values(schema: z.ZodType): string {
  const d = def(schema)
  switch (d.type) {
    case "optional":
      return `${values(d.innerType as z.ZodType)} | undefined`
    case "string":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "enum":
      return one(Object.values(d.entries ?? {}).map((v) => JSON.stringify(v)))
    case "literal":
      return d.values?.length === 0
        ? "never[]"
        : one((d.values ?? []).map((v) => JSON.stringify(v)))
    case "array": {
      const item = values(d.element as z.ZodType)
      return item.includes(" ") ? `(${item})[]` : `${item}[]`
    }
    case "object":
      return row(d.shape ?? {})
    case "record":
      return `Record<string, ${values(d.valueType as z.ZodType)}>`
    case "union": {
      // A oneOf: each case an object of one field, with none of the others.
      const cases = (d.options ?? []).map((o) => Object.entries(def(o).shape ?? {})[0])
      const names = cases.flatMap((c) => (c ? [c[0]] : []))
      return one(
        cases.flatMap((c) =>
          c
            ? [
                `{ ${[
                  `${key(c[0])}: ${values(c[1])}`,
                  ...names.filter((n) => n !== c[0]).map((n) => `${key(n)}?: never`),
                ].join("; ")} }`,
              ]
            : [],
        ),
      )
    }
    default:
      return "unknown"
  }
}

/** An object's value: a field that may go without a value is an optional property. */
function row(fields: Record<string, z.ZodType>): string {
  const props = Object.entries(fields).map(([name, f]) => {
    const value = values(f)
    return `${key(name)}${value.endsWith("| undefined") ? "?" : ""}: ${value}`
  })
  return props.length > 0 ? `{ ${props.join("; ")} }` : "{}"
}

/** A field as `t` types it: `Field<values, format, key>`. */
function fieldOf(schema: z.ZodType): string {
  let inner = schema
  while (def(inner).type === "optional") inner = def(inner).innerType as z.ZodType
  const { type, format } = def(inner)
  const string = type === "string" && format !== undefined ? JSON.stringify(format) : undefined
  const keyed = isKey(schema)
  const rest = keyed ? `, ${string ?? "string"}, true` : string ? `, ${string}` : ""
  return `Field<${values(schema)}${rest}>`
}

function fieldsOf(decl: DeclData): string {
  const fields = Object.entries(decl.fields).map(([name, f]) => `${key(name)}: ${fieldOf(f)}`)
  return fields.length > 0 ? `{ ${fields.join("; ")} }` : "{}"
}

/** The type `d.Name` has. */
function typeOf(name: string, data: Exported): string {
  const named = JSON.stringify(name)
  switch (data.kind) {
    case "event":
      return `${data.system ? "ExternalEventDecl" : "EventDecl"}<${named}, ${fieldsOf(data)}>`
    case "command":
      return `CommandDecl<${named}, ${fieldsOf(data)}>`
    case "view":
      return `ViewDecl<${named}, ${fieldsOf(data)}, ${data.list === true}>`
    case "actor":
      return data.icon === "system" ? "SystemActor" : "Actor"
    case "model":
      return "never"
    default:
      return `${data.kind[0]?.toUpperCase()}${data.kind.slice(1)}`
  }
}

/** The members of `Registry`, in name order, each with where it is declared. */
function members(): [name: string, type: string, at: Registered][] {
  return [...REGISTRY]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, at]) => [name, typeOf(name, at.data), at])
}

const MEMBER = "    "

/** The generated file: `Registry`'s members, for the package as the model imports it. */
function declarations(specifier: string): string {
  const all = members()
  // Each type's own name, and Field for the fields in it.
  const types = all.flatMap(([, type]) => [
    ...(/^[A-Z]\w*/.exec(type) ?? []),
    ...(type.includes("Field<") ? ["Field"] : []),
  ])
  const names = [...new Set(types)].sort()
  return [
    "// Written by em types from what the model declares, so d is typed. Do not edit.",
    names.length > 0 ? `import type { ${names.join(", ")} } from "${specifier}"` : "export {}",
    "",
    `declare module "${specifier}" {`,
    "  interface Registry {",
    ...all.map(([name, type]) => `${MEMBER}${key(name)}: ${type}`),
    "  }",
    "}",
    `//# sourceMappingURL=${GENERATED}.map`,
    "",
  ].join("\n")
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1
  let out = ""
  do {
    let digit = v & 31
    v >>>= 5
    if (v > 0) digit |= 32
    out += B64[digit]
  } while (v > 0)
  return out
}

/**
 * Where each name in the generated file is declared: the name inside its string, so a rename that
 * goes through the map edits the string.
 */
function sourceMap(dir: string, text: string): string {
  const byKey = new Map(members().map(([name, , at]) => [key(name), { name, where: at.where }]))
  const sources: string[] = []
  const read = new Map<string, string[]>()
  let last = [0, 0, 0]
  const mappings = text.split("\n").map((line) => {
    const member = line.startsWith(MEMBER)
      ? byKey.get(line.slice(MEMBER.length).split(":")[0] ?? "")
      : undefined
    const [, url = "", row = "1", col = "1"] =
      /^(file:.*):(\d+):(\d+)$/.exec(member?.where ?? "") ?? []
    if (!member || !url) return ""
    const file = fileURLToPath(url)
    const source = relative(dir, file)
    if (!sources.includes(source)) sources.push(source)
    const lines = read.get(file) ?? readFileSync(file, "utf8").split("\n")
    read.set(file, lines)
    // The string is on the call's line, or a later one when the call is broken across lines.
    let at = [Number(row) - 1, Number(col) - 1]
    const quoted = JSON.stringify(member.name)
    for (let l = at[0] ?? 0; l < lines.length; l++) {
      const found = (lines[l] ?? "").indexOf(quoted, l === at[0] ? at[1] : 0)
      if (found >= 0) {
        at = [l, found + 1]
        break
      }
    }
    const segment = [sources.indexOf(source), at[0] ?? 0, at[1] ?? 0]
    const out = vlq(MEMBER.length) + segment.map((v, i) => vlq(v - (last[i] ?? 0))).join("")
    last = segment
    return out
  })
  const map = { version: 3, file: GENERATED, sources, names: [], mappings: mappings.join(";") }
  return `${JSON.stringify(map)}\n`
}

/** What the generated file and its map would be, for what `REGISTRY` holds now. */
export function registry(dir: string, specifier: string): { text: string; map: string } {
  const text = declarations(specifier)
  return { text, map: sourceMap(dir, text) }
}

/** The package the model imports `m` from, which the generated file adds `Registry`'s members to. */
export function specifierOf(files: string[]): string {
  for (const f of files) {
    const found = /from "(#em|@noahseger\/event-modeling)"/.exec(readFileSync(f, "utf8"))
    if (found?.[1]) return found[1]
  }
  return "@noahseger/event-modeling"
}

/** Writes both files where either differs, so a watcher sees no save when nothing changed. */
export function writeRegistry(dir: string, made: { text: string; map: string }): boolean {
  const stale = [
    [join(dir, GENERATED), made.text],
    [join(dir, `${GENERATED}.map`), made.map],
  ].filter(([path = "", text]) => !existsSync(path) || readFileSync(path, "utf8") !== text)
  for (const [path = "", text = ""] of stale) writeFileSync(path, text)
  return stale.length > 0
}

/** Whether both files are what `em types` would write. */
export function current(dir: string, made: { text: string; map: string }): boolean {
  const read = (name: string) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : undefined
  return read(GENERATED) === made.text && read(`${GENERATED}.map`) === made.map
}
