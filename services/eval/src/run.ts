/**
 * Online-Mind2Web evaluation runner.
 *
 * Drives the FULL Eterna stack end-to-end: the core agent loop runs here in
 * Node (BYOK key), and every browser tool call is proxied over the
 * eterna-mcp-daemon WebSocket into the real extension in a real Chrome.
 *
 *   node agent (eterna-core) ──WS /cli──▶ eterna-mcp-daemon ──▶ extension ──▶ Chrome
 *
 * Usage:
 *   pnpm --filter @eterna/eval start -- --limit 5
 *   pnpm --filter @eterna/eval start -- --limit 5 --judge
 *   pnpm --filter @eterna/eval start -- --tasks ./my-tasks.json --model claude-sonnet-4-5
 *
 * Requires:
 *   - `npx eterna-mcp-bridge` (or the daemon) running, extension connected
 *   - ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
 *   - A THROWAWAY Chrome profile: tasks operate on live websites.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { aisdk, Eterna, tool } from "@eterna/core";
import { toolSchemas } from "../../../mcp-bridge/src/tool-schemas.js";
import { type BridgeCallResult, BridgeClient } from "./bridge-client.js";
import { type EvalTask, loadTasks } from "./dataset.js";
import { type JsonSchemaObject, jsonSchemaToZod } from "./schema-to-zod.js";

export interface CliOptions {
  limit: number;
  offset: number;
  model: string;
  tasksFile?: string;
  refresh: boolean;
  judge: boolean;
  maxSteps: number;
  outDir: string;
}

interface StepRecord {
  tool: string;
  args: unknown;
  ok: boolean;
  resultPreview: string;
  ms: number;
}

interface TaskRecord {
  task: EvalTask;
  steps: StepRecord[];
  finalAnswer: string;
  selfReportedDone: boolean;
  judgeVerdict?: "success" | "failure" | "unsure";
  judgeReason?: string;
  durationMs: number;
  error?: string;
}

const RESULT_PREVIEW_CHARS = 600;

function readOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function readNonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 3,
    offset: 0,
    model: process.env.ETERNA_EVAL_MODEL ?? "claude-sonnet-4-5",
    refresh: false,
    judge: false,
    maxSteps: 30,
    outDir: join(process.cwd(), "runs"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = readOptionValue(argv, i, arg ?? "option");
      i += 1;
      return value;
    };
    if (arg === "--limit") {
      options.limit = readNonNegativeInteger(next(), "--limit");
    } else if (arg === "--offset") {
      options.offset = readNonNegativeInteger(next(), "--offset");
    } else if (arg === "--model") options.model = next();
    else if (arg === "--tasks") options.tasksFile = next();
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--judge") options.judge = true;
    else if (arg === "--max-steps") {
      options.maxSteps = readNonNegativeInteger(next(), "--max-steps");
    } else if (arg === "--out") options.outDir = next();
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Options: --limit N --offset N --model <id> --tasks <file> --refresh --judge --max-steps N --out <dir>\n",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.limit === 0) {
    throw new Error("--limit must be greater than zero");
  }
  if (options.maxSteps === 0) {
    throw new Error("--max-steps must be greater than zero");
  }
  return options;
}

function pickModel(modelId: string) {
  if (modelId.startsWith("claude")) return aisdk(anthropic(modelId));
  if (modelId.startsWith("gemini")) return aisdk(google(modelId));
  return aisdk(openai(modelId));
}

/** Wrap every bridge-advertised tool as a core FunctionTool that proxies over WS. */
export function formatBridgeToolOutput(result: BridgeCallResult): string {
  if (result.images.length === 0) return result.text;
  const [firstImage, ...remainingImages] = result.images;
  if (!firstImage) return result.text;
  const imageData = `data:${firstImage.mimeType};base64,${firstImage.data}`;
  const remainingNote =
    remainingImages.length > 0
      ? ` ${remainingImages.length} additional image(s) were omitted.`
      : "";
  return JSON.stringify({
    success: true,
    data: `${result.text}${remainingNote}`.trim(),
    imageData,
    sendToLLM: true,
  });
}

/** Wrap every bridge-advertised tool as a core FunctionTool that proxies over WS. */
export function buildProxyTools(
  bridge: BridgeClient,
  trajectory: StepRecord[],
) {
  return toolSchemas.map((schema) =>
    tool({
      name: schema.name,
      description: schema.description,
      parameters: jsonSchemaToZod(schema.inputSchema as JsonSchemaObject),
      execute: async (args: Record<string, unknown>) => {
        const started = Date.now();
        const cleanArgs = Object.fromEntries(
          Object.entries(args ?? {}).filter(([, v]) => v != null),
        );
        const result = await bridge.callTool(schema.name, cleanArgs);
        trajectory.push({
          tool: schema.name,
          args: cleanArgs,
          ok: result.ok,
          resultPreview: (result.error ?? result.text).slice(
            0,
            RESULT_PREVIEW_CHARS,
          ),
          ms: Date.now() - started,
        });
        if (!result.ok) {
          return `Tool error: ${result.error}`;
        }
        return formatBridgeToolOutput(result);
      },
    }),
  );
}

const SYSTEM_PROMPT = `You are Eterna, a browser automation agent being evaluated on real-world web tasks.
You control a real Chrome browser through tools. Work autonomously — never ask the user questions.
Strategy: open the target website with create_new_tab, then prefer search_elements + uid-based clicks/fills; use read_page to verify page state.
When the task is fully completed, end your reply with the exact line:
TASK_COMPLETE: <one-sentence summary of the outcome>
If you are certain the task cannot be completed, end with:
TASK_IMPOSSIBLE: <reason>`;

async function runTask(
  task: EvalTask,
  options: CliOptions,
  bridge: BridgeClient,
): Promise<TaskRecord> {
  const steps: StepRecord[] = [];
  const startedAt = Date.now();
  const agent = Eterna.create({
    instructions: SYSTEM_PROMPT,
    model: pickModel(options.model),
    tools: buildProxyTools(bridge, steps),
    conversation: false,
    maxTurns: options.maxSteps,
  });

  let finalAnswer = "";
  let error: string | undefined;
  const prompt = `Task: ${task.confirmed_task}\nWebsite: ${task.website}`;

  try {
    for await (const event of agent.chat(prompt)) {
      if (event.type === "content_delta") {
        finalAnswer += event.delta;
      } else if (event.type === "tool_call_complete") {
        process.stdout.write(
          `    ▸ ${steps.length}. ${event.toolName ?? "tool"}\n`,
        );
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    task,
    steps,
    finalAnswer: finalAnswer.trim(),
    selfReportedDone: /TASK_COMPLETE:/.test(finalAnswer),
    durationMs: Date.now() - startedAt,
    error,
  };
}

async function judgeTask(
  record: TaskRecord,
  options: CliOptions,
): Promise<TaskRecord> {
  const judgePrompt = `You are grading a browser agent on this task:
"${record.task.confirmed_task}" (website: ${record.task.website})

The agent took ${record.steps.length} actions:
${record.steps
  .map(
    (s, i) =>
      `${i + 1}. ${s.tool}(${JSON.stringify(s.args)}) -> ${s.ok ? "ok" : "ERROR"}: ${s.resultPreview.slice(0, 200)}`,
  )
  .join("\n")}

Final agent message:
${record.finalAnswer.slice(0, 2000)}

Based ONLY on this trajectory, answer with the exact format:
VERDICT: success | failure | unsure
REASON: <one sentence>`;

  const judge = Eterna.create({
    instructions:
      "You are a strict evaluator of web automation trajectories. Trajectories that never reach the target site or never verify the outcome are failures.",
    model: pickModel(options.model),
    tools: [],
    conversation: false,
  });

  let output = "";
  try {
    for await (const event of judge.chat(judgePrompt)) {
      if (event.type === "content_delta") output += event.delta;
    }
  } catch {
    return record;
  }

  const verdict = output.match(/VERDICT:\s*(success|failure|unsure)/i);
  const reason = output.match(/REASON:\s*(.+)/i);
  return {
    ...record,
    judgeVerdict: verdict
      ? (verdict[1]!.toLowerCase() as TaskRecord["judgeVerdict"])
      : "unsure",
    judgeReason: reason?.[1]?.trim(),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bridge = new BridgeClient();

  process.stdout.write("Probing bridge connection…\n");
  const probe = await bridge.probe();
  if (!probe.ok) {
    process.stderr.write(
      `Cannot reach the extension: ${probe.error}\nStart the daemon (npx eterna-mcp-bridge) and connect the extension from its Options page.\n`,
    );
    process.exit(1);
  }

  const allTasks = await loadTasks(options);
  const tasks = allTasks.slice(options.offset, options.offset + options.limit);
  process.stdout.write(
    `Loaded ${allTasks.length} tasks; running ${tasks.length} (offset ${options.offset}) with ${options.model}.\n`,
  );

  const runDir = join(
    options.outDir,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(runDir, { recursive: true });

  const records: TaskRecord[] = [];
  for (const [index, task] of tasks.entries()) {
    process.stdout.write(
      `\n[${index + 1}/${tasks.length}] ${task.task_id}: ${task.confirmed_task.slice(0, 90)}\n`,
    );
    let record = await runTask(task, options, bridge);
    if (options.judge && !record.error) {
      record = await judgeTask(record, options);
    }
    records.push(record);
    writeFileSync(
      join(runDir, "tasks.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n"),
    );
    const status = record.error
      ? `ERROR (${record.error.slice(0, 80)})`
      : record.judgeVerdict
        ? `judge=${record.judgeVerdict}`
        : record.selfReportedDone
          ? "self-reported done"
          : "not completed";
    process.stdout.write(
      `    ${status} — ${record.steps.length} steps, ${(record.durationMs / 1000).toFixed(1)}s\n`,
    );
  }

  const summary = {
    model: options.model,
    tasks: records.length,
    errors: records.filter((r) => r.error).length,
    selfReportedDone: records.filter((r) => r.selfReportedDone).length,
    judged: options.judge
      ? {
          success: records.filter((r) => r.judgeVerdict === "success").length,
          failure: records.filter((r) => r.judgeVerdict === "failure").length,
          unsure: records.filter((r) => r.judgeVerdict === "unsure").length,
        }
      : undefined,
    avgSteps:
      records.reduce((sum, r) => sum + r.steps.length, 0) /
      Math.max(1, records.length),
    outputDir: runDir,
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
