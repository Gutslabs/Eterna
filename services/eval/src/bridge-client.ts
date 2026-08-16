import { WebSocket } from "ws";

/**
 * Minimal client for the eterna-mcp-daemon /cli endpoint.
 *
 * Speaks the same JSON-RPC-over-WebSocket protocol as eterna-cli: one socket
 * per call, `tools/call` request, single response. The daemon must already be
 * running (`npx eterna-mcp-bridge` or `npx eterna-mcp-daemon`) and the
 * extension connected from its Options page.
 */

export interface BridgeContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface BridgeCallResult {
  ok: boolean;
  /** Concatenated text parts (JSON kept as-is). */
  text: string;
  /** Base64 images returned by the tool, if any. */
  images: Array<{ data: string; mimeType: string }>;
  error?: string;
}

const DEFAULT_URL = "ws://localhost:9223/cli";

export class BridgeClient {
  constructor(
    private readonly url: string = process.env.ETERNA_BRIDGE_URL ?? DEFAULT_URL,
    private readonly callTimeoutMs: number = 90_000,
  ) {}

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<BridgeCallResult> {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.url);
      let settled = false;
      const finish = (result: BridgeCallResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          text: "",
          images: [],
          error: `Tool '${name}' timed out after ${this.callTimeoutMs}ms`,
        });
      }, this.callTimeoutMs);

      ws.on("error", (err) => {
        finish({
          ok: false,
          text: "",
          images: [],
          error: `Bridge connection failed (${err.message}). Is the daemon running and the extension connected?`,
        });
      });

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        );
      });

      ws.on("message", (data) => {
        try {
          const response = JSON.parse(data.toString()) as {
            error?: { message?: string };
            result?: { content?: BridgeContentItem[]; isError?: boolean };
          };
          if (response.error) {
            finish({
              ok: false,
              text: "",
              images: [],
              error: response.error.message ?? JSON.stringify(response.error),
            });
            return;
          }
          const content = response.result?.content ?? [];
          const textParts: string[] = [];
          const images: Array<{ data: string; mimeType: string }> = [];
          for (const item of content) {
            if (item.type === "text" && item.text) {
              textParts.push(item.text);
            } else if (item.type === "image" && item.data) {
              images.push({
                data: item.data,
                mimeType: item.mimeType ?? "image/png",
              });
            }
          }
          const text = textParts.join("\n");
          finish({
            ok: response.result?.isError !== true,
            text,
            images,
            error: response.result?.isError === true ? text : undefined,
          });
        } catch (err) {
          finish({
            ok: false,
            text: "",
            images: [],
            error: `Failed to parse bridge response: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
        }
      });

      ws.on("close", () => {
        finish({
          ok: false,
          text: "",
          images: [],
          error: "Bridge connection closed before the tool returned a result",
        });
      });
    });
  }

  /** Cheap connectivity probe: lists tabs. */
  async probe(): Promise<{ ok: boolean; error?: string }> {
    const result = await this.callTool("get_all_tabs", {});
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
}
