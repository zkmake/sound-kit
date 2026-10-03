import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const src = (path: string) => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));

/**
 * The demo site, served at zkmake.github.io/sound-kit/. The packages resolve to their source, so
 * editing a library hot-reloads here with no build step.
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
    ],
  },
  server: { port: 3030, strictPort: true },
  preview: { port: 4340 },
});
