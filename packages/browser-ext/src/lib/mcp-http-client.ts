/**
 * Minimal MCP "streamable-http" client — just enough of the protocol to load
 * tools from a local MCP server and call them, using plain fetch so it runs
 * inside the service worker (the SDK's MCP classes pull environment-specific
 * shims that aren't reliable in a browser SW).
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST to a single endpoint. The server may
 * reply as application/json or as an SSE stream (text/event-stream); both are
 * handled. A session id returned on initialize is echoed on later calls.
 *
 * Spec: https://modelcontextprotocol.io/specification (Streamable HTTP)
 */

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 30000;

export class McpHttpClient {
  private readonly url: string;
  private sessionId: string | null = null;
  private nextId = 0;
  private initialized = false;

  constructor(url: string) {
    this.url = url;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    this.nextId += 1;
    const id = this.nextId;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });

      const newSession = response.headers.get("Mcp-Session-Id");
      if (newSession) {
        this.sessionId = newSession;
      }

      if (!response.ok) {
        throw new Error(`MCP server returned HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const message = contentType.includes("text/event-stream")
        ? parseSseForId(await response.text(), id)
        : (JSON.parse(await response.text()) as JsonRpcResponse);

      if (!message) {
        throw new Error(`No JSON-RPC response for ${method}`);
      }
      if (message.error) {
        throw new Error(`MCP ${method} error: ${message.error.message}`);
      }
      return message.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Notifications expect no response body. */
  private async notify(method: string): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    }).catch(() => {
      /* notifications are best-effort */
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "eterna", version: "0.1.0" },
    });
    await this.notify("notifications/initialized");
    this.initialized = true;
  }

  async listTools(): Promise<McpToolSchema[]> {
    await this.initialize();
    const result = (await this.rpc("tools/list")) as {
      tools?: McpToolSchema[];
    };
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.initialize();
    return this.rpc("tools/call", { name, arguments: args });
  }
}

/** Pull the JSON-RPC message matching `id` out of an SSE response body. */
export function parseSseForId(
  body: string,
  id: number,
): JsonRpcResponse | null {
  for (const block of body.split(/\n\n/)) {
    const dataLines = block
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("")) as JsonRpcResponse;
      if (parsed?.id === id) {
        return parsed;
      }
    } catch {
      // Not the JSON-RPC data event — skip.
    }
  }
  return null;
}
