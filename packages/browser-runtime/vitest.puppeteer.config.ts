import { defineConfig } from "vitest/config";

// Real-browser integration tests. Referenced from vitest.config.ts, which
// excludes *.puppeteer.test.ts from the default run:
//   npx vitest run --config vitest.puppeteer.config.ts
// Requires a Chrome binary — puppeteer's own download is disabled in
// pnpm-workspace.yaml (allowBuilds), so point PUPPETEER_EXECUTABLE_PATH at a
// system Chrome if needed.
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "threads",
    sequence: {
      concurrent: false,
    },
    include: ["src/**/*.puppeteer.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
