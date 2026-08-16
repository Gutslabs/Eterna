import pLimit from "p-limit";
import { CdpCommander } from "./cdp-commander";
import { debuggerManager } from "./debugger-manager";
import { iframeManager } from "./iframe-manager";
import type { AccessibilityTree, AXNode, TextSnapshotNode } from "./types";

/**
 * Fetch existing data-eterna-nodeid attributes from DOM elements and tagName
 * Returns a map of backendDOMNodeId → { existingId, tagName }
 */
export async function fetchExistingNodeIds(
  tabId: number,
  nodeMap: Map<string, AXNode>,
): Promise<Map<number, { existingId: string; tagName: string }>> {
  console.log(
    "🔍 [DEBUG] Fetching existing eterna-nodeids and tagNames from page",
  );
  const existingData = new Map<
    number,
    { existingId: string; tagName: string }
  >();
  const cdpCommander = new CdpCommander(tabId);

  try {
    // Ensure debugger is attached
    const attached = await debuggerManager.safeAttachDebugger(tabId);
    if (!attached) {
      console.warn(
        "⚠️ [DEBUG] Failed to attach debugger for fetching existing IDs and tagNames",
      );
      return existingData;
    }

    // Enable DOM domain
    await cdpCommander.sendCommand("DOM.enable", {});

    // Get document node
    await cdpCommander.sendCommand("DOM.getDocument", { depth: 0 });

    // Use p-limit to control concurrency
    const limit = pLimit(50);

    // Create fetch tasks for each node with backendDOMNodeId
    const fetchTasks = Array.from(nodeMap.values())
      .filter((axNode) => axNode.backendDOMNodeId)
      .map((axNode) => {
        return limit(async () => {
          try {
            // Resolve backendNodeId to objectId
            const resolved = await cdpCommander.sendCommand<{
              object?: { objectId?: string };
            }>("DOM.resolveNode", {
              backendNodeId: axNode.backendDOMNodeId,
            });

            if (!resolved?.object?.objectId) {
              return;
            }

            // Read the data-eterna-nodeid attribute and tagName
            const result = await cdpCommander.sendCommand<{
              result?: { value?: { existingId: string; tagName: string } };
            }>("Runtime.callFunctionOn", {
              objectId: resolved.object.objectId,
              functionDeclaration: `
                  function() {
                    if (this && this.getAttribute && this.tagName) {
                      return {
                        existingId: this.getAttribute('data-eterna-nodeid'),
                        tagName: this.tagName.toLowerCase()
                      };
                    }
                    return null;
                  }
                `,
              returnByValue: true,
            });

            // Store the existing ID and tagName if found
            if (result?.result?.value && axNode.backendDOMNodeId) {
              const { existingId, tagName } = result.result.value;
              existingData.set(axNode.backendDOMNodeId, {
                existingId,
                tagName: tagName || "",
              });
            }

            // Release remote object
            await cdpCommander.sendCommand("Runtime.releaseObject", {
              objectId: resolved.object.objectId,
            });
          } catch {
            // Silently skip nodes that fail to resolve
            // This is normal for nodes that are no longer in the DOM
          }
        });
      });

    // Wait for all fetch tasks to complete
    await Promise.all(fetchTasks);

    console.log(
      `✅ [DEBUG] Found ${existingData.size} existing eterna-nodeids with tagNames`,
    );

    // Disable DOM domain
    await cdpCommander.sendCommand("DOM.disable", {});
    debuggerManager.safeDetachDebugger(tabId);

    return existingData;
  } catch (error) {
    console.error("❌ [DEBUG] Error fetching existing node IDs:", error);
    debuggerManager.safeDetachDebugger(tabId, true);
    return existingData;
  }
}

/**
 * Get REAL accessibility tree using Chrome DevTools Protocol
 * This is the ACTUAL browser's native accessibility tree - exactly like Puppeteer's page.accessibility.snapshot()
 */
export async function getRealAccessibilityTree(
  tabId: number,
  includeIframes: boolean = true,
): Promise<AccessibilityTree | null> {
  try {
    console.log(
      "🔍 [DEBUG] Connecting to tab via Chrome DevTools Protocol:",
      tabId,
    );

    // Safely attach debugger to the tab
    const attached = await debuggerManager.safeAttachDebugger(tabId);
    if (!attached) {
      throw new Error("Failed to attach debugger");
    }

    const cdpCommander = new CdpCommander(tabId);

    // STEP 1: Enable accessibility domain - REQUIRED for consistent AXNodeIds
    await cdpCommander.sendCommand("Accessibility.enable", {});

    console.log("✅ [DEBUG] Accessibility domain enabled");

    // STEP 2: Get the full accessibility tree
    // This is the same as Puppeteer's page.accessibility.snapshot()
    const result = await cdpCommander.sendCommand<AccessibilityTree>(
      "Accessibility.getFullAXTree",
      {
        // depth: undefined - get full tree (not just top level)
        // frameId: undefined - get main frame
      },
    );
    console.log(
      "✅ [DEBUG] Got accessibility tree with",
      result.nodes?.length || 0,
      "nodes",
    );

    // STEP 3: Populate iframes if requested
    if (includeIframes) {
      console.log("🔍 [DEBUG] Populating iframe snapshots...");
      const treeWithIframes = await iframeManager.populateIframes(
        cdpCommander,
        result,
      );
      console.log(
        "✅ [DEBUG] Tree with iframes has",
        treeWithIframes.nodes?.length || 0,
        "nodes",
      );
      debuggerManager.safeDetachDebugger(tabId);
      return treeWithIframes;
    }

    debuggerManager.safeDetachDebugger(tabId);
    return result;
  } catch (error) {
    console.error("Failed to create accessibility snapshot:", error);
    throw new Error(`Failed to create snapshot: ${error}`);
  }
}

/**
 * inject eterna-nodeId attribute to page elements for precise positioning
 * use CDP's DOM.resolveNode to precisely locate elements instead of heuristic lookup
 *
 * solution: use backendNodeId to locate DOM nodes using CDP, then inject attribute
 * optimized: only inject new nodes that don't already have the attribute
 */
export async function injectNodeIdsToPage(
  tabId: number,
  idToNode: Map<string, TextSnapshotNode>,
  existingNodeData: Map<number, { existingId: string; tagName: string }>,
): Promise<void> {
  console.log("🔍 [DEBUG] Injecting eterna-nodeId to page elements using CDP");
  const cdpCommander = new CdpCommander(tabId);

  try {
    // ensure debugger is attached
    const attached = await debuggerManager.safeAttachDebugger(tabId);
    if (!attached) {
      console.error("❌ [DEBUG] Failed to attach debugger for node injection");
      return;
    }

    // enable DOM domain
    await cdpCommander.sendCommand("DOM.enable", {});

    // get document node (ensure DOM domain is ready)
    await cdpCommander.sendCommand("DOM.getDocument", { depth: 0 });

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // use p-limit to control concurrency,最多 50 个并发请求
    const limit = pLimit(50);

    // create inject tasks for each node
    const injectTasks = Array.from(idToNode.entries()).map(([uid, node]) => {
      if (!node.backendDOMNodeId) {
        failedCount++;
        return Promise.resolve();
      }

      // Skip nodes that already have the correct ID
      const existingData = existingNodeData.get(node.backendDOMNodeId);
      if (existingData?.existingId === uid) {
        skippedCount++;
        return Promise.resolve();
      }

      // wrap each task with limit
      return limit(async () => {
        try {
          // step 1: use DOM.resolveNode to convert backendNodeId to objectId
          const resolved = await cdpCommander.sendCommand<{
            object?: { objectId?: string };
          }>("DOM.resolveNode", { backendNodeId: node.backendDOMNodeId });

          if (!resolved?.object?.objectId) {
            console.warn(`⚠️ [DEBUG] No objectId for uid ${uid}`);
            failedCount++;
            return;
          }

          // step 2: use Runtime.callFunctionOn to directly operate on DOM element
          const result = await cdpCommander.sendCommand<{
            result?: { value?: boolean };
          }>("Runtime.callFunctionOn", {
            objectId: resolved.object.objectId,
            functionDeclaration: `
                  function(nodeId) {
                    // this is the corresponding DOM element
                    if (this && this.setAttribute) {
                      this.setAttribute('data-eterna-nodeid', nodeId);
                      return true;
                    }
                    return false;
                  }
                `,
            arguments: [{ value: uid }],
            returnByValue: true,
          });
          if (result?.result?.value === true) {
            successCount++;
          } else {
            failedCount++;
          }
          // 释放 remote object
          await cdpCommander.sendCommand("Runtime.releaseObject", {
            objectId: resolved.object.objectId,
          });
        } catch (error) {
          console.warn(`⚠️ [DEBUG] Failed to inject uid ${uid}:`, error);
          failedCount++;
        }
      });
    });

    // wait for all inject tasks to complete
    await Promise.all(injectTasks);

    console.log(
      `✅ [DEBUG] Node injection complete: ${successCount} injected, ${skippedCount} skipped (already set), ${failedCount} failed`,
    );

    // disable DOM domains
    await cdpCommander.sendCommand("DOM.disable", {});
    debuggerManager.safeDetachDebugger(tabId); // Success: schedule delayed detach (may have more operations)
  } catch (error) {
    console.error("❌ [DEBUG] Error in injectNodeIdsToPage:", error);
    debuggerManager.safeDetachDebugger(tabId, true); // Error: detach immediately
  }
}
