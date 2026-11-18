import { bundleMigrations } from "@factory/db/bundle-migrations";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "server/[name].js" } },
  },
  ssr: { noExternal: true },
  plugins: [bundleMigrations()],
});
