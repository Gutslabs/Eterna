import { beforeEach, describe, expect, it } from "vitest";
import { collectDomSnapshot } from "../collector";
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

  const buildMockSerializedSnapshot = (): SerializedDomSnapshot => {
    const child: DomSnapshotNode = {
      id: "btn",
      role: "button",
      name: "Save",
      children: [],
      tagName: "button",
      focused: true,
    };

    const placeholderChild: DomSnapshotNode = {
      id: "input1",
      role: "textbox",
      name: "",
      children: [],
      tagName: "input",
      placeholder: "Enter value",
    };

    const root: DomSnapshotNode = {
      id: "root",
      role: "RootWebArea",
      name: "Mock Page",
      children: [child, placeholderChild],
      tagName: "body",
    };

    return {
      root,
      idToNode: {
        root,
        btn: child,
        input1: placeholderChild,
      },
      totalNodes: 3,
      timestamp: Date.now(),
      metadata: {
        title: "mock",
        url: "https://example.test",
        collectedAt: new Date().toISOString(),
        options: {},
      },
    };
  };

  it("reconstructs TextSnapshot objects and formats output", () => {
    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);

    expect(textSnapshot.idToNode.size).toBeGreaterThan(1);

    const formatted = formatSnapshot(textSnapshot);
    expect(formatted).toContain("uid=");
    const roles = Array.from(textSnapshot.idToNode.values()).map(
      (node) => node.role,
    );
    expect(roles).toContain("RootWebArea");
  });

  it("show button in formatted result", () => {
    setHtml(`<button>
                <div>Some text content</div>
             </button>`);

    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);

    const formatted = formatSnapshot(textSnapshot);
    expect(formatted).toContain("button");
  });

  it("show select in formatted result", () => {
    setHtml(`<select>
      <option value="1">First</option>
      <option selected value="2">Second</option>
    </select>`);

    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(textSnapshot);

    expect(formatted).toContain("select");
    // value should be the HTML value attribute, not the display text
    expect(formatted).toContain('<select> value="2"');
  });

  it("show radio in formatted result with value and checked state", () => {
    setHtml(`
      <fieldset>
        <legend>Choose your favorite color</legend>
        <input type="radio" name="color" value="red" id="red">
        <label for="red">Red</label>
        <input type="radio" name="color" value="blue" id="blue" checked>
        <label for="blue">Blue</label>
        <input type="radio" name="color" value="green" id="green">
        <label for="green">Green</label>
      </fieldset>
    `);

    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(textSnapshot);

    // Should contain radio role
    expect(formatted).toContain("radio");
    // value should be the HTML value attribute
    expect(formatted).toContain('value="red"');
    expect(formatted).toContain('value="blue"');
    expect(formatted).toContain('value="green"');
    // checked state should be captured for the selected radio
    expect(formatted).toContain('checked="true"');
  });

  it("show checkbox in formatted result with value and checked state", () => {
    setHtml(`
      <div>
        <input type="checkbox" name="agree" value="yes" id="agree" checked>
        <label for="agree">I agree to terms</label>
      </div>
    `);

    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(textSnapshot);

    expect(formatted).toContain("checkbox");
    // value should be the HTML value attribute
    expect(formatted).toContain('value="yes"');
    expect(formatted).toContain('checked="true"');
  });

  it("ignore div with no role in formatted result", () => {
    const { $ } = setHtml(`
      <button>
        <div class='ignore'></div>
        <div>Some text content</div>
      </button>`);
    const ignore = $<HTMLDivElement>("div.ignore")!;
    expect(ignore).toBeTruthy();
    expect(ignore.getAttribute("data-eterna-nodeid")).toBeFalsy();
    const serialized = collectDomSnapshot(document);
    const textSnapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(textSnapshot);
    // body -> button -> static text
    expect(formatted.split(`\n`).filter((line) => line.trim()).length).toBe(3);
  });

  it("buildTextSnapshot converts placeholder to description when missing", () => {
    const serialized = buildMockSerializedSnapshot();
    const textSnapshot = buildTextSnapshot(serialized);

    const inputNode = textSnapshot.idToNode.get("input1");
    expect(inputNode?.description).toBe("Enter value");
    expect(inputNode?.tagName).toBe("input");
  });

  it("formatSnapshot marks focused nodes and ancestors", () => {
    const serialized = buildMockSerializedSnapshot();
    const textSnapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(textSnapshot);

    const focusedLine = formatted
      .split("\n")
      .find((line) => line.trim().startsWith("*uid=btn"));
    const ancestorLine = formatted
      .split("\n")
      .find((line) => line.trim().startsWith("→uid=root"));

    expect(focusedLine).toBeTruthy();
    expect(ancestorLine).toBeTruthy();
    expect(focusedLine).toContain("button");
  });

  it("formatSnapshot outputs node attributes such as value and checked state", () => {
    const serialized = buildMockSerializedSnapshot();
    (serialized.idToNode["btn"] as DomSnapshotNode).value = "Click me";
    (serialized.idToNode["btn"] as DomSnapshotNode).checked = true;
    const snapshot = buildTextSnapshot(serialized);
    const formatted = formatSnapshot(snapshot);

    expect(formatted).toContain('value="Click me"');
    expect(formatted).toContain("checked");
  });

  it("buildTextSnapshot populates idToNode Map with all nodes", () => {
    const grandchild: DomSnapshotNode = {
      id: "grandchild",
      role: "StaticText",
      name: "Nested text",
      children: [],
    };

    const child: DomSnapshotNode = {
      id: "child",
      role: "button",
      name: "Click",
      children: [grandchild],
      tagName: "button",
    };

    const root: DomSnapshotNode = {
      id: "root",
      role: "RootWebArea",
      name: "Test",
      children: [child],
      tagName: "body",
    };

    const serialized: SerializedDomSnapshot = {
      root,
      idToNode: { root, child, grandchild },
      totalNodes: 3,
      timestamp: Date.now(),
      metadata: {
        title: "test",
        url: "https://test.com",
        collectedAt: new Date().toISOString(),
        options: {},
      },
    };

    const textSnapshot = buildTextSnapshot(serialized);

    expect(textSnapshot.idToNode.size).toBe(3);
    expect(textSnapshot.idToNode.has("root")).toBe(true);
    expect(textSnapshot.idToNode.has("child")).toBe(true);
    expect(textSnapshot.idToNode.has("grandchild")).toBe(true);

    const childNode = textSnapshot.idToNode.get("child");
    expect(childNode?.children.length).toBe(1);
    expect(childNode?.children?.[0]?.id).toBe("grandchild");
  });

  describe("shouldIncludeInOutput filtering", () => {
    const createSnapshotWithNode = (
      nodeProps: Partial<DomSnapshotNode>,
    ): SerializedDomSnapshot => {
      const testNode: DomSnapshotNode = {
        id: "test-node",
        role: "generic",
        name: "",
        children: [],
        ...nodeProps,
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [testNode],
        tagName: "body",
      };

      return {
        root,
        idToNode: { root, "test-node": testNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };
    };

    it("includes RootWebArea with full attributes", () => {
      const serialized = createSnapshotWithNode({ role: "generic", name: "" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=root");
      expect(formatted).toContain("RootWebArea");
    });

    it.each([
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
      "switch",
    ])('includes interactive role "%s" with full attributes', (role) => {
      const serialized = createSnapshotWithNode({ role, name: "Action" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=test-node");
      expect(formatted).toContain(role);
    });

    it("includes image role with full attributes", () => {
      const serialized = createSnapshotWithNode({
        role: "image",
        name: "Logo",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=test-node");
      expect(formatted).toContain("image");
    });

    it("includes img role with full attributes", () => {
      const serialized = createSnapshotWithNode({
        role: "img",
        name: "Picture",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=test-node");
      expect(formatted).toContain("img");
    });

    it("includes StaticText with name of 2+ chars with full attributes", () => {
      const serialized = createSnapshotWithNode({
        role: "StaticText",
        name: "Hi",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      // StaticText nodes don't have uid - they can't be operated on directly
      expect(formatted).not.toContain("uid=test-node");
      expect(formatted).toContain("StaticText");
      expect(formatted).toContain('"Hi"');
    });

    it("excludes StaticText with name less than 2 chars from full output", () => {
      const serialized = createSnapshotWithNode({
        role: "StaticText",
        name: "X",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const lines = formatted
        .split("\n")
        .filter((l) => l.includes("test-node"));
      expect(lines.length).toBe(0);
    });

    it("includes nodes with name longer than 1 char with full attributes", () => {
      const serialized = createSnapshotWithNode({
        role: "heading",
        name: "Welcome",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("uid=test-node");
      expect(formatted).toContain("heading");
    });

    it("excludes generic role with empty name from full output", () => {
      const serialized = createSnapshotWithNode({ role: "generic", name: "" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      const testNodeLines = formatted
        .split("\n")
        .filter((l) => l.includes("uid=test-node"));
      expect(testNodeLines.length).toBe(0);
    });
  });

  describe("getNodeAttributes complete coverage", () => {
    const createNodeWithAttributes = (
      attrs: Partial<DomSnapshotNode>,
    ): SerializedDomSnapshot => {
      const testNode: DomSnapshotNode = {
        id: "attr-node",
        role: "button",
        name: "Test Button",
        children: [],
        tagName: "button",
        ...attrs,
      };

      const root: DomSnapshotNode = {
        id: "root",
        role: "RootWebArea",
        name: "Test",
        children: [testNode],
        tagName: "body",
      };

      return {
        root,
        idToNode: { root, "attr-node": testNode },
        totalNodes: 2,
        timestamp: Date.now(),
        metadata: {
          title: "test",
          url: "https://test.com",
          collectedAt: new Date().toISOString(),
          options: {},
        },
      };
    };

    it("outputs disabled attribute when node is disabled", () => {
      const serialized = createNodeWithAttributes({ disabled: true });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("disabled");
    });

    it("outputs selected attribute when node is selected", () => {
      const serialized = createNodeWithAttributes({ selected: true });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("selected");
    });

    it("outputs expanded attribute when node is expanded", () => {
      const serialized = createNodeWithAttributes({ expanded: true });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("expanded");
    });

    it("outputs tagName in angle brackets", () => {
      const serialized = createNodeWithAttributes({ tagName: "div" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain("<div>");
    });

    it('outputs checked="mixed" for indeterminate checkbox', () => {
      const serialized = createNodeWithAttributes({ checked: "mixed" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('checked="mixed"');
    });

    it('outputs checked="false" for unchecked checkbox', () => {
      const serialized = createNodeWithAttributes({ checked: false });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('checked="false"');
    });

    it("outputs pressed attribute when node is pressed", () => {
      const serialized = createNodeWithAttributes({ pressed: true });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('pressed="true"');
    });

    it('outputs pressed="mixed" for mixed pressed state', () => {
      const serialized = createNodeWithAttributes({ pressed: "mixed" });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('pressed="mixed"');
    });

    it('outputs pressed="false" for unpressed toggle', () => {
      const serialized = createNodeWithAttributes({ pressed: false });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('pressed="false"');
    });

    it("outputs description attribute when present", () => {
      const serialized = createNodeWithAttributes({
        description: "Helper text",
      });
      const snapshot = buildTextSnapshot(serialized);
      const formatted = formatSnapshot(snapshot);

      expect(formatted).toContain('desc="Helper text"');
    });
  });
});
