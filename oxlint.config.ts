import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["import", "typescript", "unicorn", "react", "oxc"],
  env: { browser: true },
  ignorePatterns: ["node_modules/", "dist/", "packages/*/dist/", "apps/*/dist/", ".astro/"],
  rules: {
    eqeqeq: "warn",
    curly: ["error", "all"],
    "import/no-cycle": "error",
    "no-console": "warn",
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error",
    "typescript/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
    "typescript/no-unused-vars": "off",
  },
});
