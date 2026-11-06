// Checks a model against the vendored event-modeling-spec JSON Schema.
import { readFileSync } from "node:fs"
import { Ajv } from "ajv"

const schema: unknown = JSON.parse(
  readFileSync(new URL("../schema/eventmodeling.schema.json", import.meta.url), "utf8"),
)
const check = new Ajv({ allErrors: true }).compile(schema as object)

/** One line per way `json` breaks the schema, each naming where; none when it validates. */
export function validate(json: unknown): string[] {
  if (check(json)) return []
  return (check.errors ?? []).map((e) => {
    const extra = e.params as { additionalProperty?: string; allowedValues?: unknown[] }
    const detail = extra.additionalProperty
      ? `: ${extra.additionalProperty}`
      : extra.allowedValues
        ? ` ${extra.allowedValues.join(", ")}`
        : ""
    return `${e.instancePath || "/"} ${e.message}${detail}`
  })
}
