import { defineConfig } from "tsdown";

/**
 * Library build: four ESM entries with declarations — the engine (`index`, no DOM, no deps), the
 * two adapters (`howler`, `web-audio`) and the React hook (`react`). `exports` is generated into
 * package.json on every build. publint and arethetypeswrong run after each build.
 *
 * Not in tsconfig `include`: tsdown types reach into `@arethetypeswrong/core`, which ships `.ts`
 * sources that fail this repo's strictness.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    howler: "src/howler/index.ts",
    "web-audio": "src/web-audio/index.ts",
    react: "src/react/index.tsx",
  },
  format: "esm",
  platform: "browser",
  target: "baseline-widely-available",
  dts: true,
  sourcemap: true,
  clean: true,
  exports: true,
  publint: true,
  attw: { profile: "esm-only" },
});
