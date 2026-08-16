import { describe, expect, it } from "vitest";
import { formatBridgeToolOutput, parseArgs } from "./run.js";

describe("parseArgs", () => {
  it("parses bounded run options", () => {
    expect(
      parseArgs([
        "--limit",
        "5",
        "--offset",
        "2",
        "--max-steps",
        "40",
        "--judge",
      ]),
    ).toMatchObject({
      limit: 5,
      offset: 2,
      maxSteps: 40,
      judge: true,
    });
  });

  it("rejects invalid or unknown options", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(
      "--limit must be greater than zero",
    );
    expect(() => parseArgs(["--wat"])).toThrow("Unknown option: --wat");
    expect(() => parseArgs(["--model"])).toThrow("Missing value for --model");
  });
});

describe("formatBridgeToolOutput", () => {
  it("returns ordinary text unchanged", () => {
    expect(formatBridgeToolOutput({ ok: true, text: "done", images: [] })).toBe(
      "done",
    );
  });

  it("turns a screenshot into the core screenshot-shaping contract", () => {
    expect(
      JSON.parse(
        formatBridgeToolOutput({
          ok: true,
          text: "viewport",
          images: [{ data: "AA==", mimeType: "image/png" }],
        }),
      ),
    ).toEqual({
      success: true,
      data: "viewport",
      imageData: "data:image/png;base64,AA==",
      sendToLLM: true,
    });
  });
});
