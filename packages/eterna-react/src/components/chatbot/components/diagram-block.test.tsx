import type { KeyValueStorage } from "@eterna/core";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../theme/context";
import type { Theme } from "../../../theme/types";
import type { UIToolPart } from "../../../types";
import { DiagramBlock } from "./diagram-block";

const memoryThemeStorage = (): KeyValueStorage<Theme> => {
  const store = new Map<string, Theme>();
  return {
    load: async (key) => store.get(key) ?? null,
    save: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    listAll: async () => [...store.values()],
    query: async (predicate) => [...store.values()].filter(predicate),
    watch: () => () => {},
  };
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

const toolPart = (input: unknown): UIToolPart =>
  ({
    type: "tool",
    toolName: "render_diagram",
    toolCallId: "call-1",
    input,
    state: "completed",
  }) as UIToolPart;

const renderBlock = (ui: ReactNode) =>
  render(
    <ThemeProvider storageAdapter={memoryThemeStorage()}>{ui}</ThemeProvider>,
  );

describe("DiagramBlock", () => {
  it("renders nothing without mermaid source", () => {
    const { container } = renderBlock(<DiagramBlock part={toolPart({})} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the title and keeps the source readable when rendering fails", async () => {
    // jsdom has no SVG layout, so mermaid always fails here — which is exactly
    // the environment to prove the fallback: the answer must stay salvageable
    // as visible source, never a blank block.
    renderBlock(
      <DiagramBlock
        part={toolPart({
          mermaid: "flowchart TD\n  A-->B",
          title: "Akış",
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Akış")).toBeTruthy();
      expect(screen.getByText(/flowchart TD/)).toBeTruthy();
    });
  });
});
