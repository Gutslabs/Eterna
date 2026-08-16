import type { ToolSchema } from "./types.js";

// ===== UI Tools =====
export const uiToolSchemas: ToolSchema[] = [
  {
    name: "search_elements",
    description: `[FAST - USE FIRST] Search for elements in the current page using a query string with grep/glob pattern support. Returns all matching elements with their UIDs for direct interaction via click/fill_element_by_uid.

Example queries:
- Broad scan: '{button,link,input,StaticText}*'
- Find buttons: 'button*' or '*[Ss]ubmit*'
- Find inputs: '{input,textarea,select}*'
- Find by text: '*login*', '*search*'

This is the PREFERRED first step for page interaction - faster and more reliable than screenshots.`,
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to search the elements in",
        },
        query: {
          type: "string",
          description: "Search query string with grep/glob pattern support",
        },
        contextLevels: {
          type: "number",
          description: "Number of context lines to include",
        },
      },
      required: ["tabId", "query"],
    },
  },
  {
    name: "click",
    description:
      "Click an element by its uid. The uid MUST come from the most recent search_elements on this tab — uids go stale when the page changes, so if the element isn't found, call search_elements again for fresh uids. Prefer this over the coordinate-based computer tool whenever you have the element's uid.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The ID of the tab to click on" },
        uid: {
          type: "string",
          description:
            "The unique identifier of an element from the page snapshot",
        },
        dblClick: {
          type: "boolean",
          description: "Set to true for double clicks",
        },
      },
      required: ["tabId", "uid"],
    },
  },
  {
    name: "fill_element_by_uid",
    description:
      "Fill an input element by its uid. The uid MUST come from the most recent search_elements on this tab; if it's stale (element not found), call search_elements again. Prefer this over coordinate-based typing whenever you have the field's uid.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to fill the element in",
        },
        uid: {
          type: "string",
          description: "The unique identifier of the element to fill",
        },
        value: {
          type: "string",
          description: "The value to fill into the element",
        },
      },
      required: ["tabId", "uid", "value"],
    },
  },
  {
    name: "get_editor_value",
    description:
      "Get the complete content from a code editor (Monaco, CodeMirror, ACE) or textarea without truncation. Use this before filling to avoid data loss.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The ID of the tab" },
        uid: {
          type: "string",
          description:
            "The unique identifier of the editor element from snapshot",
        },
      },
      required: ["tabId", "uid"],
    },
  },
  {
    name: "fill_form",
    description:
      "Fill multiple form fields at once by their uids. All uids MUST come from the most recent search_elements on this tab; if any is stale, re-run search_elements for fresh uids. Prefer this over filling fields one at a time.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to fill the elements in",
        },
        elements: {
          type: "array",
          description: "Array of elements to fill with their UIDs and values",
        },
      },
      required: ["tabId", "elements"],
    },
  },
  {
    name: "hover_element_by_uid",
    description:
      "Hover over an element by its uid. The uid MUST come from the most recent search_elements on this tab; re-run search_elements if the uid is stale.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to hover over",
        },
        uid: {
          type: "string",
          description: "The unique identifier of the element to hover over",
        },
      },
      required: ["tabId", "uid"],
    },
  },
  {
    name: "upload_file_to_input",
    description: `Upload a file to a file input element (<input type="file">) on the page using a local file path.

Uses Chrome DevTools Protocol to set the file directly — no file content is read into memory.

WORKFLOW:
1. Provide the tabId and a local file_path
2. The tool automatically finds the file input (including hidden ones)
3. If the page has multiple file inputs, use input_index to select which one (0 = first)
4. Optionally provide uid from search_elements if you know the exact element

NOTE: Most websites hide the actual <input type="file"> behind a styled button. This tool handles both visible and hidden file inputs automatically.

AFTER UPLOAD: verify the file was accepted (re-run search_elements, or capture a screenshot), then proceed to submit the form.`,
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab containing the file input element",
        },
        uid: {
          type: "string",
          description:
            "UID of the <input type='file'> element from the page snapshot. OPTIONAL — if omitted or the element is hidden, the tool automatically finds the file input by CSS selector.",
        },
        input_index: {
          type: "number",
          description:
            "0-based index to select which file input to target when the page has multiple. Defaults to 0. Only used when uid is not provided or not found.",
        },
        file_id: {
          type: "string",
          description:
            "ID of the specific attached file to use (the 'ref' value from the [Attached file...] message). Omit to use the most recently attached file.",
        },
        file_path: {
          type: "string",
          description:
            "Absolute local file path to upload directly (e.g. '/Users/me/resume.pdf'). Uses CDP DOM.setFileInputFiles — no file content is read into memory. Takes priority over file_id and pre-attached files when provided.",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "computer",
    description: `[HIGH-COST FALLBACK] Coordinate-based mouse/keyboard interaction using screenshot pixels.

PREFER UID-BASED TOOLS FIRST: For clicking buttons, filling forms, or hovering elements, use search_elements to get UIDs, then use click/fill_element_by_uid/hover_element_by_uid. These are faster and more reliable.

USE THIS TOOL ONLY WHEN:
- search_elements returned 0 matches after trying 2 different query patterns
- UID-based actions failed twice (element not interactable)
- The goal requires visual/pixel-level interaction: canvas apps, drag-and-drop, sliders, charts, hover-only menus

PREREQUISITE: If you choose coordinate actions, you MUST first call capture_screenshot(sendToLLM=true). Coordinates are in screenshot pixel space.

* Click element centers, not edges. Adjust if clicks miss.`,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "left_click",
            "right_click",
            "type",
            "scroll",
            "key",
            "left_click_drag",
            "double_click",
            "triple_click",
            "scroll_to",
            "hover",
          ],
          description: `The action to perform:
* \`left_click\`: Click the left mouse button at the specified coordinates.
* \`right_click\`: Click the right mouse button at the specified coordinates to open context menus.
* \`double_click\`: Double-click the left mouse button at the specified coordinates.
* \`triple_click\`: Triple-click the left mouse button at the specified coordinates.
* \`type\`: Type a string of text at the current cursor position.
* \`scroll\`: Scroll up, down, left, or right at the specified coordinates.
* \`key\`: Press a specific keyboard key or key combination.
* \`left_click_drag\`: Drag from start_coordinate to coordinate.
* \`scroll_to\`: Scroll an element into view using its element UID from snapshot.
* \`hover\`: Move the mouse cursor to the specified coordinates without clicking. Useful for revealing tooltips, dropdown menus, or triggering hover states.`,
        },
        coordinate: {
          type: "array",
          description:
            "(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates in screenshot pixel space. Required for left_click, right_click, double_click, triple_click, scroll, and hover. For left_click_drag, this is the end position.",
        },
        text: {
          type: "string",
          description:
            'The text to type (for type action) or the key(s) to press (for key action). For key action: Provide space-separated keys (e.g., "Backspace Backspace Delete"). Supports keyboard shortcuts using the platform modifier key (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g., "cmd+a" for select all). Common keys: Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Delete.',
        },
        start_coordinate: {
          type: "array",
          description:
            "Starting coordinates for left_click_drag action in screenshot pixel space.",
        },
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to scroll for scroll action.",
        },
        scroll_amount: {
          type: "number",
          description:
            "Number of pixels to scroll. Defaults to ~2 viewport heights for standard scrolling.",
        },
        tabId: {
          type: "number",
          description:
            "The ID of the tab to operate on. Defaults to current active tab.",
        },
        uid: {
          type: "string",
          description: "Element UID from snapshot for scroll_to action.",
        },
      },
      required: ["action"],
    },
  },
];
