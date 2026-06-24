import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLinkedInTools, resetLinkedInToolsCache } from "./linkedin-mcp";
import type { McpHttpClient } from "./mcp-http-client";

function fakeClient(
  schemas: Array<{ name: string; inputSchema?: unknown }>,
  callResult: unknown = { content: [{ type: "text", text: "ok" }] },
): McpHttpClient {
  return {
    listTools: vi.fn(async () => schemas),
    callTool: vi.fn(async () => callResult),
    initialize: vi.fn(async () => {}),
  } as unknown as McpHttpClient;
}

describe("getLinkedInTools", () => {
  beforeEach(() => resetLinkedInToolsCache());
  afterEach(() => vi.clearAllMocks());

  it("wraps MCP tool schemas as agent tools", async () => {
    const tools = await getLinkedInTools({
      createClient: () =>
        fakeClient([
          { name: "get_person_profile", inputSchema: { type: "object" } },
          { name: "search_people" },
        ]),
    });
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names).toEqual(["get_person_profile", "search_people"]);
  });

  it("withholds side-effecting and private-inbox tools from subagents", async () => {
    const tools = await getLinkedInTools({
      createClient: () =>
        fakeClient([
          { name: "get_person_profile" },
          { name: "send_message" }, // sends a real DM
          { name: "connect_with_person" }, // sends a connection request
          { name: "close_session" },
          { name: "get_inbox" }, // private messages
          { name: "search_companies" },
        ]),
    });
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names).toEqual(["get_person_profile", "search_companies"]);
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("connect_with_person");
  });

  it("returns an empty toolset when the server is unreachable", async () => {
    const tools = await getLinkedInTools({
      createClient: () =>
        ({
          listTools: vi.fn(async () => {
            throw new Error("ECONNREFUSED");
          }),
        }) as unknown as McpHttpClient,
    });
    expect(tools).toEqual([]);
  });

  it("does not re-probe a down server within the retry window", async () => {
    const listTools = vi.fn(async () => {
      throw new Error("down");
    });
    const createClient = vi.fn(
      () => ({ listTools }) as unknown as McpHttpClient,
    );
    let clock = 1000;
    const deps = { createClient, now: () => clock };

    await getLinkedInTools(deps);
    clock += 5000; // within the 30s window
    await getLinkedInTools(deps);
    expect(listTools).toHaveBeenCalledTimes(1);

    clock += 60000; // past the window
    await getLinkedInTools(deps);
    expect(listTools).toHaveBeenCalledTimes(2);
  });

  it("caches tools and reuses them once available", async () => {
    const createClient = vi.fn(() => fakeClient([{ name: "get_feed" }]));
    await getLinkedInTools({ createClient });
    await getLinkedInTools({ createClient });
    // Client built once; second call served from cache.
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
