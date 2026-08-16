import type { ToolSchema } from "./types.js";

// ===== Skill Tools =====
export const skillToolSchemas: ToolSchema[] = [
  {
    name: "load_skill",
    description:
      "Load the main content (SKILL.md) of a skill. Use this to understand what a skill does, its capabilities, available scripts, and how to use it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the skill to load" },
      },
      required: ["name"],
    },
  },
  {
    name: "execute_skill_script",
    description:
      "Execute a script that belongs to a skill. Scripts are located in the scripts/ directory of the skill package and can perform various operations.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "The name of the skill" },
        scriptPath: {
          type: "string",
          description:
            'The path to the script file (e.g., "scripts/init_skill.js"), MUST start with "scripts/"',
        },
        args: { description: "Arguments to pass to the script" },
      },
      required: ["skillName", "scriptPath"],
    },
  },
  {
    name: "read_skill_reference",
    description:
      "Read a reference document from a skill. Reference files are located in the references/ directory and contain additional documentation, guides, or examples.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "The name of the skill" },
        refPath: {
          type: "string",
          description:
            'The path to the reference file (e.g., "references/guide.md"), MUST start with "references/"',
        },
      },
      required: ["skillName", "refPath"],
    },
  },
  {
    name: "get_skill_asset",
    description:
      "Get an asset file from a skill. Assets are located in the assets/ directory and can be images, data files, or other resources.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "The name of the skill" },
        assetPath: {
          type: "string",
          description:
            'The path to the asset file (e.g., "assets/icon.png"), MUST start with "assets/"',
        },
      },
      required: ["skillName", "assetPath"],
    },
  },
  {
    name: "list_skills",
    description:
      "List all available skills in the system. Shows enabled skills by default, or all skills if specified.",
    inputSchema: {
      type: "object",
      properties: {
        enabledOnly: {
          type: "boolean",
          description: "If true, only show enabled skills. Default: false",
        },
      },
      required: [],
    },
  },
  {
    name: "get_skill_info",
    description:
      "Get detailed information about a specific skill, including its scripts, references, assets, and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "The name of the skill" },
      },
      required: ["skillName"],
    },
  },
];
