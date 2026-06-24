import { describe, expect, it, vi } from "vitest";

vi.mock("@aipexstudio/browser-runtime", () => ({
  skillTools: [{ name: "load_skill" }, { name: "execute_skill_script" }],
  webResearchTools: [{ name: "web_search" }, { name: "web_fetch" }],
  twitterResearchTools: [{ name: "twitter_search" }, { name: "twitter_user" }],
}));
vi.mock("../linkedin-mcp", () => ({
  getLinkedInTools: vi.fn(async () => [{ name: "get_person_profile" }]),
}));

import {
  AGENT_PROFILES,
  ORCHESTRATOR_GUIDANCE,
  resolveAgentProfile,
} from "./index";

const toolNames = async (kind: keyof typeof AGENT_PROFILES) =>
  (await AGENT_PROFILES[kind].resolveTools()).map(
    (t) => (t as { name: string }).name,
  );

describe("research agent profiles", () => {
  it("loads non-empty skill instructions from the .md files", () => {
    for (const kind of Object.keys(AGENT_PROFILES) as Array<
      keyof typeof AGENT_PROFILES
    >) {
      expect(AGENT_PROFILES[kind].instructions.length).toBeGreaterThan(50);
    }
    expect(AGENT_PROFILES.dexscreener.instructions).toContain(
      "api.dexscreener.com",
    );
    expect(ORCHESTRATOR_GUIDANCE).toContain("DexScreener first");
  });

  it("gives each agent its specialty tool subset", async () => {
    expect(await toolNames("dexscreener")).toEqual(
      expect.arrayContaining(["web_search", "web_fetch", "load_skill"]),
    );

    const twitter = await toolNames("twitter");
    expect(twitter).toContain("twitter_search");
    expect(twitter).toContain("web_fetch");
    expect(twitter).not.toContain("load_skill");

    const website = await toolNames("website");
    expect(website).toEqual(["web_search", "web_fetch"]);
    expect(website).not.toContain("twitter_search");

    const linkedin = await toolNames("linkedin");
    expect(linkedin).toContain("get_person_profile");
    expect(linkedin).toContain("web_fetch");

    expect(await toolNames("google")).toEqual(["web_search", "web_fetch"]);
  });

  it("falls back to the general profile for an unknown kind", () => {
    expect(resolveAgentProfile("nonsense").kind).toBe("general");
    expect(resolveAgentProfile("twitter").kind).toBe("twitter");
  });
});
