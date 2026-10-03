import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: {
    ignoreCase: true,
    newlinesBetween: true,
    groups: [
      ["side_effect"],
      ["builtin", "external"],
      ["parent", "sibling", "index"],
      ["style"],
      ["side_effect_style"],
    ],
  },
  sortPackageJson: { sortScripts: true },
  ignorePatterns: ["dist", ".astro", "CHANGELOG.md"],
});
