import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/srvx-cli.ts",
    outDir: "dist/srvx",
    target: "node24",
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "srvx.js" } },
  },
  ssr: { noExternal: true },
});
