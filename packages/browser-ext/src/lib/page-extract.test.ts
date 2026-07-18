import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./page-extract";

describe("htmlToMarkdown", () => {
  it("converts a Defuddle-style post to clean markdown with no HTML tags or double-encoded entities", () => {
    // Mirrors what the base Defuddle build returns for an X post: clean but raw
    // HTML, with the FxTwitter extractor's double-encoded ampersand.
    const html =
      '<article data-defuddle=""><div class="twitter post"><div class="post-content">' +
      "<p>where the fuck are the creative devs btw</p>" +
      "<p>how are kintara &amp;amp; papertrade the only cool things upcoming onchain rn</p>" +
      "</div></div></article>";
    const md = htmlToMarkdown(html);

    expect(md).not.toContain("<");
    expect(md).not.toContain("data-defuddle");
    // "&amp;amp;" collapses all the way back to a literal "&".
    expect(md).toContain("kintara & papertrade");
    expect(md).not.toContain("&amp;");
    expect(md).toContain("where the fuck are the creative devs btw");
    // Paragraphs become blank-line-separated blocks.
    expect(md).toMatch(/btw\n\nhow are kintara/);
  });

  it("renders headings, links and list items as markdown", () => {
    const html =
      "<h1>Title</h1><p>Intro with a <a href='https://x.com/a'>link</a>.</p>" +
      "<ul><li>one</li><li>two</li></ul>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("[link](https://x.com/a)");
    expect(md).toContain("- one");
    expect(md).toContain("- two");
  });

  it("renders an HTML table as an aligned GFM table with a header separator", () => {
    const html =
      "<table><caption>Prices</caption>" +
      "<thead><tr><th>Item</th><th>Price</th><th>Stock</th></tr></thead>" +
      "<tbody>" +
      "<tr><td>Widget</td><td>$10</td><td>Yes</td></tr>" +
      "<tr><td>Gadget</td><td>$20</td><td>No</td></tr>" +
      "</tbody></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| Item | Price | Stock |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| Widget | $10 | Yes |");
    expect(md).toContain("| Gadget | $20 | No |");
    expect(md).toContain("**Prices**");
  });

  it("pads short table rows and escapes literal pipes inside cells", () => {
    const html =
      "<table><tr><th>A</th><th>B</th></tr><tr><td>a|b</td></tr></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | --- |");
    // Literal pipe escaped; the missing second cell is padded to empty.
    expect(md).toContain("| a\\|b | |");
  });

  it("keeps non-http link text but drops the href (no javascript: urls)", () => {
    expect(
      htmlToMarkdown("<p><a href='javascript:void(0)'>click</a></p>"),
    ).toBe("click");
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
