/**
 * run_subagent — the orchestrator tool that fans research out to concurrent,
 * SPECIALIZED background subagents.
 *
 * Each subagent is a fresh, stateless AIPex built from a research-agent
 * profile (see research-agents/): its own skill markdown as instructions and
 * its own tool subset (e.g. the Twitter agent gets the Twitter tools, the
 * LinkedIn agent the LinkedIn MCP). Subagents use background tools only — NO
 * tab/click/computer/screenshot, and NO run_subagent, so they cannot recurse.
 *
 * The agents SDK runs parallel tool calls concurrently, so several
 * run_subagent calls in one orchestrator turn execute at the same time,
 * bounded by a small concurrency cap.
 *
 * Registered on the orchestrator only when the user enabled the parallel
 * agent AND the model can issue parallel requests (gemini / grok / codex).
 */

import type { AppSettings, FunctionTool } from "@aipexstudio/aipex-core";
import { AIPex, tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { createBrowserModel, loadAppSettings } from "./browser-model";
import {
  type AgentProfile,
  RESEARCH_AGENT_KINDS,
  type ResearchAgentKind,
  resolveAgentProfile,
  SHARED_PREAMBLE,
} from "./research-agents";

const DEFAULT_MAX_CONCURRENCY = 5;
const SUBAGENT_TIMEOUT_MS = 3 * 60 * 1000;
const SUBAGENT_MAX_TURNS = 40;

/** Pure async semaphore so at most `max` subagents run concurrently. */
export function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < max) {
        active += 1;
        resolve();
      } else {
        queue.push(resolve);
      }
    });
  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return { acquire, release };
}

export interface RunSubagentDeps {
  loadSettings: () => Promise<AppSettings>;
  buildModel: (settings: AppSettings) => unknown;
  /** Look up the agent profile (instructions + tools) for a kind. */
  resolveProfile: (kind: string) => AgentProfile;
  maxConcurrency?: number;
  timeoutMs?: number;
}

const defaultDeps: RunSubagentDeps = {
  loadSettings: loadAppSettings,
  buildModel: createBrowserModel,
  resolveProfile: resolveAgentProfile,
};

/**
 * Run one research task to completion in a fresh stateless subagent of the
 * given kind, and return its final report text. Errors are returned as text
 * so one failed subagent never crashes the orchestrator's turn.
 */
export async function runResearchSubagent(
  kind: ResearchAgentKind,
  task: string,
  deps: RunSubagentDeps,
): Promise<string> {
  const profile = deps.resolveProfile(kind);
  const settings = await deps.loadSettings();
  const model = deps.buildModel(settings);
  const tools = await profile.resolveTools();

  const subagent = AIPex.create({
    name: `${profile.label} subagent`,
    instructions: `${SHARED_PREAMBLE}\n\n${profile.instructions}`,
    model: model as Parameters<typeof AIPex.create>[0]["model"],
    tools,
    conversation: false,
    maxTurns: SUBAGENT_MAX_TURNS,
  });

  const generator = subagent.chat(task);
  const timeoutMs = deps.timeoutMs ?? SUBAGENT_TIMEOUT_MS;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void generator.return?.(undefined);
  }, timeoutMs);

  let finalOutput = "";
  let streamed = "";
  try {
    for await (const event of generator) {
      if (event.type === "content_delta") {
        streamed += event.delta;
      } else if (event.type === "execution_complete") {
        finalOutput = event.finalOutput;
      } else if (event.type === "error") {
        return `Subagent error while researching "${task}": ${event.error.message}`;
      }
    }
  } catch (error) {
    return `Subagent failed while researching "${task}": ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    clearTimeout(timer);
  }

  const report = (finalOutput || streamed).trim();
  if (timedOut) {
    return `Subagent timed out after ${Math.round(
      timeoutMs / 1000,
    )}s researching "${task}". Partial findings:\n\n${report}`;
  }
  return report || `Subagent produced no findings for "${task}".`;
}

/**
 * Build the run_subagent tool bound to the given dependencies (overridable in
 * tests). The concurrency cap is shared across all calls made through the
 * returned tool instance.
 */
export function createRunSubagentTool(
  deps: RunSubagentDeps = defaultDeps,
): FunctionTool {
  const semaphore = createSemaphore(
    deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
  );

  return tool({
    name: "run_subagent",
    description:
      "Delegate one self-contained research task to a SPECIALIZED background subagent and get back its findings report. Pick the right `kind` for the source (dexscreener=market data + links from a contract address; twitter=X presence & sentiment; website=the project site + team names; linkedin=verify & analyze team members; google=open-web due diligence; general=anything else). Each subagent works silently in the background and has no other context, so write a complete task. Call this several times in one turn to research different angles in parallel, then synthesize all reports.",
    parameters: z.object({
      kind: z
        .enum(
          RESEARCH_AGENT_KINDS as [ResearchAgentKind, ...ResearchAgentKind[]],
        )
        .describe(
          "Which specialized agent to run: dexscreener | twitter | website | linkedin | google | general.",
        ),
      task: z
        .string()
        .describe(
          "A complete, self-contained instruction for the subagent — include the contract address / project name / team names and exactly what to find. The subagent has no other context.",
        ),
      label: z
        .string()
        .optional()
        .describe(
          "Short human-readable label shown in the UI (e.g. 'dexscreener data', 'founder LinkedIn').",
        ),
    }),
    execute: async ({ kind, task }) => {
      await semaphore.acquire();
      try {
        const report = await runResearchSubagent(
          kind as ResearchAgentKind,
          task,
          deps,
        );
        return { success: true as const, kind, report };
      } finally {
        semaphore.release();
      }
    },
  }) as unknown as FunctionTool;
}
