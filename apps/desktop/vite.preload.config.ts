import { defineConfig } from "vite";

// sandbox 창의 preload 는 CommonJS 여야 한다. electron 만 require 한다.
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
