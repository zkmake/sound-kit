import { defineConfig } from "tsdown";

/**
 * Library build: ESM entries with declarations — the mixer (`index`, no DOM at import, no deps),
 * music playlists (`music`), placed sounds (`three`, structural types, no three import), React
 * hooks (`react`) and the sound-scape bridge (`scape`). `exports` is generated into package.json
 * on every build. publint and arethetypeswrong run after each build.
 *
 * Not in tsconfig `include`: tsdown types reach into `@arethetypeswrong/core`, which ships `.ts`
 * sources that fail this repo's strictness.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    music: "src/music/index.ts",
    three: "src/three/index.ts",
    react: "src/react/index.ts",
    scape: "src/scape/index.ts",
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
