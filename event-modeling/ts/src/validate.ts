// Checks a model against schema/eventmodeling.schema.json.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Ajv } from "ajv"

// The schema is at the package root, whether this runs from `src/` or from `dist/src/`.
let root = dirname(fileURLToPath(import.meta.url))
while (!existsSync(join(root, "package.json"))) root = dirname(root)
const schema: unknown = JSON.parse(
  readFileSync(join(root, "schema", "eventmodeling.schema.json"), "utf8"),
)
const check = new Ajv({ allErrors: true }).compile(schema as object)

/** Each way `json` breaks the schema: where, and what is wrong there; none when it validates. */
export function validate(json: unknown): { at: string; problem: string }[] {
  if (check(json)) return []
  return (check.errors ?? []).map((e) => {
    const extra = e.params as { additionalProperty?: string; allowedValues?: unknown[] }
    const detail = extra.additionalProperty
      ? `: ${extra.additionalProperty}`
      : extra.allowedValues
        ? ` ${extra.allowedValues.join(", ")}`
        : ""
    return { at: e.instancePath || "/", problem: `${e.message}${detail}` }
  })
}
