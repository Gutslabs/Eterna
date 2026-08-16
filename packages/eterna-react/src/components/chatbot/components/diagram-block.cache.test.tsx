import type { KeyValueStorage } from "@eterna/core";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../theme/context";
import type { Theme } from "../../../theme/types";
import type { UIToolPart } from "../../../types";
import { DiagramBlock, resetDiagramRenderCacheForTests } from "./diagram-block";

const { mockRender, mockGetMermaid } = vi.hoisted(() => {
  const mockRender = vi.fn(async (_id: string, _source: string) => ({
    svg: '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>',
  }));
  const mockGetMermaid = vi.fn((_config?: { theme?: string }) => ({
    render: mockRender,
  }));
  return { mockRender, mockGetMermaid };
});

vi.mock("@streamdown/mermaid", () => ({
  mermaid: { getMermaid: mockGetMermaid },
}));

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
  vi.clearAllMocks();
  resetDiagramRenderCacheForTests();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

const toolPart = (mermaid: string): UIToolPart =>
  ({
    type: "tool",
    toolName: "render_diagram",
    toolCallId: "call-1",
    input: { mermaid },
    state: "completed",
  }) as UIToolPart;

const renderBlock = (ui: ReactNode) =>
  render(
    <ThemeProvider storageAdapter={memoryThemeStorage()}>{ui}</ThemeProvider>,
  );

describe("DiagramBlock render cache", () => {
  it("lays out a diagram once and repaints remounts from the cache", async () => {
    const source = "flowchart TD\n  A-->B";

    const first = renderBlock(<DiagramBlock part={toolPart(source)} />);
    await waitFor(() => {
      expect(first.container.querySelector("svg")).toBeTruthy();
    });
    expect(mockRender).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderBlock(<DiagramBlock part={toolPart(source)} />);
    await waitFor(() => {
      expect(second.container.querySelector("svg")).toBeTruthy();
    });
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("initializes mermaid with a theme once, then reuses the instance", async () => {
    const a = renderBlock(
      <DiagramBlock part={toolPart("flowchart TD\n  A-->B")} />,
    );
    const b = renderBlock(
      <DiagramBlock part={toolPart("flowchart TD\n  C-->D")} />,
    );
    await waitFor(() => {
      expect(a.container.querySelector("svg")).toBeTruthy();
      expect(b.container.querySelector("svg")).toBeTruthy();
    });
    expect(mockRender).toHaveBeenCalledTimes(2);
    const configuredCalls = mockGetMermaid.mock.calls.filter(
      (args) => args.length > 0 && args[0] !== undefined,
    );
    expect(configuredCalls).toHaveLength(1);
    expect(configuredCalls[0]?.[0]).toEqual({ theme: "default" });
  });

  it("renders distinct sources separately and caches each", async () => {
    const one = renderBlock(
      <DiagramBlock part={toolPart("flowchart TD\n  A-->B")} />,
    );
    await waitFor(() => {
      expect(one.container.querySelector("svg")).toBeTruthy();
    });
    one.unmount();

    const two = renderBlock(
      <DiagramBlock part={toolPart("flowchart TD\n  X-->Y")} />,
    );
    await waitFor(() => {
      expect(two.container.querySelector("svg")).toBeTruthy();
    });
    expect(mockRender).toHaveBeenCalledTimes(2);

    const oneAgain = renderBlock(
      <DiagramBlock part={toolPart("flowchart TD\n  A-->B")} />,
    );
    await waitFor(() => {
      expect(oneAgain.container.querySelector("svg")).toBeTruthy();
    });
    expect(mockRender).toHaveBeenCalledTimes(2);
  });
});
