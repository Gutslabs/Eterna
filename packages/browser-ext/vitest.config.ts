import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    passWithNoTests: true,
    silent: true,
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
    sequence: {
      concurrent: false,
    },
    server: {
      deps: {
        inline: [/katex/, /streamdown/],
      },
    },
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  resolve: {
    alias: [
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "./") },
      {
        find: "@eterna/core",
        replacement: path.resolve(__dirname, "../core/src/index.ts"),
      },
      {
        find: /^@eterna\/browser-runtime\/(.*)$/,
        replacement: path.resolve(__dirname, "../browser-runtime/src/$1"),
      },
      {
        find: "@eterna/browser-runtime",
        replacement: path.resolve(__dirname, "../browser-runtime/src/index.ts"),
      },
      {
        find: /^@eterna\/react\/(.*)$/,
        replacement: path.resolve(__dirname, "../eterna-react/src/$1"),
      },
      {
        find: "@eterna/react",
        replacement: path.resolve(__dirname, "../eterna-react/src/index.ts"),
      },
    ],
  },
});
