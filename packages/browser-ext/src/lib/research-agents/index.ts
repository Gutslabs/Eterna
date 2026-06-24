/**
 * Research agent roster — the specialized subagents the orchestrator fans
 * work out to. Each kind has its own skill (a markdown instruction doc) and
 * its own tool subset, so e.g. the Twitter agent knows exactly how to use the
 * Twitter tools and the LinkedIn agent how to drive the LinkedIn MCP.
 *
 * Skills live as editable .md files next to this module and are bundled via
 * Vite's ?raw import.
 */

import type { FunctionTool } from "@aipexstudio/aipex-core";
import {
  skillTools,
  twitterResearchTools,
  webResearchTools,
} from "@aipexstudio/browser-runtime";
import { getLinkedInTools } from "../linkedin-mcp";
import dexscreenerSkill from "./dexscreener.md?raw";
import googleSkill from "./google.md?raw";
import linkedinSkill from "./linkedin.md?raw";
import orchestratorSkill from "./orchestrator.md?raw";
import twitterSkill from "./twitter.md?raw";
import websiteSkill from "./website.md?raw";

export type ResearchAgentKind =
  | "dexscreener"
  | "twitter"
  | "website"
  | "linkedin"
  | "google"
  | "general";

export const RESEARCH_AGENT_KINDS: ResearchAgentKind[] = [
  "dexscreener",
  "twitter",
  "website",
  "linkedin",
  "google",
  "general",
];

/** Shared rules prepended to every specialized agent's skill. */
export const SHARED_PREAMBLE = `You are a specialized research subagent working in the background as part of a larger investigation. You work silently via fetch and APIs only — never open tabs, click, type, screenshot, or talk to the user; you cannot reach them. Make reasonable assumptions and keep going; never ask questions. Be skeptical and surface anything that looks like a scam, fake, or red flag. Cite every source as a plain URL. Finish with a tight, well-structured findings report covering exactly your specialty, and state explicitly what you could not find.`;

const GENERAL_SKILL = `# General research agent

You research one self-contained question or angle using web_search and web_fetch (and any skill tools that fit). Gather real facts, follow the best sources, and return a concise, well-sourced findings report on exactly what you were asked.`;

const asTools = (tools: readonly unknown[]): FunctionTool[] =>
  tools as unknown as FunctionTool[];

const web = () => asTools(webResearchTools);

export interface AgentProfile {
  kind: ResearchAgentKind;
  label: string;
  instructions: string;
  /** Tool subset for this kind (async so MCP toolsets can load lazily). */
  resolveTools: () => Promise<FunctionTool[]>;
}

export const AGENT_PROFILES: Record<ResearchAgentKind, AgentProfile> = {
  dexscreener: {
    kind: "dexscreener",
    label: "dexscreener",
    instructions: dexscreenerSkill,
    resolveTools: async () => [...web(), ...asTools(skillTools)],
  },
  twitter: {
    kind: "twitter",
    label: "twitter",
    instructions: twitterSkill,
    resolveTools: async () => [...asTools(twitterResearchTools), ...web()],
  },
  website: {
    kind: "website",
    label: "website",
    instructions: websiteSkill,
    resolveTools: async () => web(),
  },
  linkedin: {
    kind: "linkedin",
    label: "linkedin",
    instructions: linkedinSkill,
    resolveTools: async () => [...(await getLinkedInTools()), ...web()],
  },
  google: {
    kind: "google",
    label: "web",
    instructions: googleSkill,
    resolveTools: async () => web(),
  },
  general: {
    kind: "general",
    label: "research",
    instructions: GENERAL_SKILL,
    resolveTools: async () => [
      ...web(),
      ...asTools(twitterResearchTools),
      ...asTools(skillTools),
      ...(await getLinkedInTools()),
    ],
  },
};

export function resolveAgentProfile(kind: string): AgentProfile {
  return AGENT_PROFILES[kind as ResearchAgentKind] ?? AGENT_PROFILES.general;
}

export { orchestratorSkill as ORCHESTRATOR_GUIDANCE };
