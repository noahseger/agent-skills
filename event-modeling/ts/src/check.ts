// The compiler's errors for `em view`, one line each, from one tsgo process that rechecks only what changed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { API, type Diagnostic, DiagnosticCategory, type Snapshot } from "typescript/unstable/async"

import { NO_COMMAND, NO_EVENT } from "./assemble.ts"
import type { Warning } from "./types.ts"

export interface Checker {
  /** Every compiler error in the model, one line each. */
  check(): Promise<Warning[]>
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
      const now = new Map(files.map((f) => [f, statSync(f).mtimeMs]))
      const previous = snapshot
      // A file the server holds open is never reread from disk, so the project is opened instead.
      snapshot = await api.updateSnapshot(
        previous
          ? {
              fileChanges: {
                created: files.filter((f) => !seen.has(f)),
                deleted: [...seen.keys()].filter((f) => !now.has(f)),
                changed: files.filter((f) => seen.has(f) && seen.get(f) !== now.get(f)),
              },
            }
          : { openProjects: [config] },
      )
      await previous?.dispose()
      seen = now
      const program = snapshot.getProject(config)?.program
      if (!program) return []
      const lines: Warning[] = []
      for (const file of files) {
        const found = [
          ...(await program.getSyntacticDiagnostics(file)),
          ...(await program.getSemanticDiagnostics(file)),
        ]
        const text = readFileSync(file, "utf8")
        const errors = found.filter((d) => d.category === DiagnosticCategory.Error)
        const early = [...new Set(errors.flatMap(usedEarly))]
        if (early.length > 0)
          lines.push({
            message: `${relative(root, file)}: declare ${early.join(", ")} above where ${early.length > 1 ? "they are" : "it is"} used.`,
            element: "",
          })
        for (const d of errors)
          if (usedEarly(d).length === 0) lines.push(describe(d, text, relative(root, file)))
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

const MISSING = /"add (\w+) to the ([\w -]+) or set it in the mapping"/g
const OUTSIDE = /"(a mapper only works inside a slice[^"]*)"/
const UNSET = /Property '(\w+)' is missing in type '.*' but required in type 'Pick</
/** A slice's first call and the parameter it was not given, as `em json` words what that leaves out. */
const UNSUPPLIED: Record<string, string> = {
  "command event": NO_EVENT,
  "view event": NO_EVENT,
  "automation event": NO_EVENT,
  "automation command": NO_COMMAND,
  "translation event": NO_EVENT,
  "translation command": NO_COMMAND,
}
const LAST_OVERLOAD = "The last overload gave the following error."

/** `file:line  message`. The package's own type errors become the instruction they carry. */
function describe(d: Diagnostic, text: string, file: string): Warning {
  const said = (message: string): Warning => ({ message, element: "" })
  const at = (pos: number) => `${file}:${text.slice(0, pos).split("\n").length}  `
  const lines = messages(d)
  // One sentence per field the source lacks.
  const missing = [...d.text.matchAll(MISSING)]
  if (missing[0]) {
    const fields = missing.flatMap((f) => (f[1] ? [f[1]] : []))
    const target = text.slice(d.pos, d.end)
    return {
      message: `${at(d.pos)}${target}: add ${fields.join(", ")} to the ${missing[0][2]} or set it in the mapping`,
      element: target.match(/\w+$/)?.[0] ?? "",
      fields,
    }
  }
  const outside = lines.map((l) => l.match(OUTSIDE)?.[1]).find((m) => m !== undefined)
  if (outside) return said(`${at(d.pos)}${outside}`)
  const unset = lines.map((l) => l.match(UNSET)?.[1]).find((f) => f !== undefined)
  if (unset) return said(`${at(d.pos)}the mapping must set ${unset}`)
  // Two events in one call: `.event(A, B)`.
  const first = text.slice(0, d.pos).match(/\.event\(\s*[\w.]+\s*,\s*$/)
  const second = text.slice(d.pos).match(/^([\w.]+)\s*\)/)?.[1]
  if (first && second)
    return said(
      `${at(d.pos)}.event() takes one event. To record ${second} too, chain .event(${second}).`,
    )
  // A missing argument: the compiler names its parameter, such as 'event', beside the message.
  const unsupplied = d.relatedInformation
    ?.map((r) => r.text)
    .find((t) => t.startsWith("An argument for"))
  // Named after its command or read model, as `em json` names the slice.
  const core = UNSUPPLIED[`${text.slice(d.pos, d.end)} ${unsupplied?.match(/'(\w+)'/)?.[1]}`]
  const args = text.slice(d.end).match(/^\s*\(\s*([\w.]+)\s*(?:,\s*([\w.]+))?/)
  if (core && args) return said(`${at(d.pos)}${args[2] ?? args[1]}: ${core}`)
  if (unsupplied) return said(`${at(d.pos)}${d.text} ${unsupplied}`)
  // A failed overload call heads a chain; the last overload's reason is the line after it.
  const last = lines.indexOf(LAST_OVERLOAD)
  return said(`${at(d.pos)}${(last >= 0 ? lines[last + 1] : lines[0]) ?? ""}`)
}

function messages(d: Diagnostic): string[] {
  return [d.text, ...(d.messageChain ?? []).flatMap(messages)]
}
