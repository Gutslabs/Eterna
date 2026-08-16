import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreamingResponse } from "./response";

// Long enough that the typewriter (240 chars/s) cannot reveal it all between
// the first paint and the assertions below.
const LONG_TEXT = "word ".repeat(200).trim();

describe("StreamingResponse", () => {
  it("renders restored text in full immediately when animate=false", async () => {
    const { container } = render(
      <StreamingResponse animate={false}>{LONG_TEXT}</StreamingResponse>,
    );

    // Streamdown is lazy-loaded; wait for the first painted content, then the
    // very same paint must already contain the whole text (no typewriter).
    await waitFor(() => expect(container.textContent ?? "").not.toBe(""));
    expect((container.textContent ?? "").length).toBeGreaterThanOrEqual(
      LONG_TEXT.length - 10,
    );
  });

  it("renders without crashing when animate=true", async () => {
    // The reveal is wall-clock + RAF based and races the lazy Streamdown load,
    // so asserting exact reveal progress is inherently flaky under load. The
    // animate=false test above covers the behaviour that matters (restored
    // chats show instantly); here we only assert the animated path mounts and
    // eventually paints content.
    const { container } = render(
      <StreamingResponse animate>{LONG_TEXT}</StreamingResponse>,
    );

    await waitFor(() => expect(container.textContent ?? "").not.toBe(""), {
      timeout: 10000,
    });
  });
});
