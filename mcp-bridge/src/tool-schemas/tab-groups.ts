import type { ToolSchema } from "./types.js";

// ===== Tab Group Tools =====
export const tabGroupToolSchemas: ToolSchema[] = [
  {
    name: "get_all_tab_groups",
    description: "Get all tab groups across all windows",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_tab_group",
    description: "Create a new tab group with specified tabs",
    inputSchema: {
      type: "object",
      properties: {
        tabIds: {
          type: "array",
          description: "Array of tab IDs to group",
          items: { type: "number" },
        },
        title: { type: "string", description: "Title for the tab group" },
        color: {
          type: "string",
          enum: [
            "blue",
            "red",
            "yellow",
            "green",
            "orange",
            "purple",
            "pink",
            "cyan",
            "grey",
          ],
          description: "Color for the tab group",
        },
      },
      required: ["tabIds"],
    },
  },
  {
    name: "update_tab_group",
    description: "Update tab group properties (title, color, collapsed state)",
    inputSchema: {
      type: "object",
      properties: {
        groupId: {
          type: "number",
          description: "ID of the tab group to update",
        },
        title: { type: "string", description: "New title for the tab group" },
        color: {
          type: "string",
          enum: [
            "blue",
            "red",
            "yellow",
            "green",
            "orange",
            "purple",
            "pink",
            "cyan",
            "grey",
          ],
          description: "New color for the tab group",
        },
        collapsed: {
          type: "boolean",
          description: "Whether the tab group should be collapsed",
        },
      },
      required: ["groupId"],
    },
  },
  {
    name: "delete_tab_group",
    description: "Delete a tab group (ungroups all tabs in the group)",
    inputSchema: {
      type: "object",
      properties: {
        groupId: {
          type: "number",
          description: "ID of the tab group to delete",
        },
      },
      required: ["groupId"],
    },
  },
];
