import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractHtmlToMarkdown } from "./read-url";

/**
 * Guards the service-worker DOM shim. Turndown (inside defuddle's markdown
 * converter) locks its HTML parser when its module evaluates: with no
 * `window.DOMParser` present at worker startup it commits to the legacy
 * `document.implementation.createHTMLDocument()` + open/write/close path.
 * linkedom implements none of that, and the failure was silent — read_url
 * logged "Cannot read properties of undefined (reading 'createHTMLDocument')"
 * and returned an empty document.
 */
const scope = globalThis as {
  window?: unknown;
  document?: unknown;
  DOMParser?: unknown;
};

const originals = {
  window: scope.window,
  document: scope.document,
  DOMParser: scope.DOMParser,
};

beforeEach(() => {
  // A bare MV3 service worker: no window, no document, no DOMParser.
  scope.window = undefined;
  scope.document = undefined;
  scope.DOMParser = undefined;
});

afterEach(() => {
  scope.window = originals.window;
  scope.document = originals.document;
  scope.DOMParser = originals.DOMParser;
});

const ARTICLE = `<!doctype html><html><head><title>Teminat nedir</title></head>
<body><article>
  <h1>Teminat nedir</h1>
  <p>Kripto'da borç almak için varlığını rehin bırakırsın. Bu varlığa teminat denir.</p>
  <p>Fiyat çok düşerse sistem teminatı satar ve borcu kapatır. Bu yüzden oran önemlidir.</p>
  <p>Ödeme yapınca teminatın geri gelir. Faiz, borcun açık kaldığı süreye göre işler.</p>
</article></body></html>`;

describe("extractHtmlToMarkdown without a DOM", () => {
  it("installs a document turndown's legacy parser can drive", async () => {
    await extractHtmlToMarkdown(ARTICLE, "https://example.com/teminat", 10_000);

    const installed = scope.document as {
      implementation?: { createHTMLDocument?: () => unknown };
    };
    const scratch = installed.implementation?.createHTMLDocument?.() as
      | {
          open(): void;
          write(chunk: string): void;
          close(): void;
          getElementById(id: string): { childNodes: ArrayLike<unknown> } | null;
        }
      | undefined;
    expect(scratch).toBeDefined();
    if (!scratch) return;

    // Exactly turndown's dance (RootNode -> htmlParser().parseFromString).
    scratch.open();
    scratch.write(
      '<x-turndown id="turndown-root"><h1>Hi</h1><p>There</p></x-turndown>',
    );
    scratch.close();
    const root = scratch.getElementById("turndown-root");
    expect(root).not.toBeNull();
    expect(root?.childNodes.length).toBe(2);
  });

  it("returns real markdown instead of dying on the missing DOM", async () => {
    const result = await extractHtmlToMarkdown(
      ARTICLE,
      "https://example.com/teminat",
      10_000,
    );

    expect(result).not.toBeNull();
    expect(result?.content).toContain("teminat");
    expect(result?.content.length).toBeGreaterThan(80);
  });
});
