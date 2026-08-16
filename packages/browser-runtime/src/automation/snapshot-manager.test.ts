/**
 * Snapshot Manager Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnapshotManager } from "./snapshot-manager";
import type { AccessibilityTree } from "./types";

// Mock dependencies - hoisted to ensure they're available before imports
const mockSendCommand = vi.hoisted(() => vi.fn());
const mockSafeAttachDebugger = vi.hoisted(() => vi.fn());
const mockSafeDetachDebugger = vi.hoisted(() => vi.fn());
const mockExecuteScript = vi.hoisted(() => vi.fn());
const mockPopulateIframes = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockGetAllFrames = vi.hoisted(() => vi.fn());

// Mock chrome.debugger.sendCommand
vi.mock("./cdp-commander", () => ({
  CdpCommander: class {
    sendCommand = mockSendCommand;
  },
}));

// Mock debugger-manager
vi.mock("./debugger-manager", () => ({
  debuggerManager: {
    safeAttachDebugger: mockSafeAttachDebugger,
    safeDetachDebugger: mockSafeDetachDebugger,
  },
}));

// Mock iframe-manager
vi.mock("./iframe-manager", () => ({
  iframeManager: {
    populateIframes: mockPopulateIframes,
  },
}));

// Mock chrome.scripting
global.chrome = {
  scripting: {
    executeScript: mockExecuteScript,
  },
  debugger: {
    sendCommand: vi.fn(),
    attach: vi.fn((_, __, callback) => callback()),
    detach: vi.fn((_, callback) => callback()),
    onDetach: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    sendMessage: mockSendMessage,
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  webNavigation: {
    getAllFrames: mockGetAllFrames,
  },
  runtime: {
    lastError: null,
  },
} as any;

describe("SnapshotManager", () => {
  let snapshotManager: SnapshotManager;

  beforeEach(() => {
    vi.resetAllMocks();
    snapshotManager = new SnapshotManager();
    mockSafeAttachDebugger.mockResolvedValue(true);
    mockSafeDetachDebugger.mockResolvedValue(undefined);
    mockExecuteScript.mockResolvedValue([{ result: false }]);
    mockSendMessage.mockResolvedValue({ success: false });
    mockGetAllFrames.mockImplementation((_options, callback) => {
      callback([]);
    });
    // Default: return tree as-is (no iframes)
    mockPopulateIframes.mockImplementation(async (_, tree) => tree);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createSnapshot", () => {
    it("should create a snapshot from accessibility tree", async () => {
      const mockAXTree: AccessibilityTree = {
        nodes: [
          {
            nodeId: "1",
            ignored: false,
            role: { type: "string", value: "RootWebArea" },
            name: { type: "string", value: "Test Page" },
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            ignored: false,
            role: { type: "string", value: "button" },
            name: { type: "string", value: "Click Me" },
            parentId: "1",
            backendDOMNodeId: 2,
          },
        ],
      };

      // Mock CDP commands
      mockSendCommand
        .mockResolvedValueOnce(undefined) // Accessibility.enable
        .mockResolvedValueOnce(mockAXTree) // Accessibility.getFullAXTree
        .mockResolvedValueOnce(undefined) // DOM.enable
        .mockResolvedValueOnce({}) // DOM.getDocument
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for node 1
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "html" } },
        }) // Runtime.callFunctionOn for node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for node 2
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "button" } },
        }) // Runtime.callFunctionOn for node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 2
        .mockResolvedValueOnce(undefined) // DOM.disable
        .mockResolvedValueOnce(undefined) // DOM.enable (for injection)
        .mockResolvedValueOnce({}) // DOM.getDocument (for injection)
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for injection node 1
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for injection node 2
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 2
        .mockResolvedValueOnce(undefined); // DOM.disable (for injection)

      const snapshot = await snapshotManager.createSnapshot(1);

      expect(snapshot).toBeDefined();
      expect(snapshot.tabId).toBe(1);
      expect(snapshot.root).toBeDefined();
      expect(snapshot.idToNode.size).toBeGreaterThan(0);
      expect(mockSafeAttachDebugger).toHaveBeenCalled();
    });

    it("should throw error when no accessibility nodes found", async () => {
      mockSendCommand
        .mockResolvedValueOnce(undefined) // Accessibility.enable
        .mockResolvedValueOnce({ nodes: [] }); // Empty accessibility tree

      await expect(snapshotManager.createSnapshot(1)).rejects.toThrow(
        "No accessibility nodes found",
      );
    });

    it("should handle debugger attach failure gracefully", async () => {
      mockSafeAttachDebugger.mockResolvedValueOnce(false);

      const mockAXTree: AccessibilityTree = {
        nodes: [
          {
            nodeId: "1",
            ignored: false,
            role: { type: "string", value: "RootWebArea" },
            backendDOMNodeId: 1,
          },
        ],
      };

      mockSendCommand
        .mockResolvedValueOnce(undefined) // Accessibility.enable
        .mockResolvedValueOnce(mockAXTree); // Accessibility.getFullAXTree

      await expect(snapshotManager.createSnapshot(1)).rejects.toThrow();
    });

    it("should include iframes when includeIframes is true", async () => {
      const mockAXTree: AccessibilityTree = {
        nodes: [
          {
            nodeId: "1",
            ignored: false,
            role: { type: "string", value: "RootWebArea" },
            name: { type: "string", value: "Test Page" },
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            ignored: false,
            role: { type: "string", value: "button" },
            name: { type: "string", value: "Click Me" },
            parentId: "1",
            backendDOMNodeId: 2,
          },
        ],
      };

      const mockTreeWithIframes: AccessibilityTree = {
        nodes: [
          ...mockAXTree.nodes,
          {
            nodeId: "iframe:1",
            ignored: false,
            role: { type: "string", value: "RootWebArea" },
            name: { type: "string", value: "Iframe Content" },
            frameId: "iframe1",
            backendDOMNodeId: 10,
          },
        ],
      };

      mockPopulateIframes.mockResolvedValueOnce(mockTreeWithIframes);

      mockSendCommand
        .mockResolvedValueOnce(undefined) // Accessibility.enable
        .mockResolvedValueOnce(mockAXTree) // Accessibility.getFullAXTree
        .mockResolvedValueOnce(undefined) // DOM.enable
        .mockResolvedValueOnce({}) // DOM.getDocument
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for node 1
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "html" } },
        }) // Runtime.callFunctionOn for node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for node 2
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "button" } },
        }) // Runtime.callFunctionOn for node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 2
        .mockResolvedValueOnce(undefined) // DOM.disable
        .mockResolvedValueOnce(undefined) // DOM.enable (for injection)
        .mockResolvedValueOnce({}) // DOM.getDocument (for injection)
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for injection node 1
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for injection node 2
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 2
        .mockResolvedValueOnce(undefined); // DOM.disable for injection

      const snapshot = await snapshotManager.createSnapshot(1, true);

      expect(snapshot).toBeDefined();
      expect(mockPopulateIframes).toHaveBeenCalled();
    });

    it("should create a snapshot from DOM strategy", async () => {
      const domSnapshot = {
        root: {
          id: "dom_root",
          role: "RootWebArea",
          name: "Test Page",
          children: [],
          tagName: "body",
        },
        idToNode: {
          dom_root: {
            id: "dom_root",
            role: "RootWebArea",
            name: "Test Page",
            children: [],
            tagName: "body",
          },
        },
        totalNodes: 1,
        timestamp: Date.now(),
        metadata: {
          title: "Test Page",
          url: "https://example.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        data: domSnapshot,
      });

      const snapshot = await snapshotManager.createSnapshot(1, true, "dom");

      expect(snapshot).toBeDefined();
      expect(snapshot.tabId).toBe(1);
      expect(snapshot.root.role).toBe("RootWebArea");
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it("should map placeholder to description in DOM strategy", async () => {
      const domSnapshot = {
        root: {
          id: "dom_root",
          role: "RootWebArea",
          name: "Test Page",
          children: [
            {
              id: "input_1",
              role: "textbox",
              name: "Email",
              placeholder: "Email",
              children: [],
              tagName: "input",
            },
          ],
          tagName: "body",
        },
        idToNode: {
          dom_root: {
            id: "dom_root",
            role: "RootWebArea",
            name: "Test Page",
            children: [
              {
                id: "input_1",
                role: "textbox",
                name: "Email",
                placeholder: "Email",
                children: [],
                tagName: "input",
              },
            ],
            tagName: "body",
          },
          input_1: {
            id: "input_1",
            role: "textbox",
            name: "Email",
            placeholder: "Email",
            children: [],
            tagName: "input",
          },
        },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "Test Page",
          url: "https://example.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        data: domSnapshot,
      });

      const snapshot = await snapshotManager.createSnapshot(1, false, "dom");
      const inputNode = snapshot.idToNode.get("input_1");

      expect(inputNode?.description).toBe("Email");
    });

    it("should search DOM snapshot text with dom strategy", async () => {
      const domSnapshot = {
        root: {
          id: "dom_root",
          role: "RootWebArea",
          name: "Test Page",
          children: [
            {
              id: "text_1",
              role: "StaticText",
              name: "Find Me",
              children: [],
            },
          ],
          tagName: "body",
        },
        idToNode: {
          dom_root: {
            id: "dom_root",
            role: "RootWebArea",
            name: "Test Page",
            children: [
              {
                id: "text_1",
                role: "StaticText",
                name: "Find Me",
                children: [],
              },
            ],
            tagName: "body",
          },
          text_1: {
            id: "text_1",
            role: "StaticText",
            name: "Find Me",
            children: [],
          },
        },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "Test Page",
          url: "https://example.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      mockSendMessage.mockResolvedValueOnce({
        success: true,
        data: domSnapshot,
      });

      const result = await snapshotManager.searchAndFormat(1, "Find Me", 1, {
        snapshotStrategy: "dom",
      });

      expect(result).toContain("Find Me");
      expect(result).toContain("✓");
    });

    it("should merge iframe snapshots for dom strategy", async () => {
      const mainSnapshot = {
        root: {
          id: "dom_root",
          role: "RootWebArea",
          name: "Main Page",
          children: [
            {
              id: "iframe_uid",
              role: "iframe",
              name: "iframe",
              children: [],
              tagName: "iframe",
            },
          ],
          tagName: "body",
        },
        idToNode: {
          dom_root: {
            id: "dom_root",
            role: "RootWebArea",
            name: "Main Page",
            children: [
              {
                id: "iframe_uid",
                role: "iframe",
                name: "iframe",
                children: [],
                tagName: "iframe",
              },
            ],
            tagName: "body",
          },
          iframe_uid: {
            id: "iframe_uid",
            role: "iframe",
            name: "iframe",
            children: [],
            tagName: "iframe",
          },
        },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "Main Page",
          url: "https://main.example",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const frameSnapshot = {
        root: {
          id: "frame_root",
          role: "RootWebArea",
          name: "Frame Page",
          children: [
            {
              id: "frame_text",
              role: "StaticText",
              name: "Frame content",
              children: [],
            },
          ],
          tagName: "body",
        },
        idToNode: {
          frame_root: {
            id: "frame_root",
            role: "RootWebArea",
            name: "Frame Page",
            children: [
              {
                id: "frame_text",
                role: "StaticText",
                name: "Frame content",
                children: [],
              },
            ],
            tagName: "body",
          },
          frame_text: {
            id: "frame_text",
            role: "StaticText",
            name: "Frame content",
            children: [],
          },
        },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "Frame Page",
          url: "https://frame.example",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      mockSendMessage.mockImplementation((_tabId, _message, options) => {
        if (options?.frameId) {
          return Promise.resolve({ success: true, data: frameSnapshot });
        }
        return Promise.resolve({ success: true, data: mainSnapshot });
      });

      mockGetAllFrames.mockImplementation((_options, callback) => {
        callback([
          { frameId: 0, url: "https://main.example" },
          { frameId: 1, url: "https://frame.example" },
        ]);
      });

      mockExecuteScript.mockResolvedValueOnce([
        {
          result: [
            {
              uid: "iframe_uid",
              src: "https://frame.example",
              resolvedSrc: "https://frame.example",
            },
          ],
        },
      ]);

      const snapshot = await snapshotManager.createSnapshot(1, true, "dom");
      const iframeNode = snapshot.idToNode.get("iframe_uid");

      expect(iframeNode?.children.length).toBeGreaterThan(0);
      expect(snapshot.idToNode.get("frame_root")).toBeDefined();
    });

    it("should not include iframes when includeIframes is false", async () => {
      const mockAXTree: AccessibilityTree = {
        nodes: [
          {
            nodeId: "1",
            ignored: false,
            role: { type: "string", value: "RootWebArea" },
            name: { type: "string", value: "Test Page" },
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            ignored: false,
            role: { type: "string", value: "button" },
            name: { type: "string", value: "Click Me" },
            parentId: "1",
            backendDOMNodeId: 2,
          },
        ],
      };

      mockSendCommand
        .mockResolvedValueOnce(undefined) // Accessibility.enable
        .mockResolvedValueOnce(mockAXTree) // Accessibility.getFullAXTree
        .mockResolvedValueOnce(undefined) // DOM.enable
        .mockResolvedValueOnce({}) // DOM.getDocument
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for node 1
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "html" } },
        }) // Runtime.callFunctionOn for node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for node 2
        .mockResolvedValueOnce({
          result: { value: { existingId: null, tagName: "button" } },
        }) // Runtime.callFunctionOn for node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for node 2
        .mockResolvedValueOnce(undefined) // DOM.disable
        .mockResolvedValueOnce(undefined) // DOM.enable (for injection)
        .mockResolvedValueOnce({}) // DOM.getDocument (for injection)
        .mockResolvedValueOnce({
          object: { objectId: "obj1" },
        }) // DOM.resolveNode for injection node 1
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 1
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 1
        .mockResolvedValueOnce({
          object: { objectId: "obj2" },
        }) // DOM.resolveNode for injection node 2
        .mockResolvedValueOnce({
          result: { value: true },
        }) // Runtime.callFunctionOn for injection node 2
        .mockResolvedValueOnce(undefined) // Runtime.releaseObject for injection node 2
        .mockResolvedValueOnce(undefined); // DOM.disable for injection

      const snapshot = await snapshotManager.createSnapshot(1, false);

      expect(snapshot).toBeDefined();
      expect(mockPopulateIframes).not.toHaveBeenCalled();
    });
  });
});
