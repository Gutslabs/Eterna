import { beforeEach, describe, expect, it } from "vitest";
import { buildTextSnapshot, formatSnapshot } from "../manager";
import type { DomSnapshotNode, SerializedDomSnapshot } from "../types";
import { setHtml } from "./dom-automation-test-utils";

describe("DOM snapshot manager", () => {
  beforeEach(() => {
    setHtml(`
      <section>
        <button id="submit-btn">Submit</button>
      </section>
    `);
  });

  describe("formatNode marker logic", () => {
    it("uses space marker for non-focused nodes not in focus path", () => {
      const nonFocusedNode: DomSnapshotNode = {
        id: "sibling",
        role: "button",
        name: "Sibling",
        children: [],
        tagName: "button",
        focused: false,
      };

      const focusedNode: DomSnapshotNode = {
        id: "focused",
        role: "button",
        name: "Focused",
        children: [],
        tagName: "button",
        focused: true,
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [nonFocusedNode, focusedNode],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, sibling: nonFocusedNode, focused: focusedNode },
        totalNodes: 3,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const siblingLine = formatted
        .split("\n")
        .find((l) => l.includes("uid=sibling"));
      expect(siblingLine).toBeTruthy();
      // Non-focused, non-ancestor nodes use space marker (not * or →)
      // Format: [indentation][marker][attributes], so marker is just before 'uid='
      const markerMatch = siblingLine?.match(/^(\s*)(.)(uid=sibling)/);
      expect(markerMatch).toBeTruthy();
      expect(markerMatch?.[2]).toBe(" "); // marker should be space
    });

    it("uses asterisk marker for focused node", () => {
      const focusedNode: DomSnapshotNode = {
        id: "focused",
        role: "button",
        name: "Focused",
        children: [],
        tagName: "button",
        focused: true,
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [focusedNode],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, focused: focusedNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const focusedLine = formatted
        .split("\n")
        .find((l) => l.includes("uid=focused"));
      expect(focusedLine).toBeTruthy();
      expect(focusedLine?.trim().startsWith("*")).toBe(true);
    });

    it("uses arrow marker for ancestors of focused node", () => {
      const focusedChild: DomSnapshotNode = {
        id: "child",
        role: "button",
        name: "Child",
        children: [],
        tagName: "button",
        focused: true,
      };

      const parent: DomSnapshotNode = {
        id: "parent",
        role: "group",
        name: "Parent Group",
        children: [focusedChild],
        tagName: "div",
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [parent],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, parent, child: focusedChild },
        totalNodes: 3,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const rootLine = formatted
        .split("\n")
        .find((l) => l.includes("uid=root"));
      expect(rootLine?.trim().startsWith("→")).toBe(true);
    });
  });

  describe("edge cases and complex structures", () => {
    it("handles nodes with empty children array", () => {
      const emptyNode: DomSnapshotNode = {
        id: "empty",
        role: "button",
        name: "Empty",
        children: [],
        tagName: "button",
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [emptyNode],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, empty: emptyNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=empty");
      expect(snapshot.idToNode.get("empty")?.children).toEqual([]);
    });

    it("handles nodes without name property", () => {
      const noNameNode: DomSnapshotNode = {
        id: "noname",
        role: "button",
        children: [],
        tagName: "button",
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [noNameNode],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, noname: noNameNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=noname");
      expect(formatted).toContain('""');
    });

    it("handles multiple focused nodes", () => {
      const focused1: DomSnapshotNode = {
        id: "f1",
        role: "button",
        name: "First",
        children: [],
        tagName: "button",
        focused: true,
      };

      const focused2: DomSnapshotNode = {
        id: "f2",
        role: "button",
        name: "Second",
        children: [],
        tagName: "button",
        focused: true,
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [focused1, focused2],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, f1: focused1, f2: focused2 },
        totalNodes: 3,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const lines = formatted.split("\n");
      const f1Line = lines.find((l) => l.includes("uid=f1"));
      const f2Line = lines.find((l) => l.includes("uid=f2"));

      expect(f1Line?.trim().startsWith("*")).toBe(true);
      expect(f2Line?.trim().startsWith("*")).toBe(true);
    });

    it("handles deeply nested structures", () => {
      const level3: DomSnapshotNode = {
        id: "l3",
        role: "button",
        name: "Deep Button",
        children: [],
        tagName: "button",
      };

      const level2: DomSnapshotNode = {
        id: "l2",
        role: "group",
        name: "Level 2",
        children: [level3],
        tagName: "div",
      };

      const level1: DomSnapshotNode = {
        id: "l1",
        role: "group",
        name: "Level 1",
        children: [level2],
        tagName: "div",
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [level1],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, l1: level1, l2: level2, l3: level3 },
        totalNodes: 4,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      expect(snapshot.idToNode.size).toBe(4);

      const l3Node = snapshot.idToNode.get("l3");
      expect(l3Node?.role).toBe("button");
      expect(l3Node?.name).toBe("Deep Button");

      const formatted = formatSnapshot(snapshot);
      expect(formatted).toContain("uid=l3");
    });

    it("clones all node properties correctly", () => {
      const fullNode: DomSnapshotNode = {
        id: "full",
        role: "checkbox",
        name: "Accept Terms",
        value: "terms",
        description: "Accept the terms and conditions",
        children: [],
        tagName: "input",
        checked: true,
        pressed: false,
        disabled: false,
        focused: false,
        selected: true,
        expanded: false,
        placeholder: "Check this",
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [fullNode],
        tagName: "body",
      };

      const serialized: SerializedDomSnapshot = {
        root,
        idToNode: { root, full: fullNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };

      const snapshot = buildTextSnapshot(serialized);
      const clonedNode = snapshot.idToNode.get("full");

      expect(clonedNode?.id).toBe("full");
      expect(clonedNode?.role).toBe("checkbox");
      expect(clonedNode?.name).toBe("Accept Terms");
      expect(clonedNode?.value).toBe("terms");
      expect(clonedNode?.description).toBe("Accept the terms and conditions");
      expect(clonedNode?.tagName).toBe("input");
      expect(clonedNode?.checked).toBe(true);
      expect(clonedNode?.pressed).toBe(false);
      expect(clonedNode?.disabled).toBe(false);
      expect(clonedNode?.focused).toBe(false);
      expect(clonedNode?.selected).toBe(true);
      expect(clonedNode?.expanded).toBe(false);
    });
  });
});
