/**
 * Shared SVG sanitizer for previews that leave the panel.
 *
 * Parsed with the HTML parser, not the XML one: real mermaid output carries
 * HTML labels, unclosed <br> and entities that are invalid XML — a strict
 * parse rejects every real diagram (both the page modal and a raw
 * image/svg+xml tab did exactly that). foreignObject stays (label positioning
 * depends on it); everything executable goes.
 */

/** Elements with no business inside a diagram. */
const FORBIDDEN_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "video",
  "audio",
]);

const URL_ATTRIBUTES = ["href", "xlink:href", "src"];

export function sanitizeSvgMarkup(markup: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) return null;

  for (const el of [
    ...svg.querySelectorAll(Array.from(FORBIDDEN_TAGS).join(",")),
  ]) {
    el.remove();
  }

  const elements = [svg, ...svg.querySelectorAll("*")];
  for (const el of elements) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        URL_ATTRIBUTES.includes(name) &&
        /^\s*(javascript|data:text\/html)/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return svg as SVGSVGElement;
}
