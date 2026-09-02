import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

// `vite viewer` during development proxies the model to a running `em view`,
// so the components hot-reload while the model still live-reloads.
export default defineConfig({
  plugins: [vue()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/model.json": "http://localhost:5311",
      "/events": "http://localhost:5311",
    },
  },
})
