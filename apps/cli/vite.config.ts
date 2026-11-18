import { bundleMigrations } from "@factory/db/bundle-migrations";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/cli.ts",
    outDir: "dist",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "bin/[name].js", banner: "#!/usr/bin/env node" } },
  },
  ssr: { noExternal: true },
  plugins: [bundleMigrations()],
});
