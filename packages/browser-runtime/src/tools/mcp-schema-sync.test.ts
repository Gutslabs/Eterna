import { describe, expect, it } from "vitest";
import { toolSchemas } from "../../../../mcp-bridge/src/tool-schemas";

// tools/index.ts pulls in modules that register chrome listeners at import
// time (e.g. the intervention manager singleton), so a permissive chrome stub
// must exist before the dynamic import below.
function makeChromeStub(): unknown {
  const handler: ProxyHandler<() => void> = {
    get: (_target, prop) =>
      prop === Symbol.toPrimitive || prop === "toString"
        ? () => "chrome-stub"
        : new Proxy(() => {}, handler),
    apply: () => new Proxy(() => {}, handler),
  };
  return new Proxy(() => {}, handler);
}
(globalThis as { chrome?: unknown }).chrome = makeChromeStub();

const { allBrowserTools } = await import("./index");

describe("mcp-bridge tool schema sync", () => {
  const registeredNames = allBrowserTools.map((tool) => tool.name).sort();
  const advertisedNames = toolSchemas.map((schema) => schema.name).sort();

  it("advertises exactly the registered browser tools", () => {
    expect(advertisedNames).toEqual(registeredNames);
  });

  it("has no duplicate schema entries", () => {
    expect(new Set(advertisedNames).size).toBe(advertisedNames.length);
  });

  it("advertises the registered tool descriptions verbatim", () => {
    // The registry is the single source of truth for what the model reads;
    // the bridge must mirror it or MCP clients see stale/conflicting guidance.
    const advertised = new Map(
      toolSchemas.map((schema) => [schema.name, schema.description]),
    );
    for (const tool of allBrowserTools) {
      expect(
        advertised.get(tool.name),
        `'${tool.name}' description drifted between the registry and the bridge`,
      ).toBe(tool.description);
    }
  });

  it("declares required properties that exist in each schema", () => {
    for (const schema of toolSchemas) {
      for (const required of schema.inputSchema.required ?? []) {
        expect(
          Object.keys(schema.inputSchema.properties),
          `${schema.name} requires '${required}' but does not define it`,
        ).toContain(required);
      }
    }
  });
});
