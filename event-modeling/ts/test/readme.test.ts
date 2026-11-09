// The README's quickstart, run as a reader runs it: its blocks in order, then `em json` and `em proto`.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const NODE_FLAGS = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]

function run(...args: string[]) {
  return spawnSync(process.execPath, args, { encoding: "utf8" })
}

const readme = readFileSync(here("../README.md"), "utf8")
const quickstart = readme.slice(
  readme.indexOf("\n## Quickstart\n"),
  readme.indexOf("\n## Writing a model\n"),
)
const blocks = (lang: string) =>
  [...quickstart.matchAll(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``, "g"))].map((b) => b[1])

test("the quickstart finishes, and prints the proto it generates", () => {
  // Inside the package, so the model's import of the package name resolves as a user's would.
  const dir = mkdtempSync(here("../tmp-readme-"))
  const out = mkdtempSync(join(tmpdir(), "em-readme-"))
  try {
    rmSync(dir, { recursive: true })
    const em = (...args: string[]) => run(...NODE_FLAGS, here("../bin/em.ts"), ...args)
    const init = em("init", dir)
    assert.equal(init.status, 0, init.stderr)
    mkdirSync(join(dir, "node_modules", "@noahseger"), { recursive: true })
    symlinkSync(here(".."), join(dir, "node_modules", "@noahseger", "event-modeling"))
    writeFileSync(join(dir, "index.ts"), blocks("ts").join("\n"))

    const tsc = run(here("../node_modules/typescript/bin/tsc"), "-p", dir)
    assert.equal(tsc.status, 0, tsc.stdout)
    const json = em("json", dir)
    assert.equal(json.status, 0, json.stderr)
    const proto = em("proto", dir, "-o", out)
    assert.equal(proto.status, 0, proto.stderr)

    const [printed] = blocks("proto")
    assert.equal(readFileSync(join(out, "todo/v1/todo_service.proto"), "utf8"), printed)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})
