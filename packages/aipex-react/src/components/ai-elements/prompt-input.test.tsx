import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PromptInput,
  PromptInputChips,
  PromptInputTextarea,
} from "./prompt-input";

describe("PromptInputTextarea paste handling", () => {
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:pasted-text");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    if (originalCreateObjectUrl) {
      URL.createObjectURL = originalCreateObjectUrl;
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectUrl) {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    vi.restoreAllMocks();
  });

  function renderPrompt() {
    render(
      <PromptInput onSubmit={vi.fn()}>
        <PromptInputChips />
        <PromptInputTextarea />
      </PromptInput>,
    );
    return screen.getByRole("textbox");
  }

  it("turns selected rich text into a txt attachment", () => {
    const textarea = renderPrompt();

    const dispatched = fireEvent.paste(textarea, {
      clipboardData: {
        items: [],
        types: ["text/plain", "text/html"],
        getData: (type: string) =>
          type === "text/plain" ? "Selected page text" : "",
      },
    });

    expect(dispatched).toBe(false);
    expect(screen.getByText("pasted-text.txt")).toBeInTheDocument();
    expect(screen.getByText("TXT")).toBeInTheDocument();
  });

  it("keeps a short plain-text paste inline", () => {
    const textarea = renderPrompt();

    const dispatched = fireEvent.paste(textarea, {
      clipboardData: {
        items: [],
        types: ["text/plain"],
        getData: (type: string) =>
          type === "text/plain" ? "short plain text" : "",
      },
    });

    expect(dispatched).toBe(true);
    expect(screen.queryByText("pasted-text.txt")).not.toBeInTheDocument();
  });

  it("turns long plain text into a txt attachment", () => {
    const textarea = renderPrompt();

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [],
        types: ["text/plain"],
        getData: (type: string) =>
          type === "text/plain" ? "x".repeat(1000) : "",
      },
    });

    expect(screen.getByText("pasted-text.txt")).toBeInTheDocument();
  });
});
