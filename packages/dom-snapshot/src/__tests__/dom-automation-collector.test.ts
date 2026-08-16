import { beforeEach, describe, expect, it } from "vitest";
import { collectDomSnapshot } from "../collector";
import { searchAndFormat } from "../query";
import { setHtml } from "./dom-automation-test-utils";

describe("DOM snapshot collector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("captures interactive elements with stable ids and metadata", () => {
    const { $ } = setHtml(`
      <main>
        <button id="primary-btn">Primary Action</button>
        <input id="work-email" type="email" placeholder="Work email" />
      </main>
    `);

    const snapshot = collectDomSnapshot(document);
    const button = $<HTMLButtonElement>("#primary-btn")!;
    const buttonUid = button.getAttribute("data-eterna-nodeid")!;

    expect(buttonUid).toBeTruthy();
    expect(snapshot.totalNodes).toBeGreaterThan(0);
    expect(snapshot.root).toBeTruthy();
    expect(snapshot.metadata.url).toContain("http");
  });

  it("respects maxTextLength option via metadata", () => {
    const snapshot = collectDomSnapshot(document, { maxTextLength: 50 });

    expect(snapshot.metadata.options.maxTextLength).toBe(50);
  });

  it("passes captureTextNodes option via metadata", () => {
    const snapshotWithText = collectDomSnapshot(document, {
      captureTextNodes: true,
    });

    expect(snapshotWithText.metadata.options.captureTextNodes).toBe(true);
  });

  it("does not let undefined option values override defaults", () => {
    const snapshot = collectDomSnapshot(document, {
      maxTextLength: undefined,
      includeHidden: undefined,
      captureTextNodes: undefined,
    });

    // Default values should be preserved when options have undefined values
    expect(snapshot.metadata.options.maxTextLength).toBe(160);
    expect(snapshot.metadata.options.includeHidden).toBe(false);
    expect(snapshot.metadata.options.captureTextNodes).toBe(true);
  });

  it("applies explicit option values while ignoring undefined ones", () => {
    const snapshot = collectDomSnapshot(document, {
      maxTextLength: 100,
      includeHidden: undefined,
      captureTextNodes: false,
    });

    // Explicit values should be applied
    expect(snapshot.metadata.options.maxTextLength).toBe(100);
    expect(snapshot.metadata.options.captureTextNodes).toBe(false);
    // undefined should fall back to default
    expect(snapshot.metadata.options.includeHidden).toBe(false);
  });

  it("skips text nodes when captureTextNodes is false", () => {
    setHtml(`<div>Some text content</div>`);

    const snapshotWithoutText = collectDomSnapshot(document, {
      captureTextNodes: false,
    });
    const nodesWithoutText = Object.values(snapshotWithoutText.idToNode);
    const staticTextNodes = nodesWithoutText.filter(
      (n) => n.role === "StaticText",
    );

    expect(staticTextNodes.length).toBe(0);
  });

  it("skips script tag content", () => {
    setHtml(`
      <button>Visible button</button>
      <script>const data = {"props": {"secret": "value"}};</script>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("props");
    expect(allText).not.toContain("secret");
  });

  it("skips style tag content", () => {
    setHtml(`
      <button>Visible button</button>
      <style>.hidden { display: none; color: red; }</style>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("display");
    expect(allText).not.toContain("color");
  });

  it("skips noscript tag content", () => {
    setHtml(`
      <button>Visible button</button>
      <noscript>JavaScript is disabled</noscript>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("JavaScript is disabled");
  });

  it("skips template tag content", () => {
    setHtml(`
      <button>Visible button</button>
      <template><div>Template content</div></template>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Template content");
  });

  it("skips aria-hidden elements and their subtree", () => {
    setHtml(`
      <button>Visible button</button>
      <div aria-hidden="true">
        <span>Hidden text</span>
        <button>Hidden button</button>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Hidden text");
    expect(allText).not.toContain("Hidden button");
  });

  it("skips elements with hidden attribute and their subtree", () => {
    setHtml(`
      <button>Visible button</button>
      <div hidden>
        <span>Hidden content</span>
        <a href="#">Hidden link</a>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Hidden content");
    expect(allText).not.toContain("Hidden link");
  });

  it("skips inert elements and their subtree", () => {
    setHtml(`
      <button>Visible button</button>
      <div inert>
        <span>Inert text</span>
        <input placeholder="Inert input" />
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Inert text");
    expect(allText).not.toContain("Inert input");
  });

  it("skips display:none elements and their subtree", () => {
    setHtml(`
      <button>Visible button</button>
      <div style="display: none;">
        <span>Display none text</span>
        <button>Display none button</button>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Display none text");
    expect(allText).not.toContain("Display none button");
  });

  it("skips visibility:hidden elements and their subtree (no visible overrides)", () => {
    setHtml(`
      <button>Visible button</button>
      <div style="visibility: hidden;">
        <span>Visibility hidden text</span>
        <button>Visibility hidden button</button>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).not.toContain("Visibility hidden text");
    expect(allText).not.toContain("Visibility hidden button");
  });

  it("includes visible descendants across repeated visibility overrides", () => {
    const { $ } = setHtml(`
      <div style="visibility: hidden;">
        <div style="visibility: visible;">
          <button id="btn-v1">Visible L1</button>
          <div style="visibility: hidden;">
            <button id="btn-h1">Hidden L2</button>
            <div style="visibility: visible;">
              <button id="btn-v2">Visible L3</button>
              <div style="visibility: hidden;">
                <button id="btn-h2">Hidden L4</button>
                <div style="visibility: visible;">
                  <button id="btn-v3">Visible L5</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible L1");
    expect(allText).toContain("Visible L3");
    expect(allText).toContain("Visible L5");
    expect(allText).not.toContain("Hidden L2");
    expect(allText).not.toContain("Hidden L4");

    expect(
      $<HTMLButtonElement>("#btn-v1")!.getAttribute("data-eterna-nodeid"),
    ).toBeTruthy();
    expect(
      $<HTMLButtonElement>("#btn-v2")!.getAttribute("data-eterna-nodeid"),
    ).toBeTruthy();
    expect(
      $<HTMLButtonElement>("#btn-v3")!.getAttribute("data-eterna-nodeid"),
    ).toBeTruthy();
    expect(
      $<HTMLButtonElement>("#btn-h1")!.getAttribute("data-eterna-nodeid"),
    ).toBeNull();
    expect(
      $<HTMLButtonElement>("#btn-h2")!.getAttribute("data-eterna-nodeid"),
    ).toBeNull();
  });

  it("handles multiple branches with repeated visibility overrides", () => {
    const { $ } = setHtml(`
      <div style="visibility: hidden;">
        <div style="visibility: hidden;">
          <button id="a-hidden">A hidden</button>
        </div>

        <div style="visibility: hidden;">
          <div style="visibility: visible;">
            <button id="b-visible">B visible</button>
            <div style="visibility: hidden;">
              <div style="visibility: visible;">
                <button id="b-visible-deep">B visible deep</button>
              </div>
              <button id="b-hidden-sibling">B hidden sibling</button>
            </div>
          </div>
        </div>

        <div style="visibility: visible;">
          <button id="c-visible">C visible</button>
          <div style="visibility: hidden;">
            <button id="c-hidden">C hidden</button>
          </div>
        </div>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("B visible");
    expect(allText).toContain("B visible deep");
    expect(allText).toContain("C visible");
    expect(allText).not.toContain("A hidden");
    expect(allText).not.toContain("B hidden sibling");
    expect(allText).not.toContain("C hidden");

    expect(
      $<HTMLButtonElement>("#b-visible")!.getAttribute("data-eterna-nodeid"),
    ).toBeTruthy();
    expect(
      $<HTMLButtonElement>("#b-visible-deep")!.getAttribute(
        "data-eterna-nodeid",
      ),
    ).toBeTruthy();
    expect(
      $<HTMLButtonElement>("#c-visible")!.getAttribute("data-eterna-nodeid"),
    ).toBeTruthy();

    expect(
      $<HTMLButtonElement>("#a-hidden")!.getAttribute("data-eterna-nodeid"),
    ).toBeNull();
    expect(
      $<HTMLButtonElement>("#b-hidden-sibling")!.getAttribute(
        "data-eterna-nodeid",
      ),
    ).toBeNull();
    expect(
      $<HTMLButtonElement>("#c-hidden")!.getAttribute("data-eterna-nodeid"),
    ).toBeNull();
  });

  it('includes elements with aria-hidden="false"', () => {
    setHtml(`
      <button>Visible button</button>
      <div aria-hidden="false">
        <span>Not hidden text</span>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Visible button");
    expect(allText).toContain("Not hidden text");
  });

  it("adds StaticText nodes to idToNode flat map", () => {
    setHtml(`<span>Some text content</span>`);

    const snapshot = collectDomSnapshot(document);
    const staticTextNodes = Object.values(snapshot.idToNode).filter(
      (n) => n.role === "StaticText",
    );

    expect(staticTextNodes.length).toBeGreaterThan(0);
    expect(staticTextNodes.some((n) => n.name === "Some text content")).toBe(
      true,
    );
  });

  it("captures text content even when parent element is skipped (generic role)", () => {
    setHtml(`
      <div>
        <span>Text inside span</span>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    // span is generic role and gets skipped, but its text content should be captured
    expect(allText).toContain("Text inside span");
  });

  it("captures span element with aria-label", () => {
    setHtml(`
      <div>
        <span aria-label="Important label">Some text</span>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // span with aria-label should be included as a node
    const spanNode = nodes.find(
      (n) => n.tagName === "span" && n.name === "Important label",
    );
    expect(spanNode).toBeTruthy();
    expect(spanNode?.name).toBe("Important label");
  });

  it("captures span element with explicit role and aria-label", () => {
    setHtml(`
      <div>
        <span role="status" aria-label="Loading status">Loading...</span>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // span with explicit role should be included
    const spanNode = nodes.find((n) => n.role === "status");
    expect(spanNode).toBeTruthy();
    expect(spanNode?.name).toBe("Loading status");
  });

  it("captures element with aria-labelledby", () => {
    setHtml(`
      <div>
        <span id="label-text">Description Label</span>
        <div aria-labelledby="label-text">Content here</div>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // div with aria-labelledby should be included (find by tagName + name)
    const labelledDiv = nodes.find(
      (n) => n.tagName === "div" && n.name === "Description Label",
    );
    expect(labelledDiv).toBeTruthy();
    expect(labelledDiv?.name).toBe("Description Label");
  });

  it("captures span with aria-label inside nested structure (real-world icon button)", () => {
    setHtml(`
      <div class="ant-space-item">
        <span aria-describedby="rh">
          <span class="anticon zcp-icon" aria-label="Show Deploy Detail" data-testid="action-detail" style="font-size: 16px;">
            <svg class="icon" viewBox="0 0 1024 1024" width="200" height="200">
              <path d="M833.013155 249.550056L468.049052"></path>
            </svg>
          </span>
        </span>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // The span with aria-label="Show Deploy Detail" should be captured
    const iconSpan = nodes.find((n) => n.name === "Show Deploy Detail");
    expect(iconSpan).toBeTruthy();
    expect(iconSpan?.tagName).toBe("span");
    expect(iconSpan?.name).toBe("Show Deploy Detail");

    // Search should find it
    const searchResult = searchAndFormat(snapshot, "Show Deploy Detail");
    expect(searchResult).not.toBeNull();
    expect(searchResult).toContain("Show Deploy Detail");
    expect(searchResult).not.toContain("No matches found");
  });

  it("captures nested text content through multiple skipped generic elements", () => {
    setHtml(`
      <div>
        <div>
          <span>
            <span>Deeply nested text</span>
          </span>
        </div>
      </div>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const allText = nodes.map((n) => n.textContent || n.name || "").join(" ");

    expect(allText).toContain("Deeply nested text");
  });

  it("StaticText nodes have correct id format", () => {
    setHtml(`<p>Test paragraph</p>`);

    const snapshot = collectDomSnapshot(document);
    const staticTextNodes = Object.values(snapshot.idToNode).filter(
      (n) => n.role === "StaticText",
    );

    expect(staticTextNodes.length).toBeGreaterThan(0);
    // StaticText ids should follow pattern: parentId::text-index
    expect(staticTextNodes?.[0]?.id).toMatch(/::text-\d+$/);
  });

  it("returns snapshot with root node", () => {
    const snapshot = collectDomSnapshot(document);

    expect(snapshot.root).toBeTruthy();
    expect(snapshot.root.role).toBe("RootWebArea");
    expect(snapshot.root.children).toBeDefined();
  });

  it("includes timestamp and metadata", () => {
    const snapshot = collectDomSnapshot(document);

    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.metadata.collectedAt).toBeTruthy();
    expect(snapshot.metadata.url).toBeTruthy();
  });

  it("assigns stable node IDs via data attribute", () => {
    const { $ } = setHtml(`<button>Test</button>`);

    collectDomSnapshot(document);
    const nodeId = $("button")!.getAttribute("data-eterna-nodeid");

    expect(nodeId).toBeTruthy();
    expect(nodeId).toMatch(/^dom_/);
  });

  it("reuses existing node IDs", () => {
    const { $ } = setHtml(
      `<button data-eterna-nodeid="existing_id">Test Button</button>`,
    );

    collectDomSnapshot(document);

    // The node ID should remain unchanged
    expect($("button")!.getAttribute("data-eterna-nodeid")).toBe("existing_id");
  });

  it("generates stable IDs across multiple snapshot calls", () => {
    const { $$ } = setHtml(`
      <button>Click Me Button</button>
      <button>Submit Form</button>
      <button>Cancel Action</button>
    `);

    const buttons = $$<HTMLButtonElement>("button");

    // First snapshot call - generates IDs
    collectDomSnapshot(document);
    const id1_first = buttons?.[0]?.getAttribute("data-eterna-nodeid");
    const id2_first = buttons?.[1]?.getAttribute("data-eterna-nodeid");
    const id3_first = buttons?.[2]?.getAttribute("data-eterna-nodeid");

    expect(id1_first).toBeTruthy();
    expect(id2_first).toBeTruthy();
    expect(id3_first).toBeTruthy();

    // Second snapshot call - should reuse same IDs
    collectDomSnapshot(document);
    expect(buttons?.[0]?.getAttribute("data-eterna-nodeid")).toBe(id1_first);
    expect(buttons?.[1]?.getAttribute("data-eterna-nodeid")).toBe(id2_first);
    expect(buttons?.[2]?.getAttribute("data-eterna-nodeid")).toBe(id3_first);

    // Third snapshot call - IDs still stable
    collectDomSnapshot(document);
    expect(buttons?.[0]?.getAttribute("data-eterna-nodeid")).toBe(id1_first);
    expect(buttons?.[1]?.getAttribute("data-eterna-nodeid")).toBe(id2_first);
    expect(buttons?.[2]?.getAttribute("data-eterna-nodeid")).toBe(id3_first);

    // Fourth snapshot call with different options - IDs still stable
    collectDomSnapshot(document, { maxTextLength: 100 });
    expect(buttons?.[0]?.getAttribute("data-eterna-nodeid")).toBe(id1_first);
    expect(buttons?.[1]?.getAttribute("data-eterna-nodeid")).toBe(id2_first);
    expect(buttons?.[2]?.getAttribute("data-eterna-nodeid")).toBe(id3_first);
  });

  it("generates unique IDs for different elements", () => {
    const { $$ } = setHtml(`
      <button>Button 1</button>
      <button>Button 2</button>
      <button>Button 3</button>
    `);

    collectDomSnapshot(document);

    const buttons = $$("button");
    const id1 = buttons?.[0]?.getAttribute("data-eterna-nodeid");
    const id2 = buttons?.[1]?.getAttribute("data-eterna-nodeid");
    const id3 = buttons?.[2]?.getAttribute("data-eterna-nodeid");

    // All IDs should be unique
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it("captures select element selected options", () => {
    setHtml(`
      <select>
        <option value="1">First</option>
        <option value="2" selected>Second</option>
      </select>
    `);

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);
    const selectNode = nodes.find((n) => n.tagName === "select");

    // value should be the HTML value attribute (for form submission)
    expect(selectNode?.value).toBe("2");
    // name should be the display text (what user sees)
    expect(selectNode?.name).toBe("Second");
  });

  it("collects nodes from page with interactive elements", () => {
    setHtml(`
      <form>
        <input type="text" placeholder="Name" />
        <button>Submit</button>
      </form>
    `);

    const snapshot = collectDomSnapshot(document);

    // At minimum we have the root node
    expect(snapshot.totalNodes).toBeGreaterThanOrEqual(1);
    expect(Object.keys(snapshot.idToNode).length).toBeGreaterThan(0);
    expect(snapshot.root).toBeTruthy();
  });
});
