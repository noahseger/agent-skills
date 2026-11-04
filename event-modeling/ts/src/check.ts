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

const MISSING = /"add to the command or set in the mapping": ("\w+"(?: \| "\w+")*)/
const STEP = /"(finish this slice with [^"]+)"/

/** `file:line  message`. The package's own type errors become the instruction they carry. */
function describe(d: Diagnostic, text: string, file: string): string {
  const at = (pos: number) => `${file}:${text.slice(0, pos).split("\n").length}  `
  const missing = d.text.match(MISSING)
  if (missing?.[1]) {
    const fields = [...missing[1].matchAll(/"(\w+)"/g)].map((f) => f[1])
    const method = text.slice(0, d.pos).match(/\.(\w+)\(\s*$/)?.[1]
    const call = method ? `.${method}(${text.slice(d.pos, d.end)}): ` : ""
    return `${at(d.pos)}${call}add ${fields.join(", ")} to the command or set it in the mapping`
  }
  const step = d.text.match(STEP)?.[1]
  if (step) {
    // The error spans the whole chain; its last call is where the next step goes.
    const last = text.slice(d.pos, d.end).match(/\.\w+\([^()]*\)$/)?.[0]
    return last ? `${at(d.end - last.length)}${last}: ${step}` : `${at(d.pos)}${step}`
  }
  return `${at(d.pos)}${d.text.split("\n")[0]}`
}
