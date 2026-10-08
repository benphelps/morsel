import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    port: 5180,
    host: true,
    // Without fsevents, macOS watching polls every file, and the Mac app's build output alone is
    // thousands of them; none of these are ever imported by the editor.
    watch: { ignored: ["**/mac/**", "**/data/**", "**/dist/**"] },
    proxy: {
      "/api": "http://localhost:8000",
      "/device": { target: "http://localhost:8000", ws: true },
    },
  },
});
