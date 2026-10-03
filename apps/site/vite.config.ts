import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const src = (path: string) => here(`../../packages/${path}`);

/**
 * The site, served at zkmake.github.io/sound-kit/: a landing page and one demo page per package.
 * The packages resolve to their source, so editing a library hot-reloads here with no build step.
 */
export default defineConfig({
  base: "/sound-kit/",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@zkmake\/sound-scape$/, replacement: src("sound-scape/src/index.ts") },
      {
        find: /^@zkmake\/sound-scape\/react$/,
        replacement: src("sound-scape/src/react/index.tsx"),
      },
      {
        find: /^@zkmake\/sound-scape\/(howler|web-audio)$/,
        replacement: src("sound-scape/src/$1/index.ts"),
      },
      { find: /^@zkmake\/sound-mixer$/, replacement: src("sound-mixer/src/index.ts") },
      {
        find: /^@zkmake\/sound-mixer\/(music|three|react|scape)$/,
        replacement: src("sound-mixer/src/$1/index.ts"),
      },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        index: here("index.html"),
        "sound-scape": here("sound-scape/index.html"),
        "sound-mixer": here("sound-mixer/index.html"),
      },
    },
  },
  server: { port: 3030, strictPort: true },
  preview: { port: 4340 },
});
