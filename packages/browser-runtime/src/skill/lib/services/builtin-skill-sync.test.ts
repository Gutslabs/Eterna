import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSkillMetadata } from "../utils/zip-utils";

/**
 * The shipped SKILL.md files must be current BEFORE anything reads /skills.
 *
 * Regression: diagram-design shipped with its vendoring note above the YAML
 * frontmatter. The directory scan runs first and parses every SKILL.md it
 * finds, so it read the previous release's unparsable copy and logged
 * "No YAML frontmatter found in SKILL.md" — the heal ran afterwards, too late
 * to stop the error, and the skill stayed unregistered for that whole run.
 */

const files = new Map<string, string>();
const callOrder: string[] = [];

vi.mock("../../../lib/vm/zenfs-manager", () => ({
  zenfs: {
    getSkillPath: (name: string) => `/skills/${name}`,
    // Directories count as existing once they hold a file, as in ZenFS.
    exists: async (path: string) =>
      files.has(path) ||
      [...files.keys()].some((known) => known.startsWith(`${path}/`)),
    readFile: async (path: string) => files.get(path) ?? "",
    writeFile: async (path: string, data: string) => {
      callOrder.push(`write:${path}`);
      files.set(path, data);
    },
    mkdir: async () => {},
    initialize: async () => {},
  },
}));

vi.mock("../storage/skill-storage", () => ({
  skillStorage: {
    initialize: async () => {
      callOrder.push("scan");
      // What scanZenFSForSkills does to every SKILL.md it finds.
      for (const [path, content] of files) {
        if (path.endsWith("/SKILL.md")) parseSkillMetadata(content);
      }
    },
    listSkills: async () => [],
    getSkillMetadata: async () => ({ id: "x" }),
    saveSkillMetadata: async () => {},
  },
}));

vi.mock("./skill-registry", () => ({
  skillRegistry: {
    initialize: async () => {},
    getAllSkills: () => [],
  },
}));

vi.mock("./skill-executor", () => ({ skillExecutor: {} }));
vi.mock("../utils/zip-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/zip-utils")>();
  return { ...actual, zipSkillDirectory: async () => new Blob() };
});

const DIAGRAM_MD = "/skills/diagram-design/SKILL.md";

beforeEach(() => {
  files.clear();
  callOrder.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("built-in SKILL.md sync", () => {
  it("heals a stale, unparsable built-in before the scan reads it", async () => {
    // Exactly the shape that shipped: note first, frontmatter after.
    files.set(
      DIAGRAM_MD,
      "<!-- ETERNA ADAPTATION NOTE -->\n\n---\nname: diagram-design\ndescription: old\n---\n",
    );
    expect(() => parseSkillMetadata(files.get(DIAGRAM_MD) ?? "")).toThrow();

    const { SkillManager } = await import("./skill-manager");
    await new SkillManager().initialize();

    expect(() => parseSkillMetadata(files.get(DIAGRAM_MD) ?? "")).not.toThrow();
    expect(parseSkillMetadata(files.get(DIAGRAM_MD) ?? "").name).toBe(
      "diagram-design",
    );
    expect(callOrder.indexOf(`write:${DIAGRAM_MD}`)).toBeLessThan(
      callOrder.indexOf("scan"),
    );
  });

  it("rewrites an outdated built-in instead of pinning the installed copy", async () => {
    const stale = "---\nname: grammar-correct\ndescription: ancient\n---\n";
    files.set("/skills/grammar-correct/SKILL.md", stale);

    const { SkillManager } = await import("./skill-manager");
    await new SkillManager().initialize();

    expect(files.get("/skills/grammar-correct/SKILL.md")).not.toBe(stale);
  });

  it("writes nothing when every built-in is already current", async () => {
    const { SkillManager } = await import("./skill-manager");
    await new SkillManager().initialize();
    const writes = callOrder.filter((entry) => entry.startsWith("write:"));
    callOrder.length = 0;

    await new SkillManager().initialize();

    expect(writes.length).toBeGreaterThan(0);
    expect(callOrder.filter((entry) => entry.startsWith("write:"))).toEqual([]);
  });
});
