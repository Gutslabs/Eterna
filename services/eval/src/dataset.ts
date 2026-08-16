import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Online-Mind2Web task loading.
 * Dataset: https://huggingface.co/datasets/osunlp/Online-Mind2Web
 */

export const DATASET_URL =
  "https://huggingface.co/datasets/osunlp/Online-Mind2Web/raw/main/Online_Mind2Web.json";

export interface EvalTask {
  task_id: string;
  confirmed_task: string;
  website: string;
  /** Difficulty bucket as published (easy/medium/hard), when present. */
  level?: string;
  /** Reference number of steps a human needed, when present. */
  reference_length?: number;
}

export function parseTasks(raw: unknown): EvalTask[] {
  if (!Array.isArray(raw)) {
    throw new Error("Dataset root is not an array");
  }
  const tasks: EvalTask[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const task = item.confirmed_task;
    const website = item.website;
    if (typeof task !== "string" || typeof website !== "string") continue;
    tasks.push({
      task_id: String(item.task_id ?? `task-${tasks.length}`),
      confirmed_task: task,
      website,
      level: typeof item.level === "string" ? item.level : undefined,
      reference_length:
        typeof item.reference_length === "number"
          ? item.reference_length
          : undefined,
    });
  }
  if (tasks.length === 0) {
    throw new Error("Dataset contained no usable tasks");
  }
  return tasks;
}

function cachePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", ".cache", "online-mind2web.json");
}

export async function loadTasks(options: {
  tasksFile?: string;
  refresh?: boolean;
}): Promise<EvalTask[]> {
  if (options.tasksFile) {
    return parseTasks(JSON.parse(readFileSync(options.tasksFile, "utf8")));
  }

  const cache = cachePath();
  if (!options.refresh) {
    try {
      return parseTasks(JSON.parse(readFileSync(cache, "utf8")));
    } catch {
      /* cache miss — download below */
    }
  }

  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download dataset (HTTP ${response.status}). Pass --tasks <file> to use a local copy.`,
    );
  }
  const body = await response.text();
  const tasks = parseTasks(JSON.parse(body));
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, body);
  return tasks;
}
