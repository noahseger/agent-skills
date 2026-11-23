// The compiler's errors for `em view`, one line each, from one tsgo process that rechecks only what changed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { API, type Diagnostic, DiagnosticCategory, type Snapshot } from "typescript/unstable/async"

import { GENERATED } from "./registry.ts"
import { type Message, words } from "./types.ts"

export interface Checker {
  /** Every compiler error in the model, one line each. */
  check(): Promise<Message[]>
}

/**
 * What `em init` writes into tsconfig.json, and what a model without one is checked with. They let
 * node run the model unbuilt; verbatimModuleSyntax stops node loading type-only imports.
 */
export const COMPILER_OPTIONS = {
  module: "nodenext",
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  erasableSyntaxOnly: true,
  verbatimModuleSyntax: true,
}

/** `path` is a model directory or a single module, checked with the tsconfig.json beside it. */
export function checker(path: string): Checker {
  const single = !statSync(path).isDirectory()
  const root = single ? dirname(resolve(path)) : resolve(path)
  const config = join(root, "tsconfig.json")
  const standIn = existsSync(config)
    ? undefined
    : JSON.stringify({
        compilerOptions: COMPILER_OPTIONS,
        ...(single && { files: [resolve(path)] }),
      })
  const api = new API({
    cwd: root,
    ...(standIn && {
      fs: {
        readFile: (f: string) => (f === config ? standIn : undefined),
        fileExists: (f: string) => (f === config ? true : undefined),
      },
    }),
  })
  // Modification times, not the watcher's file name: editors save through temporary files.
  let seen = new Map<string, number>()
  let snapshot: Snapshot | undefined

  return {
    async check() {
      const files = single ? [resolve(path)] : modelFiles(root)
      // em-registry.d.ts types d; it is no model module, but the program reads it.
      const generated = join(root, GENERATED)
      const read = existsSync(generated) ? [...files, generated] : files
      const now = new Map(read.map((f) => [f, statSync(f).mtimeMs]))
      const previous = snapshot
      // A file the server holds open is never reread from disk, so the project is opened instead.
      snapshot = await api.updateSnapshot(
        previous
          ? {
              fileChanges: {
                created: read.filter((f) => !seen.has(f)),
                deleted: [...seen.keys()].filter((f) => !now.has(f)),
                changed: read.filter((f) => seen.has(f) && seen.get(f) !== now.get(f)),
              },
            }
          : { openProjects: [config] },
      )
      await previous?.dispose()
      seen = now
      const program = snapshot.getProject(config)?.program
      if (!program) return []
      const lines: Message[] = []
      for (const file of files) {
        const found = [
          ...(await program.getSyntacticDiagnostics(file)),
          ...(await program.getSemanticDiagnostics(file)),
        ]
        const text = readFileSync(file, "utf8")
        const errors = found.filter((d) => d.category === DiagnosticCategory.Error)
        const early = [...new Set(errors.flatMap(usedEarly))]
        const many = early.length > 1
        if (early.length > 0)
          lines.push({
            kind: "error",
            message: `${early.join(", ")}: used above ${many ? "their declarations" : "its declaration"} in ${relative(root, file)}. Move ${many ? "them" : "it"} up.`,
            ui: `${early.join(", ")}: used before ${many ? "they're" : "it's"} declared`,
            element: "",
          })
        for (const d of errors)
          if (usedEarly(d).length === 0) lines.push(...describe(d, text, relative(root, file)))
      }
      return lines
    },
  }
}

/** The same modules `load` imports from a model directory. */
function modelFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory())
        return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : modelFiles(path)
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : []
    })
}

/** "Block-scoped variable 'X' used before its declaration." and "Variable 'X' is used before being assigned." */
const USED_EARLY = [2448, 2454]

/** The name a diagnostic says is used above its declaration, if it says one. */
function usedEarly(d: Diagnostic): string[] {
  const name = USED_EARLY.includes(d.code) ? d.text.match(/'(\w+)'/)?.[1] : undefined
  return name === undefined ? [] : [name]
}

/** A string literal type in a diagnostic, its quotes escaped. */
const QUOTED = /"((?:[^"\\]|\\.)*)"/g
/** A mapping's result that is not a field its target takes; the target may be `O[K] & Fit<…>`. */
const UNFIT = /^Type '.*' is not assignable to type '(?:[^']* & )?(?:Fit<|\{ readonly __value)/
const UNSET = /Property '(\w+)' is missing in type '.*' but required in type 'Pick</
const LAST_OVERLOAD = "The last overload gave the following error."

/** How the viewer says an instruction: about `element`, or, with none, as a sentence of its own. */
type Worded = Pick<Message, "kind" | "element" | "fields" | "ui">
const about = (
  kind: Message["kind"],
  element: string,
  problem: string,
  field?: string,
): Worded => ({
  kind,
  element,
  ui: element === "" ? problem : `${words(element)}: ${problem}`,
  ...(field !== undefined && { fields: [field] }),
})

/** What a field's instruction says; the types give one per field. */
const FIELD: [RegExp, (field: string) => string][] = [
  [/^(\w+)\.(\w+): no source\. /, (f) => `${f} has no source`],
  [/^(\w+)\.(\w+): doesn't fit/, (f) => `${f} doesn't fit`],
  [/^(\w+)\.(\w+): comes from /, (f) => `${f} has two sources`],
]

/** Every other instruction the package's types put where a step goes wrong, as src/index.ts words it. */
const INSTRUCTIONS: [RegExp, (m: RegExpMatchArray) => Worded][] = [
  [/^(\w+): is an? \w+; pass (an? \w+)\.$/, (m) => about("error", m[1] ?? "", `not ${m[2]}`)],
  [/^not a declaration\. /, () => about("error", "", "A step names no element")],
  [/^(\w+): only a view has key columns\. /, (m) => about("error", "", `${m[1]} can't be a key`)],
  [/^(\w+): many rows /, (m) => about("error", m[1] ?? "", "query finds many rows")],
  [/^(\w+): no column (\w+)\.$/, (m) => about("error", m[1] ?? "", `no column ${m[2]}`)],
  [/^(\w+): say which rows: /, (m) => about("error", m[1] ?? "", "query doesn't say which rows")],
  [
    /^(\w+): not an outside event\. /,
    (m) => about("error", m[1] ?? "", "not from an External System"),
  ],
  [/^(\w+): comes from outside\. /, (m) => about("error", m[1] ?? "", "needs a translation")],
  [/^(\w+): not stored\. /, (m) => about("error", m[1] ?? "", "not stored")],
  [/^method has no name\. /, () => about("error", "", "A state view's method has no name")],
  [/^no one sees an automation\. /, () => about("error", "", "An automation has no screen")],
  [/^an automation has no method\. /, () => about("error", "", "An automation has no method")],
  [/^empty\. Start it with /, () => about("warning", "", "A slice is empty")],
  [/^no command\. Add \.command\(\) /, () => about("warning", "", "A slice has no command")],
  [/^no event\. Add \.event\(\) /, () => about("warning", "", "A slice has no event")],
]

/**
 * `file:line  instruction`. The package's own type errors become the instruction they carry, one
 * line per field when they are about fields.
 */
function describe(d: Diagnostic, text: string, file: string): Message[] {
  const at = `${file}:${text.slice(0, d.pos).split("\n").length}  `
  const lines = messages(d)
  const quoted = (said: string) =>
    [...said.matchAll(QUOTED)].map((q) => (q[1] ?? "").replaceAll('\\"', '"'))
  const fields = quoted(d.text).flatMap((said): Message[] => {
    for (const [pattern, problem] of FIELD) {
      const [, element = "", field = ""] = said.match(pattern) ?? []
      if (element !== "")
        return [{ message: `${at}${said}`, ...about("error", element, problem(field), field) }]
    }
    return []
  })
  if (fields.length > 0) return fields
  // The mapping's key whose value does not fit.
  const target = text.slice(d.pos, d.end)
  if (UNFIT.test(d.text))
    return [
      {
        message: `${at}${target}: doesn't fit. Set it to a field of its type, a t.literal() or m.generate().`,
        ...about("error", "", `${target} doesn't fit`),
      },
    ]
  const unset = lines.map((l) => l.match(UNSET)?.[1]).find((f) => f !== undefined)
  if (unset)
    return [
      {
        message: `${at}${unset}: doesn't fit, so the mapping must set it.`,
        ...about("error", "", `${unset} doesn't fit`),
      },
    ]
  for (const said of lines.flatMap(quoted))
    for (const [pattern, worded] of INSTRUCTIONS) {
      const m = said.match(pattern)
      if (m) return [{ message: `${at}${said}`, ...worded(m) }]
    }
  // A failed overload call heads a chain; the last overload's reason is the line after it.
  const last = lines.indexOf(LAST_OVERLOAD)
  return [
    {
      kind: "error",
      message: `${at}${(last >= 0 ? lines[last + 1] : lines[0]) ?? ""}`,
      element: "",
    },
  ]
}

function messages(d: Diagnostic): string[] {
  return [d.text, ...(d.messageChain ?? []).flatMap(messages)]
}
