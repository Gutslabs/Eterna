import type { ToolSchema } from "./types.js";

// ===== Page Tools =====
export const pageToolSchemas: ToolSchema[] = [
  {
    name: "get_page_metadata",
    description:
      "Get page metadata including title, description, keywords, etc.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "scroll_to_element",
    description: "Scroll to a DOM element and center it in the viewport",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to scroll to",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "highlight_element",
    description:
      "Visually highlight elements on the page (drop-shadow outline) to show the user where something is — use when they ask 'where is…' or you want to point at what you found. Permanent by default; pass duration for a temporary flash.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of the element to highlight",
        },
        color: {
          type: "string",
          description: "Shadow color (e.g., '#00d4ff')",
        },
        duration: {
          type: "number",
          description: "Duration in milliseconds (0 = permanent)",
        },
        intensity: {
          type: "string",
          enum: ["subtle", "normal", "strong"],
        },
        persist: {
          type: "boolean",
          description: "Whether to keep the highlight permanently",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "highlight_text_inline",
    description:
      "Highlight specific words or phrases within the page's text (inline marker styling) — point the user at exact wording, e.g. 'show me where it says X'.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description:
            "CSS selector of the element(s) containing the text to search",
        },
        searchText: {
          type: "string",
          description: "The text or phrase to highlight",
        },
        caseSensitive: { type: "boolean" },
        wholeWords: { type: "boolean" },
        highlightColor: { type: "string" },
        backgroundColor: { type: "string" },
        fontWeight: { type: "string" },
        persist: { type: "boolean" },
      },
      required: ["selector", "searchText"],
    },
  },

  {
    name: "get_youtube_transcript",
    description:
      "Fetch the full transcript (captions) of the YouTube video in the user's current tab. Use this whenever the user wants to summarize, explain, translate, quote, or ask questions about the YouTube video they are watching. Returns the complete transcript text and video metadata. Only works on a youtube.com/watch, youtu.be, /shorts or /live page. If transcript parts are already auto-attached to the conversation as context blocks, work from those instead of calling this again.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description:
            "Optional BCP-47 language code (e.g. 'en', 'tr') to prefer a specific caption track. If omitted, the original/manual track is preferred, then auto-generated captions.",
        },
        includeTimestamps: {
          type: "boolean",
          description:
            "When true, also return per-line timestamps (segments). Leave false/omitted for summaries to save tokens; set true when the user asks about specific moments or timestamps.",
        },
      },
      required: [],
    },
  },
  {
    name: "read_page",
    description:
      "Read the main content of the page open in the active tab, as clean Markdown. Use this when the attached page context was cut off ('…[truncated]') or you need more of the current page than the attached snippet — it reads the complete article from the live DOM (works on SPAs too). Long pages come back as a heading outline plus the first chunk; pass `section` (a heading from the outline) or `offset` (from a prior result's nextOffset) to read further. For a link the user is NOT currently on, use read_url instead.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            "Jump to the section under this heading (match a line from the outline). For long pages only.",
        },
        offset: {
          type: "number",
          description:
            "Character offset to continue from — pass a prior result's nextOffset to read the next chunk.",
        },
      },
      required: [],
    },
  },
  {
    name: "read_url",
    description:
      "Fetch a web page by its URL and return the main content as clean Markdown (with title, author, site and word count when available). Use this to read or summarize a link the user gives you, or one you found, when it is NOT the page already open in the browser — for the current page use the attached page context instead. Handles articles, blog posts, docs, PDFs, GitHub, Reddit and X/Twitter threads; not for pages that require a login.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL of the page to read.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "extract_structured_data",
    description:
      "Pull specific named fields from a page. Give the fields you want (each with a short hint) and optionally a URL; it returns the page's main content as Markdown plus the list of fields to fill, so you can read off exact values (price, sku, author, date, rating, availability…) instead of eyeballing the whole article. Defaults to the current active tab; pass a URL to target another page. For freeform reading use read_page (current page) or read_url (a link).",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          description:
            "The fields to pull from the page. Each item is an object with 'name' (e.g. 'price') and an optional 'hint' (e.g. 'current price with currency').",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Field name to extract, e.g. 'price'.",
              },
              hint: {
                type: "string",
                description:
                  "What to look for, e.g. 'current price with currency'.",
              },
            },
            required: ["name"],
          },
        },
        url: {
          type: "string",
          description: "Page to read; omit to use the current active tab.",
        },
      },
      required: ["fields"],
    },
  },
];
