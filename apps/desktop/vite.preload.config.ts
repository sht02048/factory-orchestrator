import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/preload/preload.ts",
    outDir: "dist/preload",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: {
      external: ["electron"],
      output: { entryFileNames: "preload.cjs", format: "cjs" },
    },
  },
  ssr: { noExternal: true, external: ["electron"] },
});
