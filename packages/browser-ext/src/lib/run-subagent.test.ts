import type { AgentEvent } from "@aipexstudio/aipex-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked before importing the module under test.
const createMock = vi.fn();
vi.mock("@aipexstudio/aipex-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aipexstudio/aipex-core")>();
  return {
    ...actual,
    AIPex: { create: (opts: unknown) => createMock(opts) },
  };
});

vi.mock("./browser-model", () => ({
  loadAppSettings: vi.fn(async () => ({ aiModel: "gemini-3.1-pro-preview" })),
  createBrowserModel: vi.fn(() => ({ mockModel: true })),
}));

// research-agents imports the browser-runtime barrel for tool sets; mock it so
// the test never loads the real IndexedDB-backed module.
vi.mock("@aipexstudio/browser-runtime", () => ({
  skillTools: [{ name: "load_skill" }],
  webResearchTools: [{ name: "web_search" }, { name: "web_fetch" }],
  twitterResearchTools: [{ name: "twitter_search" }, { name: "twitter_user" }],
}));
vi.mock("./linkedin-mcp", () => ({
  getLinkedInTools: vi.fn(async () => []),
}));

import type { AgentProfile, ResearchAgentKind } from "./research-agents";
import {
  createRunSubagentTool,
  createSemaphore,
  type RunSubagentDeps,
  runResearchSubagent,
} from "./run-subagent";

function agentYielding(events: AgentEvent[]) {
  return {
    chat: () =>
      (async function* () {
        for (const event of events) yield event;
      })(),
  };
}

function profile(
  kind: ResearchAgentKind,
  tools: Array<{ name: string }> = [],
): AgentProfile {
  return {
    kind,
    label: kind,
    instructions: `instructions for ${kind}`,
    resolveTools: async () => tools as never,
  };
}

const baseDeps: RunSubagentDeps = {
  loadSettings: async () => ({ aiModel: "gemini-3.1-pro-preview" }),
  buildModel: () => ({ mockModel: true }),
  resolveProfile: (kind) => profile(kind as ResearchAgentKind),
};

const complete = (finalOutput: string): AgentEvent => ({
  type: "execution_complete",
  finalOutput,
  metrics: {
    tokensUsed: 0,
    promptTokens: 0,
    completionTokens: 0,
    itemCount: 0,
    maxTurns: 40,
    duration: 0,
    startTime: 0,
  },
});

describe("createSemaphore", () => {
  it("never lets more than max run at once", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      await sem.acquire();
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      sem.release();
    };
    await Promise.all(Array.from({ length: 6 }, task));
    expect(maxActive).toBe(2);
  });
});

describe("runResearchSubagent", () => {
  beforeEach(() => createMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("returns the subagent's final output", async () => {
    createMock.mockReturnValue(
      agentYielding([
        { type: "content_delta", delta: "partial" },
        complete("Final findings report."),
      ]),
    );
    const report = await runResearchSubagent("google", "research X", baseDeps);
    expect(report).toBe("Final findings report.");
  });

  it("falls back to streamed text when no final output", async () => {
    createMock.mockReturnValue(
      agentYielding([
        { type: "content_delta", delta: "streamed " },
        { type: "content_delta", delta: "only" },
      ]),
    );
    const report = await runResearchSubagent("google", "research X", baseDeps);
    expect(report).toBe("streamed only");
  });

  it("returns an error note instead of throwing on an error event", async () => {
    createMock.mockReturnValue(
      agentYielding([
        { type: "error", error: new Error("model exploded") } as AgentEvent,
      ]),
    );
    const report = await runResearchSubagent("google", "research X", baseDeps);
    expect(report).toContain("Subagent error");
    expect(report).toContain("model exploded");
  });

  it("builds a stateless subagent with the kind's profile instructions and tools", async () => {
    createMock.mockReturnValue(agentYielding([complete("ok")]));
    const twitterTools = [{ name: "twitter_search" }];
    await runResearchSubagent("twitter", "find the project", {
      ...baseDeps,
      resolveProfile: () => profile("twitter", twitterTools),
    });
    const opts = createMock.mock.calls[0]?.[0];
    expect(opts.conversation).toBe(false);
    expect(opts.tools).toBe(twitterTools);
    // The kind's skill instructions are included.
    expect(opts.instructions).toContain("instructions for twitter");
  });

  it("routes each kind to its own profile", async () => {
    createMock.mockReturnValue(agentYielding([complete("ok")]));
    const seen: string[] = [];
    const deps: RunSubagentDeps = {
      ...baseDeps,
      resolveProfile: (kind) => {
        seen.push(kind);
        return profile(kind as ResearchAgentKind);
      },
    };
    await runResearchSubagent("dexscreener", "0xCA", deps);
    await runResearchSubagent("linkedin", "people: x", deps);
    expect(seen).toEqual(["dexscreener", "linkedin"]);
  });
});

describe("createRunSubagentTool", () => {
  it("produces a tool named run_subagent", () => {
    const tool = createRunSubagentTool(baseDeps);
    expect((tool as { name: string }).name).toBe("run_subagent");
  });
});
