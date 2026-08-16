import { afterEach, describe, expect, it } from "vitest";
import {
  closePagePreview,
  sanitizeSvgMarkup,
  showPagePreview,
} from "./page-preview";

const host = () => document.getElementById("eterna-page-preview");

afterEach(() => {
  closePagePreview();
});

describe("sanitizeSvgMarkup", () => {
  it("tolerates real mermaid output that strict XML rejects", () => {
    // HTML labels, unclosed <br>, and &nbsp; are all invalid XML — an XML
    // parse rejected every real diagram, which is why clicks went dead.
    const svg = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">GLM&nbsp;5.3<br>etiket</div></foreignObject>' +
        "</svg>",
    );
    expect(svg).not.toBeNull();
    // Label structure survives — mermaid positions text through foreignObject,
    // so flattening it would scatter every label to the origin.
    expect(svg?.querySelector("foreignObject div")?.textContent).toContain(
      "GLM",
    );
  });

  it("strips executable content while keeping the drawing", () => {
    const svg = sanitizeSvgMarkup(
      '<svg onload="alert(1)"><script>alert(2)</script>' +
        '<iframe src="https://evil.example"></iframe>' +
        '<a href="javascript:alert(3)"><text>x</text></a>' +
        '<rect width="4" height="4" onclick="alert(4)"/></svg>',
    );
    expect(svg).not.toBeNull();
    expect(svg?.querySelector("script, iframe")).toBeNull();
    expect(svg?.hasAttribute("onload")).toBe(false);
    expect(svg?.querySelector("rect")?.hasAttribute("onclick")).toBe(false);
    expect(svg?.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("keeps mermaid's own style element", () => {
    const svg = sanitizeSvgMarkup(
      "<svg><style>.node{fill:red}</style><rect/></svg>",
    );
    expect(svg?.querySelector("style")).not.toBeNull();
  });

  it("returns null when there is no svg at all", () => {
    expect(sanitizeSvgMarkup("<div>not a diagram</div>")).toBeNull();
  });
});

describe("showPagePreview", () => {
  it("mounts an overlay for svg payloads", () => {
    const shown = showPagePreview({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
      title: "Akış",
    });
    expect(shown).toBe(true);
    expect(host()).toBeTruthy();
  });

  it("rejects unsafe image sources", () => {
    expect(showPagePreview({ src: "javascript:alert(1)" })).toBe(false);
    expect(showPagePreview({ src: "http://insecure.example/x.png" })).toBe(
      false,
    );
    expect(host()).toBeNull();
  });

  it("accepts data-url images and replaces an existing preview", () => {
    expect(showPagePreview({ src: "data:image/png;base64,AAAA" })).toBe(true);
    expect(showPagePreview({ src: "data:image/png;base64,BBBB" })).toBe(true);
    expect(document.querySelectorAll("#eterna-page-preview")).toHaveLength(1);
  });

  it("returns false for an empty payload", () => {
    expect(showPagePreview({})).toBe(false);
    expect(host()).toBeNull();
  });
});
