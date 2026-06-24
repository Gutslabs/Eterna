/**
 * LinkedIn research tools, sourced from the stickerdaniel/linkedin-mcp-server
 * running locally in streamable-http mode:
 *
 *   docker run -it --rm -v ~/.linkedin-mcp:/home/pwuser/.linkedin-mcp \
 *     -p 8080:8080 stickerdaniel/linkedin-mcp-server:latest \
 *     --transport streamable-http --host 0.0.0.0 --port 8080
 *
 * Its tools (get_person_profile, search_people, get_company_profile, ...) are
 * loaded over our minimal MCP-over-HTTP client and wrapped as agent tools.
 * When the server isn't running this resolves to an empty toolset, so a
 * research subagent simply works without LinkedIn rather than failing.
 */

import type { FunctionTool } from "@aipexstudio/aipex-core";
import { tool } from "@aipexstudio/aipex-core";
import { McpHttpClient, type McpToolSchema } from "./mcp-http-client";

export const LINKEDIN_MCP_URL = "http://localhost:8080/mcp";

/**
 * Read-only LinkedIn tools a research subagent may use. The MCP server also
 * exposes side-effecting tools — send_message (sends a real DM),
 * connect_with_person (sends a connection request), close_session — and
 * private-inbox tools; those are deliberately withheld so an autonomous
 * subagent can never act on the user's account or read their messages.
 */
export const LINKEDIN_RESEARCH_TOOLS = new Set([
  "get_person_profile",
  "search_people",
  "get_sidebar_profiles",
  "get_my_profile",
  "get_company_profile",
  "get_company_posts",
  "search_companies",
  "get_company_employees",
  "get_job_details",
  "search_jobs",
  "get_feed",
]);

/** Re-probe a down server at most this often. */
const UNAVAILABLE_RETRY_MS = 30000;

interface ToolCache {
  tools: FunctionTool[];
  loadedAt: number;
  available: boolean;
}

let cache: ToolCache | null = null;
let client: McpHttpClient | null = null;

/** Flatten an MCP tools/call result to text the model can read. */
function mcpResultToText(result: unknown): string {
  const content = (result as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) {
    return JSON.stringify(result ?? null);
  }
  return content
    .map((part) => {
      const p = part as { type?: string; text?: string };
      return p.type === "text" && typeof p.text === "string"
        ? p.text
        : JSON.stringify(part);
    })
    .join("\n");
}

function wrapMcpTool(
  mcpClient: McpHttpClient,
  schema: McpToolSchema,
): FunctionTool {
  // MCP ships a JSON Schema; reshape it into the SDK's non-strict
  // object-schema form (strict mode off, so additional properties allowed).
  const input = (schema.inputSchema ?? {}) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const parameters = {
    type: "object" as const,
    properties: input.properties ?? {},
    required: Array.isArray(input.required) ? input.required : [],
    additionalProperties: true as const,
  };

  return tool({
    name: schema.name,
    description: schema.description ?? `LinkedIn tool ${schema.name}`,
    parameters,
    strict: false,
    execute: async (args: unknown) => {
      try {
        const result = await mcpClient.callTool(
          schema.name,
          (args ?? {}) as Record<string, unknown>,
        );
        return { success: true as const, content: mcpResultToText(result) };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  }) as unknown as FunctionTool;
}

export interface LinkedInDeps {
  url?: string;
  createClient?: (url: string) => McpHttpClient;
  now?: () => number;
}

/**
 * Load (and cache) the LinkedIn MCP tools. Returns [] when the server is
 * unreachable, re-probing at most every UNAVAILABLE_RETRY_MS.
 */
export async function getLinkedInTools(
  deps: LinkedInDeps = {},
): Promise<FunctionTool[]> {
  const now = deps.now ?? (() => Date.now());
  const url = deps.url ?? LINKEDIN_MCP_URL;

  if (cache?.available) {
    return cache.tools;
  }
  if (
    cache &&
    !cache.available &&
    now() - cache.loadedAt < UNAVAILABLE_RETRY_MS
  ) {
    return [];
  }

  try {
    if (!client) {
      client = deps.createClient
        ? deps.createClient(url)
        : new McpHttpClient(url);
    }
    const schemas = await client.listTools();
    const tools = schemas
      .filter((schema) => LINKEDIN_RESEARCH_TOOLS.has(schema.name))
      .map((schema) => wrapMcpTool(client as McpHttpClient, schema));
    cache = { tools, loadedAt: now(), available: true };
    return tools;
  } catch {
    client = null;
    cache = { tools: [], loadedAt: now(), available: false };
    return [];
  }
}

/** Test seam — drop cached client/tools. */
export function resetLinkedInToolsCache(): void {
  cache = null;
  client = null;
}
