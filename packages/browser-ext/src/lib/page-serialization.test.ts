import { describe, expect, it } from "vitest";
import {
  serializePageForExtraction,
  serializeSafeElementAttributes,
  serializeSafeElementText,
} from "./page-serialization";

describe("serializePageForExtraction", () => {
  it("redacts form drafts, editable content and sensitive attributes", () => {
    document.body.innerHTML = `
      <main>
        <h1>Public article</h1>
        <input value="private draft" data-auth-token="secret" />
        <div contenteditable="true">unsent message</div>
        <a href="https://example.com/page?token=secret&id=42">Read</a>
      </main>
    `;

    const result = serializePageForExtraction(document);

    expect(result.html).toContain("Public article");
    expect(result.html).not.toContain("private draft");
    expect(result.html).not.toContain("unsent message");
    expect(result.readable).not.toContain("private draft");
    expect(result.readable).not.toContain("unsent message");
    expect(result.html).not.toContain("secret");
    expect(result.html).toContain("id=42");
    expect(result.html).toContain("%5BREDACTED%5D");
  });

  it("caps oversized serialized pages", () => {
    document.body.innerHTML = `<main>${"x".repeat(2_100_000)}</main>`;

    const result = serializePageForExtraction(document);

    expect(result.truncated).toBe(true);
    expect(result.html.length).toBeLessThanOrEqual(2_000_000);
  });

  it("redacts captured element attributes", () => {
    const element = document.createElement("a");
    element.setAttribute("href", "/account?token=abc&tab=profile");
    element.setAttribute("data-session", "secret");
    element.setAttribute("onclick", "steal()");

    expect(
      serializeSafeElementAttributes(element, "https://example.com/base"),
    ).toEqual({
      href: "https://example.com/account?token=%5BREDACTED%5D&tab=profile",
    });
  });

  it("omits editable text from captured element summaries", () => {
    const element = document.createElement("section");
    element.innerHTML = `
      <p>Public label</p>
      <div contenteditable="true">private draft</div>
      <textarea>private note</textarea>
    `;

    expect(serializeSafeElementText(element)).toBe("Public label");
    expect(serializeSafeElementText(element.querySelector("textarea")!)).toBe(
      undefined,
    );
  });
});
