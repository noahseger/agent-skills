// The tarball is what a user installs. It has to carry the built package and
// run the scaffold in a project of their own, on a node that strips no types.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

function npm(args: string[], cwd: string) {
  return spawnSync("npm", ["--no-audit", "--no-fund", "--loglevel=error", ...args], {
    cwd,
    encoding: "utf8",
  })
}

test("the packed tarball installs into a project and em runs there", () => {
  const dir = mkdtempSync(join(tmpdir(), "em-pack-"))
  try {
    // The build already ran; --ignore-scripts skips running it again for prepack.
    const pack = npm(["pack", "--ignore-scripts", "--pack-destination", dir], here(".."))
    assert.equal(pack.status, 0, pack.stderr)
    const tarball = join(dir, pack.stdout.trim().split("\n").at(-1) ?? "")
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "project", private: true, type: "module" }),
    )
    const install = npm(["install", "--prefer-offline", tarball, "zod@^4"], dir)
    assert.equal(install.status, 0, install.stderr)

    const em = join(dir, "node_modules", ".bin", "em")
    const init = spawnSync(em, ["init", "model"], { cwd: dir, encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    const json = spawnSync(em, ["json", "model"], { cwd: dir, encoding: "utf8" })
    assert.equal(json.status, 0, json.stderr)
    assert.deepEqual(JSON.parse(json.stdout).chapters, [])
    assert.equal(json.stderr, "", "no warnings on a plain node")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
