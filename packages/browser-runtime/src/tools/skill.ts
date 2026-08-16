import { tool } from "@eterna/core";
import { z } from "zod";
// STATIC imports on purpose: these tools execute in the background service
// worker, and MV3 forbids dynamic import() there — the previous lazy-loading
// made every skill tool (and the prompt skill index) fail at runtime with
// "import() is disallowed". The QuickJS/ZenFS weight now rides the SW bundle;
// that is the price of the skill system actually working.
import { skillManager } from "../skill/lib/services/skill-manager";
import { getSkillInfo } from "../skill/mcp-servers/skills";

const loadSkillManager = async () => skillManager;

const loadGetSkillInfo = async () => getSkillInfo;

/**
 * Full description, capped. The trigger phrases ("Use when …") usually live
 * past the first sentence, so no sentence-cutting — the triggers ARE the
 * router.
 */
function skillIndexLine(description: string): string {
  const line = description.trim();
  return line.length > 320 ? `${line.slice(0, 320)}…` : line;
}

/**
 * One line per enabled skill. This is the agent-skills routing model: only
 * this tiny index rides the system prompt; the full SKILL.md body loads on
 * demand via load_skill when an ask matches.
 */
export function renderSkillIndex(
  skills: Array<{ name: string; description: string; enabled: boolean }>,
): string {
  const enabled = skills.filter((skill) => skill.enabled);
  if (enabled.length === 0) {
    return "";
  }
  return [
    "=== SKILLS (load on demand) ===",
    "Installed skills with their triggers. When a request matches a skill's triggers, you MUST call load_skill with its name BEFORE answering, then follow the loaded instructions for that reply — do not answer such requests from your defaults:",
    ...enabled.map(
      (skill) => `- ${skill.name}: ${skillIndexLine(skill.description)}`,
    ),
  ].join("\n");
}

const SKILL_INDEX_CACHE_TTL_MS = 60_000;
let skillIndexCache: { value: string; fetchedAt: number } | null = null;

/**
 * Skill index for the system prompt, cached so agent rebuilds don't pay the
 * lazy skill-runtime load on every turn. Soft-fails to "" — a broken skill
 * system must never break agent builds.
 */
export async function renderSkillIndexForPrompt(
  now = Date.now(),
): Promise<string> {
  if (
    skillIndexCache &&
    now - skillIndexCache.fetchedAt < SKILL_INDEX_CACHE_TTL_MS
  ) {
    return skillIndexCache.value;
  }
  let value = "";
  try {
    const skillManager = await loadSkillManager();
    await skillManager.initialize();
    const skills = skillManager.getAllSkills();
    value = renderSkillIndex(
      skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
      })),
    );
    console.log(
      `[Eterna] skill index: ${skills.filter((s) => s.enabled).length}/${skills.length} enabled, ${value.length} chars`,
    );
  } catch (error) {
    console.error("[Eterna] skill index failed; prompt gets none:", error);
    value = "";
  }
  skillIndexCache = { value, fetchedAt: now };
  return value;
}

/** Test hook. */
export function resetSkillIndexCache(): void {
  skillIndexCache = null;
}

/**
 * Deterministic skill routing: when the user's ask matches a trigger, the
 * skill's full SKILL.md is attached to THAT turn as a context block — the
 * model doesn't have to decide to call load_skill (strong models routinely
 * shortcut "simple" asks and skip the tool), and there is no extra tool
 * round-trip. The prompt index stays as discovery for unusual phrasings.
 */
export const SKILL_TURN_TRIGGERS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "grammar-correct",
    pattern:
      /\b(correct|fix|check)\s+(my\s+|the\s+|this\s+)?(grammar|english)\b|\bgrammar\s*(check|fix|correct(ion)?)\b|\b(make|sound)\s+(it|this)?\s*(more\s+)?native\b|\bis\s+(this|my)\s+(english\s+)?correct\b|ingilizce(mi|yi|sini)?\s+düzelt|grammar\s*düzelt/i,
  },
];

export interface SkillTurnContext {
  id: string;
  type: "custom";
  label: string;
  value: string;
  metadata: { kind: "skill-instructions"; skill: string };
}

/** Match the user's ask against skill triggers. Exported for tests. */
export function matchSkillTriggers(userText: string): string[] {
  return SKILL_TURN_TRIGGERS.filter(({ pattern }) =>
    pattern.test(userText),
  ).map(({ name }) => name);
}

/**
 * Context items carrying matched skills' instructions for this turn.
 * Soft-fails to [] — routing must never block a message.
 */
export async function resolveSkillTurnContexts(
  userText: string,
): Promise<SkillTurnContext[]> {
  const matched = matchSkillTriggers(userText);
  if (matched.length === 0) {
    return [];
  }
  try {
    await skillManager.initialize();
    const items: SkillTurnContext[] = [];
    for (const name of matched) {
      const content = await skillManager.getSkillContent(name);
      if (!content) continue;
      items.push({
        id: `skill-${name}`,
        type: "custom",
        label: `skill: ${name}`,
        value: [
          `[Skill activated: ${name} — this request matches its triggers. Apply the instructions below to THIS reply.]`,
          "",
          content,
        ].join("\n"),
        metadata: { kind: "skill-instructions", skill: name },
      });
    }
    console.log(
      `[Eterna] skill router: attached ${items.map((i) => i.metadata.skill).join(", ") || "none"}`,
    );
    return items;
  } catch (error) {
    console.error("[Eterna] skill router failed; turn continues bare:", error);
    return [];
  }
}

export const loadSkillTool = tool({
  name: "load_skill",
  description:
    "Load the main content (SKILL.md) of a skill. Use this to understand what a skill does, its capabilities, available scripts, and how to use it.",
  parameters: z.object({
    name: z.string().describe("The name of the skill to load"),
  }),
  execute: async ({ name }) => {
    try {
      const skillManager = await loadSkillManager();
      await skillManager.initialize();
      const content = await skillManager.getSkillContent(name);
      return { success: true, content };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const executeSkillScriptTool = tool({
  name: "execute_skill_script",
  description:
    "Execute a script that belongs to a skill. Scripts are located in the scripts/ directory of the skill package and can perform various operations.",
  parameters: z.object({
    skillName: z.string().describe("The name of the skill"),
    scriptPath: z
      .string()
      .describe(
        'The path to the script file (e.g., "scripts/init_skill.js"), MUST start with "scripts/"',
      ),
    args: z
      .unknown()
      .nullable()
      .optional()
      .describe("Arguments to pass to the script"),
  }),
  execute: async ({ skillName, scriptPath, args }) => {
    try {
      const skillManager = await loadSkillManager();
      await skillManager.initialize();
      const normalizedPath = scriptPath.startsWith("scripts/")
        ? scriptPath
        : `scripts/${scriptPath}`;
      const result = await skillManager.executeSkillScript(
        skillName,
        normalizedPath,
        args,
      );
      return { success: true, result };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const readSkillReferenceTool = tool({
  name: "read_skill_reference",
  description:
    "Read a reference document from a skill. Reference files are located in the references/ directory and contain additional documentation, guides, or examples.",
  parameters: z.object({
    skillName: z.string().describe("The name of the skill"),
    refPath: z
      .string()
      .describe(
        'The path to the reference file (e.g., "references/guide.md"), MUST start with "references/"',
      ),
  }),
  execute: async ({ skillName, refPath }) => {
    try {
      const skillManager = await loadSkillManager();
      await skillManager.initialize();
      const normalizedPath = refPath.startsWith("references/")
        ? refPath
        : `references/${refPath}`;
      const content = await skillManager.getSkillReference(
        skillName,
        normalizedPath,
      );
      return {
        success: true,
        content: `# Reference: ${normalizedPath}\n\n${content}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const getSkillAssetTool = tool({
  name: "get_skill_asset",
  description:
    "Get an asset file from a skill. Assets are located in the assets/ directory and can be images, data files, or other resources.",
  parameters: z.object({
    skillName: z.string().describe("The name of the skill"),
    assetPath: z
      .string()
      .describe(
        'The path to the asset file (e.g., "assets/icon.png"), MUST start with "assets/"',
      ),
  }),
  execute: async ({ skillName, assetPath }) => {
    try {
      const skillManager = await loadSkillManager();
      await skillManager.initialize();
      const normalizedPath = assetPath.startsWith("assets/")
        ? assetPath
        : `assets/${assetPath}`;
      const asset = await skillManager.getSkillAsset(skillName, normalizedPath);
      if (!asset) {
        return {
          success: false,
          error: `Asset '${normalizedPath}' not found in skill '${skillName}'`,
        };
      }
      if (asset instanceof ArrayBuffer) {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(asset)));
        return {
          success: true,
          content: `Asset loaded successfully (binary data, ${asset.byteLength} bytes).\n\nBase64: ${base64.substring(0, 100)}...`,
          isBinary: true,
          byteLength: asset.byteLength,
          base64,
        };
      }
      return {
        success: true,
        content: `Asset loaded successfully.\n\n${asset}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const listSkillsTool = tool({
  name: "list_skills",
  description:
    "List all available skills in the system. Shows enabled skills by default, or all skills if specified.",
  parameters: z.object({
    enabledOnly: z
      .boolean()
      .nullable()
      .optional()
      .describe("If true, only show enabled skills. Default: false"),
  }),
  execute: async ({ enabledOnly }) => {
    try {
      const skillManager = await loadSkillManager();
      await skillManager.initialize();
      const skills = skillManager.getAllSkills();
      const filtered = enabledOnly ? skills.filter((s) => s.enabled) : skills;
      return {
        success: true,
        skills: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          version: s.version,
          enabled: s.enabled,
        })),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const getSkillInfoTool = tool({
  name: "get_skill_info",
  description:
    "Get detailed information about a specific skill, including its scripts, references, assets, and metadata.",
  parameters: z.object({
    skillName: z.string().describe("The name of the skill"),
  }),
  execute: async ({ skillName }) => {
    try {
      const skillManager = await loadSkillManager();
      const getSkillInfoImpl = await loadGetSkillInfo();
      await skillManager.initialize();
      const skillInfo = await getSkillInfoImpl(skillName);
      if (skillInfo.success) {
        return { success: true, skill: skillInfo.skill };
      }
      return {
        success: false,
        error: skillInfo.error || `Failed to get skill info for '${skillName}'`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const skillTools = [
  loadSkillTool,
  executeSkillScriptTool,
  readSkillReferenceTool,
  getSkillAssetTool,
  listSkillsTool,
  getSkillInfoTool,
] as const;
