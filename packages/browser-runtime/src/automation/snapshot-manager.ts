/**
 * Chrome DevTools MCP 快照管理系统
 *
 * 基于文档指南实现优化的快照机制，提供清晰的UID管理和元素定位
 */

import { DomElementHandle } from "./dom-element-handle";
import { type SearchOptions, SKIP_ROLES, searchSnapshotText } from "./query";
import { SmartElementHandle } from "./smart-locator";
import { convertAccessibilityTreeToSnapshot } from "./snapshot-ax-serializer";
import {
  fetchExistingNodeIds,
  getRealAccessibilityTree,
  injectNodeIdsToPage,
} from "./snapshot-cdp";
import type {
  AXNode,
  ElementHandle,
  SnapshotStrategy,
  TextSnapshot,
  TextSnapshotNode,
} from "./types";

type DomSnapshotNode = {
  id: string;
  role: string;
  name?: string;
  value?: string;
  description?: string;
  children: DomSnapshotNode[];
  tagName?: string;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  disabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  expanded?: boolean;
  placeholder?: string;
};

type SerializedDomSnapshot = {
  root: DomSnapshotNode;
  idToNode: Record<string, DomSnapshotNode>;
  totalNodes: number;
  timestamp: number;
  metadata: {
    title: string;
    url: string;
    collectedAt: string;
    options: Record<string, unknown>;
  };
};

type SearchAndFormatOptions = Partial<SearchOptions> & {
  snapshotStrategy?: SnapshotStrategy;
};

/**
 * 快照管理器
 *
 * 负责创建、管理和格式化页面快照
 */
export class SnapshotManager {
  #snapshotMap: Map<number, TextSnapshot> = new Map();
  #snapshotStrategyMap: Map<number, SnapshotStrategy> = new Map();

  private async getDomSnapshot(
    tabId: number,
    frameId?: number,
  ): Promise<SerializedDomSnapshot> {
    if (typeof chrome === "undefined" || !chrome.tabs?.sendMessage) {
      throw new Error("chrome.tabs API unavailable for DOM snapshot.");
    }

    const targetFrameId = frameId ?? 0;
    const response = (await chrome.tabs.sendMessage(
      tabId,
      {
        request: "collect-dom-snapshot",
      },
      { frameId: targetFrameId },
    )) as { success: boolean; data?: SerializedDomSnapshot; error?: string };

    if (!response) {
      throw new Error("No response received from DOM snapshot handler.");
    }

    if (!response.success || !response.data) {
      throw new Error(response.error || "Failed to collect DOM snapshot.");
    }

    return response.data;
  }

  private buildTextSnapshotFromDom(
    source: SerializedDomSnapshot,
    tabId: number,
  ): TextSnapshot {
    const idToNode = new Map<string, TextSnapshotNode>();

    const cloneNode = (node: DomSnapshotNode): TextSnapshotNode => {
      const clonedChildren =
        node.children?.map((child) => cloneNode(child)) ?? [];
      const clonedNode: TextSnapshotNode = {
        id: node.id,
        role: node.role,
        name: node.name,
        value: node.value,
        description: node.description,
        children: clonedChildren,
        tagName: node.tagName,
        checked: node.checked,
        pressed: node.pressed,
        disabled: node.disabled,
        focused: node.focused,
        selected: node.selected,
        expanded: node.expanded,
      };

      if (node.placeholder && !clonedNode.description) {
        clonedNode.description = node.placeholder;
      }

      idToNode.set(clonedNode.id, clonedNode);
      return clonedNode;
    };

    const root = cloneNode(source.root);
    return { root, idToNode, tabId };
  }

  private async getAllFrames(
    tabId: number,
  ): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
    if (typeof chrome === "undefined" || !chrome.webNavigation?.getAllFrames) {
      return [];
    }

    return new Promise((resolve, reject) => {
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(frames || []);
      });
    });
  }

  private shouldCollectFrame(
    frameUrl: string | undefined,
    topOrigin: string | null,
  ): boolean {
    if (!frameUrl) {
      return false;
    }
    if (
      frameUrl.startsWith("about:") ||
      frameUrl.startsWith("javascript:") ||
      frameUrl.startsWith("data:")
    ) {
      return false;
    }
    try {
      const origin = new URL(frameUrl).origin;
      if (origin === "null") {
        return false;
      }
      return topOrigin ? origin !== topOrigin : true;
    } catch {
      return false;
    }
  }

  private normalizeUrl(url: string, baseUrl: string): string | null {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  private async getIframeUidBuckets(
    tabId: number,
    baseUrl: string,
  ): Promise<Map<string, string[]>> {
    const buckets = new Map<string, string[]>();
    if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
      return buckets;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () =>
        Array.from(document.querySelectorAll("iframe")).map((frame) => ({
          uid: frame.getAttribute("data-eterna-nodeid") || "",
          src: frame.getAttribute("src") || "",
          resolvedSrc: frame instanceof HTMLIFrameElement ? frame.src : "",
        })),
    });

    const [result] = results;
    const frames =
      (result?.result as
        | Array<{
            uid: string;
            src: string;
            resolvedSrc: string;
          }>
        | undefined) ?? [];

    for (const frame of frames) {
      if (!frame.uid) {
        continue;
      }
      const rawUrl = frame.resolvedSrc || frame.src;
      if (!rawUrl) {
        continue;
      }
      const normalized = this.normalizeUrl(rawUrl, baseUrl);
      if (!normalized) {
        continue;
      }
      if (!buckets.has(normalized)) {
        buckets.set(normalized, []);
      }
      buckets.get(normalized)!.push(frame.uid);
    }

    return buckets;
  }

  private mergeFrameSnapshots(
    mainSnapshot: SerializedDomSnapshot,
    frameSnapshots: Array<{ frameId: string; snapshot: SerializedDomSnapshot }>,
    frameUidMap: Map<string, string>,
  ): void {
    const findNodeInTree = (
      root: DomSnapshotNode,
      predicate: (node: DomSnapshotNode) => boolean,
    ): DomSnapshotNode | undefined => {
      const stack: DomSnapshotNode[] = [root];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (predicate(current)) {
          return current;
        }
        if (current.children?.length) {
          stack.push(...current.children);
        }
      }
      return undefined;
    };

    const findNodeById = (id: string): DomSnapshotNode | undefined =>
      findNodeInTree(mainSnapshot.root, (node) => node.id === id);

    const ensureUniqueId = (baseId: string): string => {
      let candidate = baseId;
      let counter = 1;
      while (mainSnapshot.idToNode[candidate]) {
        candidate = `${baseId}_${counter}`;
        counter += 1;
      }
      return candidate;
    };
    const usedIframeIds = new Set<string>();

    const findAvailableIframeNode = (): DomSnapshotNode | undefined =>
      findNodeInTree(
        mainSnapshot.root,
        (node) =>
          node.tagName === "iframe" &&
          !usedIframeIds.has(node.id) &&
          (node.children?.length ?? 0) === 0,
      );

    for (const frame of frameSnapshots) {
      const iframeUid = frameUidMap.get(frame.frameId);
      let iframeNode =
        iframeUid !== undefined ? findNodeById(iframeUid) : undefined;
      if (!iframeNode && iframeUid) {
        iframeNode = mainSnapshot.idToNode[iframeUid];
        if (iframeNode) {
          const existsInRoot = findNodeById(iframeNode.id);
          if (!existsInRoot) {
            mainSnapshot.root.children.push(iframeNode);
          }
        }
      }

      if (iframeNode) {
        mainSnapshot.idToNode[iframeNode.id] = iframeNode;
        usedIframeIds.add(iframeNode.id);
      }

      if (!iframeNode) {
        const fallbackMatch = findAvailableIframeNode();
        if (fallbackMatch) {
          iframeNode = fallbackMatch;
          usedIframeIds.add(fallbackMatch.id);
        }
      }

      if (!iframeNode) {
        const fallbackId = ensureUniqueId(`frame_${frame.frameId}`);
        iframeNode = {
          id: fallbackId,
          role: "iframe",
          name: frame.snapshot.metadata?.url || `frame ${frame.frameId}`,
          children: [],
          tagName: "iframe",
        };
        mainSnapshot.idToNode[fallbackId] = iframeNode;
        mainSnapshot.root.children.push(iframeNode);
        usedIframeIds.add(fallbackId);
      }

      if (!iframeNode.children) {
        iframeNode.children = [];
      }
      iframeNode.children.push(frame.snapshot.root);

      for (const [uid, node] of Object.entries(frame.snapshot.idToNode)) {
        if (!mainSnapshot.idToNode[uid]) {
          mainSnapshot.idToNode[uid] = node;
        }
      }
    }

    mainSnapshot.totalNodes = Object.keys(mainSnapshot.idToNode).length;
  }

  /**
   * create snapshot
   *
   * get accessibility tree using Chrome DevTools Protocol
   */
  async createSnapshot(
    tabId: number,
    includeIframes: boolean = true,
    strategy: SnapshotStrategy = "axtree",
  ): Promise<TextSnapshot> {
    try {
      if (strategy === "dom") {
        const domSnapshot = await this.getDomSnapshot(tabId);
        if (includeIframes) {
          const frames = await this.getAllFrames(tabId).catch(() => []);
          const topOrigin = (() => {
            try {
              return new URL(domSnapshot.metadata.url).origin;
            } catch {
              return null;
            }
          })();
          const targetFrames = frames.filter(
            (frame) =>
              frame.frameId !== 0 &&
              this.shouldCollectFrame(frame.url, topOrigin),
          );
          if (targetFrames.length > 0) {
            const frameSnapshots = (
              await Promise.all(
                targetFrames.map(async (frame) => {
                  try {
                    const snapshot = await this.getDomSnapshot(
                      tabId,
                      frame.frameId,
                    );
                    return { frameId: String(frame.frameId), snapshot };
                  } catch {
                    return null;
                  }
                }),
              )
            ).filter(
              (
                item,
              ): item is { frameId: string; snapshot: SerializedDomSnapshot } =>
                item !== null,
            );
            const iframeUidBuckets = await this.getIframeUidBuckets(
              tabId,
              domSnapshot.metadata.url,
            );
            const frameUidMap = new Map<string, string>();
            for (const frame of targetFrames) {
              const frameUrl = frame.url || "";
              const normalized = this.normalizeUrl(
                frameUrl,
                domSnapshot.metadata.url,
              );
              if (!normalized) {
                continue;
              }
              const bucket = iframeUidBuckets.get(normalized);
              if (!bucket || bucket.length === 0) {
                continue;
              }
              const uid = bucket.shift();
              if (uid) {
                frameUidMap.set(String(frame.frameId), uid);
              }
            }

            this.mergeFrameSnapshots(domSnapshot, frameSnapshots, frameUidMap);
          }
        }

        const domTextSnapshot = this.buildTextSnapshotFromDom(
          domSnapshot,
          tabId,
        );
        const snapshot: TextSnapshot = {
          root: domTextSnapshot.root,
          idToNode: domTextSnapshot.idToNode,
          tabId,
        };
        this.#snapshotMap.set(tabId, snapshot);
        this.#snapshotStrategyMap.set(tabId, strategy);
        return snapshot;
      }

      // get accessibility tree
      const axTree = await getRealAccessibilityTree(tabId, includeIframes);

      if (!axTree?.nodes || axTree.nodes.length === 0) {
        throw new Error("No accessibility nodes found");
      }

      // Build nodeId -> AXNode map for fetching existing IDs
      const nodeMap = new Map<string, AXNode>();
      for (const node of axTree.nodes) {
        nodeMap.set(node.nodeId, node);
      }

      console.log("🔍 [DEBUG] Node map:", nodeMap);

      // Fetch existing node IDs and tagNames from the page
      const existingNodeData = await fetchExistingNodeIds(tabId, nodeMap);

      console.log("🔍 [DEBUG] Existing node data:", existingNodeData);

      const snapshotResult = convertAccessibilityTreeToSnapshot(
        axTree,
        existingNodeData,
      );
      if (!snapshotResult) {
        throw new Error("Failed to convert accessibility tree to snapshot");
      }
      const snapshot: TextSnapshot = {
        root: snapshotResult.root,
        idToNode: snapshotResult.idToNode,
        tabId,
      };
      // inject eterna-nodeId attribute to page elements for precise positioning
      // only inject new nodes, skip those that already have the correct ID
      await injectNodeIdsToPage(tabId, snapshot.idToNode, existingNodeData);
      this.#snapshotMap.set(tabId, snapshot);
      this.#snapshotStrategyMap.set(tabId, strategy);
      return snapshot;
    } catch (error) {
      console.error("Failed to create accessibility snapshot:", error);
      throw new Error(`Failed to create snapshot: ${error}`);
    }
  }

  /**
   * get snapshot by tabId
   */
  getSnapshot(tabId: number): TextSnapshot | null {
    return this.#snapshotMap.get(tabId) || null;
  }

  /**
   * get node by uid
   */
  getNodeByUid(tabId: number, uid: string): TextSnapshotNode | null {
    const snapshot = this.getSnapshot(tabId);
    if (!snapshot) {
      return null;
    }
    return snapshot.idToNode.get(uid) || null;
  }

  /**
   * Get element handle by uid based on snapshot strategy
   */
  getElementHandle(tabId: number, uid: string): ElementHandle | null {
    const snapshot = this.getSnapshot(tabId);
    if (!snapshot) {
      return null;
    }
    const node = snapshot.idToNode.get(uid);
    if (!node) {
      return null;
    }

    const strategy = this.#snapshotStrategyMap.get(tabId) ?? "axtree";
    if (strategy === "dom") {
      return new DomElementHandle(tabId, node);
    }

    if (node.backendDOMNodeId) {
      return new SmartElementHandle(tabId, node, node.backendDOMNodeId);
    }

    return null;
  }

  /**
   * format snapshot to text
   */
  formatSnapshot(snapshot: TextSnapshot): string {
    const focusedNodeIds: string[] = [];
    for (const [id, node] of snapshot.idToNode.entries()) {
      if (node.focused) focusedNodeIds.push(id);
    }

    // 计算所有焦点祖先链（把祖先都标记为 focus-path）
    const focusAncestorSet = new Set<string>();
    // helper: DFS to find path from root to target
    function findPath(
      rootIdLocal: string,
      targetId: string,
      visited = new Set<string>(),
    ): string[] | null {
      if (rootIdLocal === targetId) return [rootIdLocal];
      if (visited.has(rootIdLocal)) return null;
      visited.add(rootIdLocal);
      const node = snapshot.idToNode.get(rootIdLocal);
      if (!node) return null;
      for (const c of node.children) {
        const p = findPath(c.id, targetId, visited);
        if (p) {
          return [rootIdLocal, ...p];
        }
      }
      return null;
    }

    for (const fid of focusedNodeIds) {
      const path = findPath(snapshot.root.id, fid);
      if (path) {
        for (const p of path) {
          focusAncestorSet.add(p);
        }
      } else {
        focusAncestorSet.add(fid); // 若找不到路径（fragmented tree），至少标注焦点自身
      }
    }
    return this.formatNode(snapshot.root, 0, focusAncestorSet);
  }

  /**
   * Search snapshot and format results with context
   *
   * @param tabId - Tab ID to search
   * @param query - Search query string (supports "|" for multiple terms and glob patterns)
   * @param contextLevels - Number of lines to include around matches (default: 1)
   * @param options - Additional search options (including snapshotStrategy)
   * @returns Formatted text showing matched lines with context, or null if no snapshot
   */
  async searchAndFormat(
    tabId: number,
    query: string,
    contextLevels: number = 1,
    options?: SearchAndFormatOptions,
  ): Promise<string | null> {
    let snapshot: TextSnapshot | null = null;
    const { snapshotStrategy = "axtree", ...searchOptions } = options ?? {};
    try {
      snapshot = await this.createSnapshot(tabId, true, snapshotStrategy);
    } catch {
      return null;
    }

    if (!snapshot) {
      return null;
    }

    // Get formatted snapshot text
    const snapshotText = this.formatSnapshot(snapshot);

    // Perform text search
    const searchResult = searchSnapshotText(snapshotText, query, {
      contextLevels,
      ...searchOptions,
    });

    if (searchResult.totalMatches === 0) {
      return `No matches found for: ${query}`;
    }

    // Format results showing only matched lines with context
    return this.formatSearchResults(snapshotText, searchResult);
  }

  /**
   * Format search results with context
   * Shows only matched lines with surrounding context, separated by dividers
   */
  private formatSearchResults(
    snapshotText: string,
    searchResult: {
      matchedLines: number[];
      contextLines: number[];
      totalMatches: number;
    },
  ): string {
    const { matchedLines, contextLines } = searchResult;
    const lines = snapshotText.split("\n");

    // Create a set for quick lookup of matched lines
    const matchedSet = new Set(matchedLines);

    // Group context lines by proximity to matched lines
    const resultGroups: string[][] = [];
    let currentGroup: string[] = [];
    let lastContextLine = -1;

    for (const lineNum of contextLines) {
      if (lineNum >= 0 && lineNum < lines.length) {
        const line = lines[lineNum];

        if (!line) {
          continue;
        }

        // Check if we need to start a new group
        // Start new group if there's a gap > 2 lines from the last context line
        if (currentGroup.length > 0 && lineNum - lastContextLine > 2) {
          resultGroups.push(currentGroup);
          currentGroup = [];
        }

        // Add marker for matched lines
        if (matchedSet.has(lineNum)) {
          // Replace the first space with ✓ for matched lines
          const markedLine = line.replace(/^(\s*)([^\s])/, "$1✓$2");
          currentGroup.push(markedLine);
        } else {
          currentGroup.push(line);
        }

        lastContextLine = lineNum;
      }
    }

    // Add the last group
    if (currentGroup.length > 0) {
      resultGroups.push(currentGroup);
    }

    // Join groups with dividers
    return resultGroups.map((group) => group.join("\n")).join("\n----\n");
  }

  /**
   * clear snapshot by tabId
   */
  clearSnapshot(tabId: number): void {
    this.#snapshotMap.delete(tabId);
    this.#snapshotStrategyMap.delete(tabId);
  }

  /**
   * clear all snapshots
   */
  clearAllSnapshots(): void {
    this.#snapshotMap.clear();
    this.#snapshotStrategyMap.clear();
  }

  /**
   * check if uid is valid
   */
  isValidUid(tabId: number, uid: string): boolean {
    const snapshot = this.getSnapshot(tabId);
    if (!snapshot) {
      return false;
    }
    return snapshot.idToNode.has(uid);
  }

  /**
   * Determine if a node should be included in output (like DevTools MCP)
   * Only include truly interactive or meaningful elements
   */
  private shouldIncludeInOutput(node: TextSnapshotNode): boolean {
    const role = node.role || "";
    const name = node.name || "";

    // Include root web area (always first)
    if (role === "RootWebArea") {
      return true;
    }

    // Always include interactive elements
    const interactiveRoles = [
      "button",
      "link",
      "textbox",
      "combobox",
      "checkbox",
      "radio",
      "menuitem",
      "tab",
      "slider",
      "spinbutton",
      "searchbox",
    ];

    if (interactiveRoles.includes(role)) {
      return true;
    }

    // Include images (like Google logo)
    if (role === "image" || role === "img") {
      return true;
    }

    // Include StaticText with meaningful content (like link text)
    if (role === "StaticText" && name && name.trim().length > 0) {
      // But skip very short or meaningless text
      const trimmedName = name.trim();
      if (trimmedName.length >= 2) {
        return true;
      }
    }

    if (SKIP_ROLES.includes(role)) {
      return false;
    }

    // For any other role, include if it has meaningful content
    if (name && name.trim().length > 1) {
      return true;
    }

    return false;
  }

  /**
   * format node recursively
   */
  private formatNode(
    node: TextSnapshotNode,
    depth: number,
    focusAncestorSet: Set<string>,
  ): string {
    const shouldInclude = this.shouldIncludeInOutput(node);
    const attributes = shouldInclude
      ? this.getNodeAttributes(node)
      : [node.role];
    // marker: '*' = exact focused node; '→' = ancestor in focus path
    const marker = node.focused
      ? "*"
      : focusAncestorSet.has(node.id)
        ? "→"
        : " ";
    let result = `${" ".repeat(depth * 1) + marker + attributes.join(" ")}\n`;

    // recursively format child nodes
    for (const child of node.children) {
      result += this.formatNode(child, depth + 1, focusAncestorSet);
    }

    return result;
  }

  /**
   * get node attributes list
   */
  private getNodeAttributes(node: TextSnapshotNode): string[] {
    const attributes = [`uid=${node.id}`, node.role, `"${node.name || ""}"`];

    // Add tagName if available
    if (node.tagName) {
      attributes.push(`<${node.tagName}>`);
    }

    // 添加值属性
    const valueProperties = [
      "value",
      "valuetext",
      "valuemin",
      "valuemax",
      "level",
      "autocomplete",
    ];
    for (const property of valueProperties) {
      const value = (node as any)[property];
      if (value !== undefined && value !== null) {
        attributes.push(`${property}="${value}"`);
      }
    }

    // 添加布尔属性
    const booleanProperties = {
      disabled: "disableable",
      expanded: "expandable",
      focused: "focusable",
      selected: "selectable",
      modal: "modal",
      readonly: "readonly",
      required: "required",
    };

    for (const [property, capability] of Object.entries(booleanProperties)) {
      const value = (node as any)[property];
      if (value !== undefined) {
        attributes.push(capability);
        if (value) {
          attributes.push(property);
        }
      }
    }

    // 添加混合属性
    for (const property of ["pressed", "checked"]) {
      const value = (node as any)[property];
      if (value !== undefined) {
        attributes.push(property);
        if (value && value !== true) {
          attributes.push(`${property}="${value}"`);
        } else if (value === true) {
          attributes.push(property);
        }
      }
    }

    return attributes.filter(
      (attribute): attribute is string => attribute !== undefined,
    );
  }
}

// 导出单例实例
export const snapshotManager = new SnapshotManager();
