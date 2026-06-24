import { afterEach, describe, expect, it, vi } from "vitest";
import { McpHttpClient, parseSseForId } from "./mcp-http-client";

describe("parseSseForId", () => {
  it("extracts the JSON-RPC message with the matching id", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      "",
      'data: {"jsonrpc":"2.0","id":2,"result":{"other":1}}',
      "",
    ].join("\n");
    const msg = parseSseForId(body, 2);
    expect(msg?.result).toEqual({ other: 1 });
  });

  it("returns null when no block matches", () => {
    expect(parseSseForId('data: {"jsonrpc":"2.0","id":1}\n\n', 9)).toBeNull();
  });
});

describe("McpHttpClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(body: unknown, sessionId?: string): Response {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    return new Response(JSON.stringify(body), { status: 200, headers });
  }

  it("initializes once, captures session id, and lists tools", async () => {
    const calls: Array<{ method: string; session: string | null }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse((init?.body as string) ?? "{}");
      const session =
        (init?.headers as Record<string, string>)["Mcp-Session-Id"] ?? null;
      calls.push({ method: parsed.method, session });
      if (parsed.method === "initialize") {
        return jsonResponse(
          { jsonrpc: "2.0", id: parsed.id, result: {} },
          "sess-1",
        );
      }
      if (parsed.method === "tools/list") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { tools: [{ name: "get_person_profile" }] },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", id: parsed.id, result: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpHttpClient("http://localhost:8080/mcp");
    const tools = await client.listTools();
    expect(tools).toEqual([{ name: "get_person_profile" }]);

    // initialize precedes tools/list, and the session id is echoed afterwards.
    expect(calls.find((c) => c.method === "initialize")).toBeDefined();
    const listCall = calls.find((c) => c.method === "tools/list");
    expect(listCall?.session).toBe("sess-1");

    // A second call reuses the established session without re-initializing.
    await client.listTools();
    const initCount = calls.filter((c) => c.method === "initialize").length;
    expect(initCount).toBe(1);
  });

  it("calls a tool and returns its result", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse((init?.body as string) ?? "{}");
      if (parsed.method === "tools/call") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { content: [{ type: "text", text: "profile data" }] },
        });
      }
      return jsonResponse({ jsonrpc: "2.0", id: parsed.id, result: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new McpHttpClient("http://localhost:8080/mcp");
    const result = (await client.callTool("get_person_profile", {
      handle: "x",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0]?.text).toBe("profile data");
  });

  it("throws on a JSON-RPC error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const parsed = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse({
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32000, message: "boom" },
        });
      }),
    );
    const client = new McpHttpClient("http://localhost:8080/mcp");
    await expect(client.listTools()).rejects.toThrow("boom");
  });
});
