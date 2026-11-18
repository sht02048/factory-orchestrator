import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { thirdPartyManifest } from "../../scripts/third-party";

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
  plugins: [
    thirdPartyManifest(fileURLToPath(new URL("dist/third-party", import.meta.url)), "preload"),
  ],
});
