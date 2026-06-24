import { renderChatApp } from "../common/app-root";

// When this page is opened as a standalone browser tab (not embedded in the
// in-page sidebar iframe), mark it so the chat renders as a centered,
// max-width column instead of stretching edge-to-edge — see sidepanel.html.
if (typeof window !== "undefined" && window.self === window.top) {
  document.documentElement.setAttribute("data-standalone", "true");
}

// Render the chat first — nothing here should block first paint.
renderChatApp();

// Pre-warm the skill VM (QuickJS + ZenFS) so the first skill execution doesn't
// pay a cold-start WASM load. This used to run at module top with static
// imports, which pulled ~450KB of VM/filesystem glue into the sidepanel's
// first-paint bundle even though most sessions never run a skill. Defer it to
// idle and load the modules lazily so it costs nothing until the panel is up.
const prewarmSkillVm = () => {
  void Promise.all([
    import("@aipexstudio/browser-runtime/lib/vm/zenfs-manager").then((m) =>
      m.zenfs.initialize(),
    ),
    import("@aipexstudio/browser-runtime/lib/vm/quickjs-manager").then((m) =>
      m.quickjs.initialize(),
    ),
  ])
    .then(() => console.log("[Sidepanel] QuickJS and ZenFS initialized"))
    .catch((error) => {
      console.error("[Sidepanel] Failed to pre-warm skill VM:", error);
    });
};

if (typeof requestIdleCallback === "function") {
  requestIdleCallback(prewarmSkillVm, { timeout: 4000 });
} else {
  setTimeout(prewarmSkillVm, 2000);
}
