import { beforeEach, describe, expect, it } from "vitest";
import { collectDomSnapshot } from "../collector";
import { buildTextSnapshot, formatSnapshot } from "../manager";
import { searchAndFormat } from "../query";
import { setHtml } from "./dom-automation-test-utils";

describe("DOM snapshot collector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("textContent capture for interactive vs non-interactive elements", () => {
    it("captures textContent for interactive elements when different from name", () => {
      // Button with aria-label has name from aria-label, but textContent from inner text
      setHtml(`
        <button aria-label="Action">
          <span>Click</span>
          <span>Me</span>
        </button>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const buttonNode = nodes.find((n) => n.tagName === "button");

      // Button is interactive and textContent differs from name (aria-label)
      expect(buttonNode?.name).toBe("Action");
      expect(buttonNode?.textContent).toBe("Click Me");
    });

    it("does NOT duplicate textContent when same as name for interactive elements", () => {
      // Simple button where textContent equals name
      setHtml(`<button>Click Me</button>`);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const buttonNode = nodes.find((n) => n.tagName === "button");

      // name and textContent would be the same, so textContent is not stored
      expect(buttonNode?.name).toBe("Click Me");
      expect(buttonNode?.textContent).toBeUndefined();
    });

    it("does NOT capture textContent for non-interactive container elements (section)", () => {
      setHtml(`
        <section>
          <h1>Title</h1>
          <p>Some paragraph text</p>
          <button>Click</button>
        </section>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const sectionNode = nodes.find((n) => n.tagName === "section");

      // Section is NOT interactive, so textContent should be undefined
      expect(sectionNode?.textContent).toBeUndefined();
    });

    it("does NOT capture textContent for non-interactive container elements (div)", () => {
      setHtml(`
        <div>
          <span>Text 1</span>
          <span>Text 2</span>
          <span>Text 3</span>
        </div>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const divNode = nodes.find((n) => n.tagName === "div");

      // Div is NOT interactive, so textContent should be undefined
      expect(divNode?.textContent).toBeUndefined();
    });

    it("does NOT capture textContent for main, nav, article elements", () => {
      setHtml(`
        <main>
          <nav>Navigation links</nav>
          <article>Article content</article>
        </main>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      const mainNode = nodes.find((n) => n.tagName === "main");
      const navNode = nodes.find((n) => n.tagName === "nav");
      const articleNode = nodes.find((n) => n.tagName === "article");

      expect(mainNode?.textContent).toBeUndefined();
      expect(navNode?.textContent).toBeUndefined();
      expect(articleNode?.textContent).toBeUndefined();
    });

    it("captures textContent for elements with interactive role when different from name", () => {
      setHtml(
        `<div role="button" aria-label="Action">Custom Button Text</div>`,
      );

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const customButton = nodes.find((n) => n.role === "button");

      // Element has interactive role, textContent differs from name (aria-label)
      expect(customButton?.name).toBe("Action");
      expect(customButton?.textContent).toBe("Custom Button Text");
    });

    it("text content is still captured via StaticText nodes for non-interactive containers", () => {
      setHtml(`
        <section>
          <p>Important text here</p>
        </section>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      // Section should NOT have textContent
      const sectionNode = nodes.find((n) => n.tagName === "section");
      expect(sectionNode?.textContent).toBeUndefined();

      // But StaticText nodes should capture the text
      const staticTextNodes = nodes.filter((n) => n.role === "StaticText");
      const textContent = staticTextNodes.map((n) => n.name).join(" ");
      expect(textContent).toContain("Important text here");
    });

    it("interactive elements can have textContent, container divs cannot", () => {
      setHtml(`
        <div>
          <button aria-label="Btn1">Button 1 Text</button>
          <a href="#" aria-label="Lnk1">Link 1 Text</a>
        </div>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      const buttonNode = nodes.find((n) => n.tagName === "button");
      const linkNode = nodes.find((n) => n.tagName === "a");
      const divNode = nodes.find((n) => n.tagName === "div");

      // Interactive elements have textContent when it differs from name
      expect(buttonNode?.name).toBe("Btn1");
      expect(buttonNode?.textContent).toBe("Button 1 Text");
      expect(linkNode?.name).toBe("Lnk1");
      expect(linkNode?.textContent).toBe("Link 1 Text");

      // Container div does NOT have textContent
      expect(divNode?.textContent).toBeUndefined();
    });

    it("label element (interactive tag) can have textContent", () => {
      setHtml(`
        <label aria-label="Terms">
          <input type="checkbox" />
          Accept terms and conditions
        </label>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const labelNode = nodes.find((n) => n.tagName === "label");

      // Label is in INTERACTIVE_TAGS, textContent differs from aria-label
      expect(labelNode?.name).toBe("Terms");
      expect(labelNode?.textContent).toBe("Accept terms and conditions");
    });

    it("excludes script content from textContent extraction", () => {
      setHtml(`
        <button aria-label="Action">
          Click Me
          <script>const secret = "hidden";</script>
        </button>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const buttonNode = nodes.find((n) => n.tagName === "button");

      // textContent should NOT include script content
      expect(buttonNode?.textContent).toBe("Click Me");
      expect(buttonNode?.textContent).not.toContain("secret");
      expect(buttonNode?.textContent).not.toContain("hidden");
    });

    it("excludes style content from textContent extraction", () => {
      setHtml(`
        <button aria-label="Action">
          Click Me
          <style>.btn { color: red; }</style>
        </button>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const buttonNode = nodes.find((n) => n.tagName === "button");

      // textContent should NOT include style content
      expect(buttonNode?.textContent).toBe("Click Me");
      expect(buttonNode?.textContent).not.toContain("color");
      expect(buttonNode?.textContent).not.toContain("red");
    });

    it("excludes noscript and template content from textContent extraction", () => {
      setHtml(`
        <button aria-label="Action">
          Visible Text
          <noscript>No JS fallback</noscript>
          <template><div>Template content</div></template>
        </button>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);
      const buttonNode = nodes.find((n) => n.tagName === "button");

      expect(buttonNode?.textContent).toBe("Visible Text");
      expect(buttonNode?.textContent).not.toContain("fallback");
      expect(buttonNode?.textContent).not.toContain("Template");
    });
  });

  describe("StaticText nodes capture all visible text in non-interactive containers", () => {
    it("captures all text in section via StaticText nodes", () => {
      setHtml(`
        <section>
          <h1>Main Title</h1>
          <p>First paragraph content.</p>
          <p>Second paragraph content.</p>
          <span>Some span text</span>
        </section>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      // Section should NOT have textContent
      const sectionNode = nodes.find((n) => n.tagName === "section");
      expect(sectionNode?.textContent).toBeUndefined();

      // All text should be captured via StaticText nodes
      const staticTextNodes = nodes.filter((n) => n.role === "StaticText");
      const allStaticText = staticTextNodes.map((n) => n.name).join(" ");

      expect(allStaticText).toContain("Main Title");
      expect(allStaticText).toContain("First paragraph content.");
      expect(allStaticText).toContain("Second paragraph content.");
      expect(allStaticText).toContain("Some span text");
    });

    it("captures deeply nested text via StaticText nodes", () => {
      setHtml(`
        <div>
          <div>
            <div>
              <span>Deeply nested text</span>
            </div>
          </div>
        </div>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      // No div should have textContent
      const divNodes = nodes.filter((n) => n.tagName === "div");
      divNodes.forEach((div) => {
        expect(div.textContent).toBeUndefined();
      });

      // Text should still be captured via StaticText
      const staticTextNodes = nodes.filter((n) => n.role === "StaticText");
      const allStaticText = staticTextNodes.map((n) => n.name).join(" ");
      expect(allStaticText).toContain("Deeply nested text");
    });

    it("captures text in complex layout with mixed interactive and non-interactive elements", () => {
      setHtml(`
        <main>
          <header>
            <h1>Page Title</h1>
            <nav>
              <a href="/home">Home</a>
              <a href="/about">About</a>
            </nav>
          </header>
          <article>
            <p>Article intro text.</p>
            <section>
              <h2>Section Header</h2>
              <p>Section body text.</p>
              <button>Read More</button>
            </section>
          </article>
          <footer>
            <p>Footer text here.</p>
          </footer>
        </main>
      `);

      const snapshot = collectDomSnapshot(document);
      const nodes = Object.values(snapshot.idToNode);

      // Non-interactive containers should NOT have textContent
      const mainNode = nodes.find((n) => n.tagName === "main");
      const headerNode = nodes.find((n) => n.tagName === "header");
      const articleNode = nodes.find((n) => n.tagName === "article");
      const footerNode = nodes.find((n) => n.tagName === "footer");

      expect(mainNode?.textContent).toBeUndefined();
      expect(headerNode?.textContent).toBeUndefined();
      expect(articleNode?.textContent).toBeUndefined();
      expect(footerNode?.textContent).toBeUndefined();

      // All visible text should be captured via StaticText nodes
      const staticTextNodes = nodes.filter((n) => n.role === "StaticText");
      const allStaticText = staticTextNodes.map((n) => n.name).join(" ");

      expect(allStaticText).toContain("Page Title");
      expect(allStaticText).toContain("Article intro text.");
      expect(allStaticText).toContain("Section Header");
      expect(allStaticText).toContain("Section body text.");
      expect(allStaticText).toContain("Footer text here.");

      // Interactive elements (links, buttons) should have their text as name
      const links = nodes.filter((n) => n.tagName === "a");
      expect(links.map((l) => l.name)).toContain("Home");
      expect(links.map((l) => l.name)).toContain("About");

      const button = nodes.find((n) => n.tagName === "button");
      expect(button?.name).toBe("Read More");
    });

    it("formatted snapshot contains all text from non-interactive containers", () => {
      setHtml(`
        <section>
          <h1>Important Heading</h1>
          <p>Critical information that must not be lost.</p>
          <div>
            <span>More details here.</span>
          </div>
        </section>
      `);

      const snapshot = collectDomSnapshot(document);
      const textSnapshot = buildTextSnapshot(snapshot);
      const formatted = formatSnapshot(textSnapshot);

      // Formatted output should contain all text via StaticText entries
      expect(formatted).toContain("Important Heading");
      expect(formatted).toContain(
        "Critical information that must not be lost.",
      );
      expect(formatted).toContain("More details here.");
    });

    it("search can find text in non-interactive containers via StaticText", () => {
      setHtml(`
        <section>
          <p>Unique searchable content XYZ123.</p>
        </section>
      `);

      const snapshot = collectDomSnapshot(document);
      const result = searchAndFormat(snapshot, "XYZ123");

      expect(result).not.toBeNull();
      expect(result).toContain("XYZ123");
      expect(result).not.toContain("No matches found");
    });
  });
});
