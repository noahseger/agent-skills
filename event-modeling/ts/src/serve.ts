// `em view`: one process serves the built viewer, the assembled model, and a
// change feed. The browser holds the picture; the feed only says when to ask
// for the model again.
import { existsSync, readFileSync, statSync, watch } from "node:fs"
import { createServer, type ServerResponse } from "node:http"
import { extname, join, normalize } from "node:path"

/** The last assembly: the JSON it printed, or the error that stopped it. */
export type Snapshot = { json: string; error?: undefined } | { error: string; json?: undefined }

export interface ServeOptions {
  /** The built viewer, `viewer/dist`. */
  dist: string
  /** The directory to watch for saves. */
  root: string
  /** Assembles the model again. */
  load: () => Promise<Snapshot>
  /** 0 picks a free port. */
  port: number
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

  let pending = false
  const watcher = watch(options.root, { recursive: true }, (_event, filename) => {
    if (!filename || filename.includes("node_modules") || pending) return
    pending = true
    setTimeout(async () => {
      pending = false
      snapshot = await options.load()
      for (const client of clients) client.write("data: changed\n\n")
    }, 50)
  })

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : options.port
  return {
    url: `http://localhost:${port}`,
    close() {
      watcher.close()
      for (const client of clients) client.end()
      server.close()
    },
  }
}
