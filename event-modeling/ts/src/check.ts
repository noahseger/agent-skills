// The compiler's errors for `em view`, one line each, from one tsgo process that rechecks only what changed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { API, type Diagnostic, DiagnosticCategory, type Snapshot } from "typescript/unstable/async"

export interface Checker {
  /** Every compiler error in the model, one line each. */
  check(): Promise<string[]>
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
      const lines: string[] = []
      for (const file of files) {
        const found = [
          ...(await program.getSyntacticDiagnostics(file)),
          ...(await program.getSemanticDiagnostics(file)),
        ]
        const text = readFileSync(file, "utf8")
        for (const d of found)
          if (d.category === DiagnosticCategory.Error)
            lines.push(describe(d, text, relative(root, file)))
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

const MISSING = /"add to the ([\w -]+) or set in the mapping": ("\w+"(?: \| "\w+")*)/
const UNSET = /Property '(\w+)' is missing in type '.*' but required in type 'Pick</
const LAST_OVERLOAD = "The last overload gave the following error."

/** `file:line  message`. The package's own type errors become the instruction they carry. */
function describe(d: Diagnostic, text: string, file: string): string {
  const at = (pos: number) => `${file}:${text.slice(0, pos).split("\n").length}  `
  const lines = messages(d)
  const missing = lines.map((l) => l.match(MISSING)).find((found) => found !== null)
  if (missing?.[1] && missing[2]) {
    const fields = [...missing[2].matchAll(/"(\w+)"/g)].map((f) => f[1])
    return `${at(d.pos)}${text.slice(d.pos, d.end)}: add ${fields.join(", ")} to the ${missing[1]} or set it in the mapping`
  }
  const unset = lines.map((l) => l.match(UNSET)?.[1]).find((f) => f !== undefined)
  if (unset) return `${at(d.pos)}the mapping must set ${unset}`
  // Two events in one call: `.event(A, B)`.
  const first = text.slice(0, d.pos).match(/\.event\(\s*[\w.]+\s*,\s*$/)
  const second = text.slice(d.pos).match(/^([\w.]+)\s*\)/)?.[1]
  if (first && second)
    return `${at(d.pos)}.event() takes one event. To record ${second} too, chain .event(${second}).`
  // A missing argument: the compiler names its parameter, such as 'event', beside the message.
  const unsupplied = d.relatedInformation
    ?.map((r) => r.text)
    .find((t) => t.startsWith("An argument for"))
  if (unsupplied) return `${at(d.pos)}${d.text} ${unsupplied}`
  // A failed overload call heads a chain; the last overload's reason is the line after it.
  const last = lines.indexOf(LAST_OVERLOAD)
  return `${at(d.pos)}${(last >= 0 ? lines[last + 1] : lines[0]) ?? ""}`
}

function messages(d: Diagnostic): string[] {
  return [d.text, ...(d.messageChain ?? []).flatMap(messages)]
}
