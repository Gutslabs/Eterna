import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  extractHtmlToMarkdown,
  isPublicHttpUrl,
  type ReadUrlResult,
} from "./read-url";
import { getActiveTab } from "./tab-utils";

/**
 * extract_structured_data — schema-targeted scoped read.
 *
 * The model often needs typed fields (price, sku, rating, dates) from a page,
 * and reading the whole article then eyeballing them burns tokens and
 * incorrectly associates cells. This tool returns the page's clean Markdown PLUS the
 * list of fields to fill, as a focused contract. The MODEL reads the values off
 * the content — there is deliberately NO second LLM/extraction call and NO
 * JSON-mode enforcement layer (both add cost on a per-request-billed agent).
 * Extraction reuses the same defuddle/node path as read_url / read_page.
 */

const EXTRACT_LIMIT = 16000;

export interface ExtractStructuredDataResult extends ReadUrlResult {
  fields?: string[];
  instruction?: string;
}

interface FieldSpec {
  name: string;
  hint?: string;
}

/** Render the requested fields and the "fill these" instruction for the model. */
export function buildFieldContract(fields: FieldSpec[]): {
  fieldList: string[];
  instruction: string;
} {
  const fieldList = fields.map((f) =>
    f.hint?.trim() ? `${f.name} (${f.hint.trim()})` : f.name,
  );
  return {
    fieldList,
    instruction:
      fieldList.length > 0
        ? `Read these fields directly from the page content above and report them as a list; use null for any that aren't present: ${fieldList.join(", ")}.`
        : "No fields were requested.",
  };
}

type SourceContent = { url: string; content: string } | { error: string };

async function getActiveTabMarkdown(): Promise<SourceContent> {
  const tab = await getActiveTab();
  if (!tab?.id) return { error: "No active tab to read." };
  let html = "";
  let url = tab.url ?? "";
  try {
    const response = (await chrome.tabs.sendMessage(
      tab.id,
      { request: "get-page-text" },
      { frameId: 0 },
    )) as { html?: string; readable?: string; url?: string } | undefined;
    html = response?.html ?? "";
    url = response?.url || url;
    if (!html) {
      const readable = response?.readable?.trim();
      if (readable) return { url, content: readable.slice(0, EXTRACT_LIMIT) };
      return {
        error: "Could not read the current page (it may be a restricted page).",
      };
    }
  } catch {
    return {
      error: "Could not reach the page. Open a normal web page and try again.",
    };
  }
  const extracted = await extractHtmlToMarkdown(html, url, EXTRACT_LIMIT);
  if (!extracted) {
    return {
      error: "No readable content could be extracted from the current page.",
    };
  }
  return { url, content: extracted.content };
}

async function getUrlMarkdown(url: string): Promise<SourceContent> {
  if (!isPublicHttpUrl(url)) {
    return {
      error:
        "Provide a public http(s) URL. Loopback, private and metadata addresses are blocked.",
    };
  }
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    return {
      error: `Could not fetch the page: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!response.ok) {
    return { error: `Could not fetch the page (HTTP ${response.status}).` };
  }
  let html = "";
  try {
    html = await response.text();
  } catch {
    return { error: "Could not read the page." };
  }
  const extracted = await extractHtmlToMarkdown(html, url, EXTRACT_LIMIT);
  if (!extracted) {
    return { error: "No readable content could be extracted from that page." };
  }
  return { url, content: extracted.content };
}

export const extractStructuredDataTool = tool({
  name: "extract_structured_data",
  description:
    "Pull specific named fields from a page. Give the fields you want (each with a short hint) and optionally a URL; it returns the page's main content as Markdown plus the list of fields to fill, so you can read off exact values (price, sku, author, date, rating, availability…) instead of eyeballing the whole article. Defaults to the current active tab; pass a URL to target another page. For freeform reading use read_page (current page) or read_url (a link).",
  parameters: z.object({
    fields: z
      .array(
        z.object({
          name: z.string().describe("Field name to extract, e.g. 'price'."),
          hint: z
            .string()
            .optional()
            .describe("What to look for, e.g. 'current price with currency'."),
        }),
      )
      .describe("The fields to pull from the page."),
    url: z
      .string()
      .optional()
      .describe("Page to read; omit to use the current active tab."),
  }),
  execute: async ({ fields, url }): Promise<ExtractStructuredDataResult> => {
    const source = url
      ? await getUrlMarkdown(url)
      : await getActiveTabMarkdown();
    if ("error" in source) {
      return { success: false, error: source.error };
    }
    const { fieldList, instruction } = buildFieldContract(fields);
    return {
      success: true,
      url: source.url,
      content: source.content,
      fields: fieldList,
      instruction,
    };
  },
});
