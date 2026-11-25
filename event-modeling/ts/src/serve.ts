// `em view`: serves the viewer and the model, and tells the browser when to reload.
import { existsSync, type FSWatcher, readdirSync, readFileSync, statSync, watch } from "node:fs"
import { createServer, type ServerResponse } from "node:http"
import { basename, extname, join, normalize, relative, sep } from "node:path"

import { GENERATED } from "./registry.ts"

/** The last assembly: the JSON it printed, or the error that stopped it. */
export type Snapshot = { json: string; error?: undefined } | { error: string; json?: undefined }

export interface ServeOptions {
  /** The built viewer, `viewer/dist`. */
  dist: string
  /** The directory to watch for saves. */
  root: string
  /** Assemble the model; `cause` is the save or deletion that asked for it, as `Saved index.ts`. */
  load: (cause?: string) => Promise<Snapshot>
  /** 0 picks a free port; without one, 5311, or a free port when 5311 is taken. */
  port: number | undefined
}

export interface Server {
  url: string
  close(): void
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
}

export async function serve(options: ServeOptions): Promise<Server> {
  let snapshot = await options.load()
  const clients = new Set<ServerResponse>()

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost")
    if (pathname === "/model.json") {
      const status = snapshot.json === undefined ? 422 : 200
      const type = snapshot.json === undefined ? "text/plain; charset=utf-8" : TYPES[".json"]
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" })
      res.end(snapshot.json ?? snapshot.error)
      return
    }
    if (pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      })
      res.write(": connected\n\n")
      clients.add(res)
      req.on("close", () => clients.delete(res))
      return
    }
    const relative = pathname === "/" ? "index.html" : normalize(pathname).slice(1)
    const file = join(options.dist, relative)
    if (!file.startsWith(options.dist) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": relative === "index.html" ? "no-store" : "public, max-age=31536000",
    })
    res.end(readFileSync(file))
  })

  // The files changed since the last load, in the order the watcher saw them.
  let changed: string[] = []
  // One load at a time, so a slow load never overwrites a later save's.
  let loading = Promise.resolve()
  // A watcher per directory: node 22's recursive watch on Linux stops seeing a file once a save
  // renames a temporary copy over it.
  const watchers = new Map<string, FSWatcher>()
  const watchAll = () => {
    const dirs = directories(options.root)
    for (const [dir, watcher] of watchers) {
      if (dirs.includes(dir)) continue
      watcher.close()
      watchers.delete(dir)
    }
    for (const dir of dirs)
      if (!watchers.has(dir))
        watchers.set(
          dir,
          watch(dir, (_event, name) => name && saw(relative(options.root, join(dir, name)))).on(
            "error",
            () => {},
          ),
        )
  }
  const saw = (file: string) => {
    // A hidden file is an editor's temporary copy; the rename onto the model file follows it.
    if (basename(file).startsWith(".")) return
    // A load writes what is generated, and type-checks again itself when it changed.
    if (file.split(sep)[0] === GENERATED) return
    changed.push(file)
    if (changed.length > 1) return
    setTimeout(() => {
      // An editor that saves a temporary copy and renames it over the file leaves only the file.
      const saved = changed.find((f) => existsSync(join(options.root, f)))
      const cause = saved ? `Saved ${saved}` : `Deleted ${changed[0]}`
      changed = []
      loading = loading.then(async () => {
        snapshot = await options.load(cause)
        for (const client of clients) client.write("data: changed\n\n")
      })
      watchAll()
    }, 50)
  }
  watchAll()

  const listen = (port: number) =>
    new Promise<void>((resolve, reject) =>
      server.once("error", reject).listen(port, "127.0.0.1", resolve),
    )
  await listen(options.port ?? 5311).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error
    if (options.port !== undefined) throw new Error(`Port ${options.port} is in use.`)
    return listen(0)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return {
    url: `http://localhost:${port}`,
    close() {
      for (const watcher of watchers.values()) watcher.close()
      for (const client of clients) client.end()
      server.close()
    },
  }
}

/** `root` and the directories under it that hold the model: not node_modules, not hidden. */
function directories(root: string): string[] {
  return [
    root,
    ...readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")
        ? directories(join(root, entry.name))
        : [],
    ),
  ]
}
