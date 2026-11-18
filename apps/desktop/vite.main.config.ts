import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/main/main.ts",
    outDir: "dist/main",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { external: ["electron"], output: { entryFileNames: "main.js", format: "es" } },
  },
  ssr: { noExternal: true, external: ["electron"] },
});
