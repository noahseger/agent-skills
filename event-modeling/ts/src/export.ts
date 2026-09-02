// `em export`: the built viewer and one model in a single HTML file, for
// sharing. The scripts and styles Vite linked are inlined, and the model goes
// in a script tag the app reads instead of fetching.
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** `</script>` inside inlined text would end the tag early. */
const safe = (text: string) => text.replace(/<\//g, "<\\/")

export function exportHtml(dist: string, modelJson: string): string {
  let html = readFileSync(join(dist, "index.html"), "utf8")
  html = html.replace(/<script type="module"[^>]*src="\/?([^"]+)"><\/script>/g, (_m, src) => {
    return `<script type="module">${safe(readFileSync(join(dist, src), "utf8"))}</script>`
  })
  html = html.replace(/<link rel="stylesheet"[^>]*href="\/?([^"]+)">/g, (_m, href) => {
    return `<style>${readFileSync(join(dist, href), "utf8")}</style>`
  })
  const model = JSON.parse(modelJson) as { name?: string }
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(model.name ?? "Event model")}</title>`,
  )
  return html.replace(
    "<body>",
    `<body>\n    <script type="application/json" id="model">${safe(modelJson)}</script>`,
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
