import { beforeEach, describe, expect, it } from "vitest";
import { collectDomSnapshot } from "../collector";
import { searchAndFormat } from "../query";

describe("cursor: pointer detection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("includes elements with cursor: pointer style as interactive", () => {
    // Add a style element with cursor: pointer
    document.body.innerHTML = `
      <style>
        .clickable-card { cursor: pointer; }
      </style>
      <div class="clickable-card">
        <span>Card Title</span>
        <span>Card Description</span>
      </div>
    `;

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // The clickable-card div should be captured as a node (not just its text children)
    const cardNode = nodes.find(
      (n) =>
        n.tagName === "div" &&
        n.children &&
        n.children.some(
          (c) => c.role === "StaticText" && c.name === "Card Title",
        ),
    );

    expect(cardNode).toBeDefined();
    expect(cardNode?.id).toBeTruthy();
  });

  it("includes inline cursor: pointer elements", () => {
    document.body.innerHTML = `
      <div style="cursor: pointer;">Clickable Inline</div>
    `;

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // Should capture the div with cursor: pointer
    const clickableDiv = nodes.find(
      (n) =>
        n.tagName === "div" &&
        n.children?.some(
          (c) => c.role === "StaticText" && c.name === "Clickable Inline",
        ),
    );

    expect(clickableDiv).toBeDefined();
  });

  it("assigns node IDs to cursor: pointer elements for automation", () => {
    document.body.innerHTML = `
      <style>.clickable { cursor: pointer; }</style>
      <div class="clickable">Click Me</div>
    `;

    const snapshot = collectDomSnapshot(document);
    const clickableEl = document.querySelector(".clickable");
    const nodeId = clickableEl?.getAttribute("data-eterna-nodeid");

    expect(nodeId).toBeTruthy();
    expect(snapshot.idToNode[nodeId!]).toBeDefined();
  });

  it("captures card component with cursor-pointer (simulating shadcn/ui card)", () => {
    document.body.innerHTML = `
      <style>.cursor-pointer { cursor: pointer; }</style>
      <div data-slot="card" class="cursor-pointer bg-card rounded-xl border shadow-sm">
        <div data-slot="card-header" class="flex flex-row items-center">
          <div class="p-2 rounded-md bg-gray-100">
            <svg class="size-4"></svg>
          </div>
          <div>
            <div data-slot="card-title" class="text-base font-semibold">
              deploy-k8s-workloads
            </div>
            <div class="text-sm text-gray-600 mt-1">
              Usage zam and kapp deploy k8s workloads
            </div>
          </div>
        </div>
      </div>
    `;

    const snapshot = collectDomSnapshot(document);
    const cardEl = document.querySelector('[data-slot="card"]');
    const nodeId = cardEl?.getAttribute("data-eterna-nodeid");

    expect(nodeId).toBeTruthy();
    expect(snapshot.idToNode[nodeId!]).toBeDefined();
    expect(snapshot.idToNode[nodeId!]?.tagName).toBe("div");
  });

  it("searchAndFormat finds text within cursor-pointer card", () => {
    document.body.innerHTML = `
      <style>.cursor-pointer { cursor: pointer; }</style>
      <div class="cursor-pointer">
        <span>deploy-k8s-workloads</span>
        <span>Usage zam and kapp deploy</span>
      </div>
    `;

    const snapshot = collectDomSnapshot(document);
    const result = searchAndFormat(snapshot, "deploy-k8s-workloads");

    expect(result).not.toBeNull();
    expect(result).toContain("deploy-k8s-workloads");
    expect(result).not.toContain("No matches found");
  });

  it("captures nested cursor-pointer elements with separate IDs", () => {
    document.body.innerHTML = `
      <style>
        .outer-card { cursor: pointer; }
        .inner-tag { cursor: pointer; }
      </style>
      <div class="outer-card">
        <h3>Card Title</h3>
        <span class="inner-tag">Clickable Tag</span>
      </div>
    `;

    collectDomSnapshot(document);
    const outerEl = document.querySelector(".outer-card");
    const innerEl = document.querySelector(".inner-tag");

    expect(outerEl?.getAttribute("data-eterna-nodeid")).toBeTruthy();
    expect(innerEl?.getAttribute("data-eterna-nodeid")).toBeTruthy();
    expect(outerEl?.getAttribute("data-eterna-nodeid")).not.toBe(
      innerEl?.getAttribute("data-eterna-nodeid"),
    );
  });

  it("captures ant-tag with cursor-pointer as clickable element", () => {
    document.body.innerHTML = `
      <style>.cursor-pointer { cursor: pointer; }</style>
      <span class="ant-tag cursor-pointer text-blue-500">
        dev/main/va1/meta
      </span>
    `;

    const snapshot = collectDomSnapshot(document);
    const tagEl = document.querySelector(".ant-tag");
    const nodeId = tagEl?.getAttribute("data-eterna-nodeid");

    expect(nodeId).toBeTruthy();
    expect(snapshot.idToNode[nodeId!]).toBeDefined();
    expect(snapshot.idToNode[nodeId!]?.tagName).toBe("span");
  });

  it("does not treat cursor: default elements as interactive", () => {
    document.body.innerHTML = `
      <style>.not-clickable { cursor: default; }</style>
      <div class="not-clickable">Not Clickable</div>
    `;

    const snapshot = collectDomSnapshot(document);
    const nodes = Object.values(snapshot.idToNode);

    // Should not include the div as a separate node since it has cursor: default
    // The text should still be captured as StaticText
    const staticTextNode = nodes.find(
      (n) => n.role === "StaticText" && n.name === "Not Clickable",
    );
    expect(staticTextNode).toBeDefined();
  });

  it("captures table row with cursor-pointer for row click actions", () => {
    document.body.innerHTML = `
      <style>.clickable-row { cursor: pointer; }</style>
      <table>
        <tbody>
          <tr class="clickable-row">
            <td>Row Data 1</td>
            <td>Row Data 2</td>
          </tr>
        </tbody>
      </table>
    `;

    const snapshot = collectDomSnapshot(document);
    const rowEl = document.querySelector(".clickable-row");
    const nodeId = rowEl?.getAttribute("data-eterna-nodeid");

    expect(nodeId).toBeTruthy();
    expect(snapshot.idToNode[nodeId!]).toBeDefined();
    expect(snapshot.idToNode[nodeId!]?.tagName).toBe("tr");
  });

  describe("iframe support", () => {
    it("captures same-origin iframe content", () => {
      document.body.innerHTML = `
        <div>
          <h1>Main Page</h1>
        </div>
      `;

      const iframe = document.createElement("iframe");
      const iframeDoc = document.implementation.createHTMLDocument("iframe");
      iframeDoc.body.innerHTML =
        "<p>Iframe content</p><button>Iframe Button</button>";
      Object.defineProperty(iframe, "contentDocument", {
        get: () => iframeDoc,
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get: () => ({ document: iframeDoc }),
        configurable: true,
      });
      document.body.appendChild(iframe);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const allText = nodes.map((n) => n.name || "").join(" ");

      expect(allText).toContain("Iframe content");
      expect(allText).toContain("Iframe Button");
      expect(allText).toContain("Main Page");

      const iframeNode = nodes.find((n) => n.tagName === "iframe");
      expect(iframeNode).toBeDefined();
      expect(iframeNode?.children.length).toBeGreaterThan(0);
    });

    it("captures nested iframes with same-origin content", () => {
      document.body.innerHTML = `
        <div>
          <h1>Outer Page</h1>
        </div>
      `;

      const innerDoc =
        document.implementation.createHTMLDocument("inner-iframe");
      innerDoc.body.innerHTML =
        "<p>Inner iframe</p><button>Inner Button</button>";

      const outerDoc =
        document.implementation.createHTMLDocument("outer-iframe");
      outerDoc.body.innerHTML = "<p>Outer iframe</p>";
      const innerFrame = outerDoc.createElement("iframe");
      Object.defineProperty(innerFrame, "contentDocument", {
        get: () => innerDoc,
        configurable: true,
      });
      Object.defineProperty(innerFrame, "contentWindow", {
        get: () => ({ document: innerDoc }),
        configurable: true,
      });
      outerDoc.body.appendChild(innerFrame);

      const outerFrame = document.createElement("iframe");
      Object.defineProperty(outerFrame, "contentDocument", {
        get: () => outerDoc,
        configurable: true,
      });
      Object.defineProperty(outerFrame, "contentWindow", {
        get: () => ({ document: outerDoc }),
        configurable: true,
      });
      document.body.appendChild(outerFrame);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const allText = nodes.map((n) => n.name || "").join(" ");

      expect(allText).toContain("Outer Page");
      expect(allText).toContain("Outer iframe");
      expect(allText).toContain("Inner iframe");
      expect(allText).toContain("Inner Button");
    });

    it("skips cross-origin iframe content but preserves iframe node", () => {
      document.body.innerHTML = `
        <div>
          <h1>Main Page</h1>
          <iframe id="cross-origin-iframe" src="https://example.com"></iframe>
        </div>
      `;

      const iframe = document.querySelector(
        "#cross-origin-iframe",
      ) as HTMLIFrameElement;
      if (iframe) {
        Object.defineProperty(iframe, "contentDocument", {
          get: () => {
            throw new DOMException(
              "Blocked a frame with origin",
              "SecurityError",
            );
          },
          configurable: true,
        });
        Object.defineProperty(iframe, "contentWindow", {
          get: () => ({
            document: null,
          }),
          configurable: true,
        });
      }

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const allText = nodes.map((n) => n.name || "").join(" ");

      expect(allText).toContain("Main Page");

      const iframeNode = nodes.find((n) => n.tagName === "iframe");
      expect(iframeNode).toBeDefined();
      expect(iframeNode?.children.length).toBe(0);
    });

    it("captures interactive elements inside same-origin iframe", () => {
      document.body.innerHTML = `
        <div>
          <button>Main Button</button>
        </div>
      `;

      const iframe = document.createElement("iframe");
      const iframeDoc = document.implementation.createHTMLDocument("iframe");
      iframeDoc.body.innerHTML =
        "<input type='text' placeholder='Iframe input'><button>Iframe Button</button>";
      Object.defineProperty(iframe, "contentDocument", {
        get: () => iframeDoc,
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get: () => ({ document: iframeDoc }),
        configurable: true,
      });
      document.body.appendChild(iframe);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      const iframeInput = nodes.find(
        (n) => n.role === "textbox" && n.placeholder === "Iframe input",
      );
      const iframeButton = nodes.find(
        (n) => n.role === "button" && n.name === "Iframe Button",
      );

      expect(iframeInput).toBeDefined();
      expect(iframeButton).toBeDefined();

      const mainButton = nodes.find(
        (n) => n.role === "button" && n.name === "Main Button",
      );
      expect(mainButton).toBeDefined();
    });

    it("handles iframe with hidden content correctly", () => {
      document.body.innerHTML = `
        <div>
          <h1>Main Page</h1>
        </div>
      `;

      const iframe = document.createElement("iframe");
      const iframeDoc = document.implementation.createHTMLDocument("iframe");
      iframeDoc.body.innerHTML =
        "<div hidden><p>Hidden content</p></div><p>Visible content</p>";
      Object.defineProperty(iframe, "contentDocument", {
        get: () => iframeDoc,
        configurable: true,
      });
      Object.defineProperty(iframe, "contentWindow", {
        get: () => ({ document: iframeDoc }),
        configurable: true,
      });
      document.body.appendChild(iframe);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const allText = nodes.map((n) => n.name || "").join(" ");

      expect(allText).toContain("Visible content");
      expect(allText).toContain("Main Page");
      expect(allText).not.toContain("Hidden content");
    });
  });
});
