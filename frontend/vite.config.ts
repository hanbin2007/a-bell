import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 构建产物直接落到 abell/web，由 FastAPI 以 /static 挂载；GET / 返回其中的 index.html
export default defineConfig({
  base: "/static/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: path.resolve(__dirname, "../abell/web"),
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://localhost:8333" },
  },
})
