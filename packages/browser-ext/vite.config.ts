import { createRequire } from "node:module";
import path from "node:path";
import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import manifest from "./manifest.json";

// `@openai/agents` (the meta package) is a thin re-export whose module-level
// side effects pull the entire `openai` SDK, `@openai/agents-openai`, the
// realtime package, and the OpenAI tracing exporter into the eager bundle
// (~350KB). The extension never uses any of that — every model goes through an
// aisdk() wrapper and every Agent is created with an explicit model. So for the
// extension build we redirect `@openai/agents` (and its /utils subpath) to
// `@openai/agents-core`, which exports the same Agent/run/tool/spans the code
// actually imports. Resolved via the meta package (a dep of @aipexstudio/core)
// so it works under pnpm's nested layout without an extra dependency.
// biome-ignore lint/correctness/noUnusedVariables: temporarily disabled in the alias list below; kept for quick re-enable after runtime verification.
const agentsCoreAliases = (() => {
  try {
    const require = createRequire(path.join(__dirname, "vite.config.ts"));
    const coreDir = path.resolve(__dirname, "../core");
    const metaEntry = require.resolve("@openai/agents", { paths: [coreDir] });
    const metaRoot = path.dirname(path.dirname(metaEntry));
    const toEsm = (spec: string) =>
      require
        .resolve(spec, { paths: [metaRoot] })
        .replace(/index\.js$/, "index.mjs");
    return [
      {
        find: /^@openai\/agents\/utils$/,
        replacement: toEsm("@openai/agents-core/utils"),
      },
      {
        find: /^@openai\/agents$/,
        replacement: toEsm("@openai/agents-core"),
      },
    ];
  } catch (error) {
    console.warn(
      "[vite] Could not alias @openai/agents -> @openai/agents-core; " +
        "building with the meta package (larger bundle).",
      error,
    );
    return [];
  }
})();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest: manifest as unknown as ManifestV3Export }),
    viteStaticCopy({
      // `rename: { stripBase: true }` flattens the copy (plugin v4 otherwise
      // recreates the full source path under dest, which breaks the
      // chrome.runtime.getURL("assets/...") lookups at runtime).
      targets: [
        // Extension icons referenced by the manifest. The other files in
        // assets/ (fonts, svgs) are unreferenced and intentionally not shipped.
        {
          src: ["assets/icon16.png", "assets/icon48.png", "assets/icon128.png"],
          dest: "assets",
          rename: { stripBase: true },
        },
        {
          src: "host-access-config.json",
          dest: ".",
        },
        // VAD assets for voice mode (vad-detector.ts resolves assets/vad/*)
        {
          src: [
            "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
            "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
            "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx",
          ],
          dest: "assets/vad",
          rename: { stripBase: true },
        },
        // ONNX runtime for VAD — only the single-threaded simd flavor the
        // runtime actually loads; the full dist adds ~95MB of unused variants.
        {
          src: [
            "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
            "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
          ],
          dest: "assets/onnx",
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  // Optimize dependencies - hooks are now properly isolated
  optimizeDeps: {
    // No longer need to exclude hooks since they're not in the main export path
    include: ["react", "react-dom"],
  },
  resolve: {
    // Dedupe React to ensure single instance across all chunks
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: [
      // TEMPORARILY DISABLED pending runtime verification: aliasing
      // @openai/agents -> @openai/agents-core is a build-size optimization, but
      // it swaps the whole agent runtime, so it's ruled out first while
      // debugging a "no AI response" report. Re-enable once confirmed safe.
      // ...agentsCoreAliases,
      { find: "~", replacement: path.resolve(__dirname, "./src") },
      { find: "@", replacement: path.resolve(__dirname, "./") },
      // Point to workspace packages source code directly for better dev experience
      {
        find: "@aipexstudio/aipex-core",
        replacement: path.resolve(__dirname, "../core/src/index.ts"),
      },
      {
        find: /^@aipexstudio\/aipex-react\/(.*)$/,
        replacement: path.resolve(__dirname, "../aipex-react/src/$1"),
      },
      {
        find: "@aipexstudio/aipex-react",
        replacement: path.resolve(__dirname, "../aipex-react/src/index.ts"),
      },
      {
        find: /^@aipexstudio\/browser-runtime\/(.*)$/,
        replacement: path.resolve(__dirname, "../browser-runtime/src/$1"),
      },
      {
        find: "@aipexstudio/browser-runtime",
        replacement: path.resolve(__dirname, "../browser-runtime/src/index.ts"),
      },
      {
        find: /^@aipexstudio\/dom-snapshot\/(.*)$/,
        replacement: path.resolve(__dirname, "../dom-snapshot/src/$1"),
      },
      {
        find: "@aipexstudio/dom-snapshot",
        replacement: path.resolve(__dirname, "../dom-snapshot/src/index.ts"),
      },
    ],
  },
  css: {
    postcss: "./postcss.config.js", // Use config file instead of inline
    devSourcemap: true, // Enable sourcemaps for debugging
  },
  build: {
    rollupOptions: {
      input: {
        // Note: sidepanel entry is handled by @crxjs/vite-plugin via manifest.json
        // side_panel.default_path -> src/sidepanel.html -> pages/sidepanel/index.tsx
        options: path.resolve(__dirname, "src/pages/options/index.html"),
      },
    },
    // Ensure CSS is extracted properly
    cssCodeSplit: false,
    // Vite's module-preload polyfill breaks @crxjs content scripts on
    // CSP-strict sites (x.com): it injects <link rel="modulepreload"> whose
    // URLs resolve against the *page* origin, so the preloads return the SPA's
    // HTML ("Expected a JavaScript module but got MIME type text/html") and the
    // dynamic import of the in-page UI (loadUi → ./ui) fails. With it off the
    // dynamic imports go straight through chrome.runtime.getURL and load fine.
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
      // Improve HMR reliability
      overlay: true,
    },
    // Force watch Tailwind files for better HMR
    watch: {
      ignored: ["!**/node_modules/@tailwindcss/**"],
    },
  },
});
