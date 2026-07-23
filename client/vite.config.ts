import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5178,
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
