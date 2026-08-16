import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "./schema-to-zod.js";

describe("jsonSchemaToZod", () => {
  it("preserves required fields and accepts nullable optional fields", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        url: { type: "string" },
        tabId: { type: "integer" },
        color: { type: "string", enum: ["red", "blue"] },
      },
      required: ["url"],
    });

    expect(schema.parse({ url: "https://example.com", tabId: null })).toEqual({
      url: "https://example.com",
      tabId: null,
    });
    expect(() => schema.parse({ tabId: 1 })).toThrow();
    expect(() => schema.parse({ url: "ok", color: "green" })).toThrow();
  });

  it("converts nested array object items", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: { role: { type: "string" } },
            required: ["role"],
          },
        },
      },
      required: ["messages"],
    });

    expect(schema.parse({ messages: [{ role: "user" }] })).toEqual({
      messages: [{ role: "user" }],
    });
  });
});
