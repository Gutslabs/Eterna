import type { ToolSchema } from "./types.js";

// ===== Bookmark Tools =====
export const bookmarkToolSchemas: ToolSchema[] = [
  {
    name: "list_bookmarks",
    description: "Get all bookmarks in a flattened list",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_bookmarks",
    description: "Search bookmarks by title or URL",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_bookmark",
    description: "Create a new bookmark",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Bookmark title" },
        url: { type: "string", description: "Bookmark URL" },
        parentId: {
          type: "string",
          description: "Parent folder ID (defaults to bookmarks bar)",
        },
      },
      required: ["title", "url"],
    },
  },
  {
    name: "update_bookmark",
    description: "Update bookmark properties",
    inputSchema: {
      type: "object",
      properties: {
        bookmarkId: {
          type: "string",
          description: "The bookmark ID to update",
        },
        title: { type: "string", description: "New title" },
        url: { type: "string", description: "New URL" },
      },
      required: ["bookmarkId"],
    },
  },
  {
    name: "delete_bookmark",
    description: "Delete a bookmark by ID",
    inputSchema: {
      type: "object",
      properties: {
        bookmarkId: {
          type: "string",
          description: "The bookmark ID to delete",
        },
      },
      required: ["bookmarkId"],
    },
  },
  {
    name: "create_bookmark_folder",
    description: "Create a new bookmark folder",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Folder title" },
        parentId: {
          type: "string",
          description: "Parent folder ID (defaults to bookmarks bar)",
        },
      },
      required: ["title"],
    },
  },
];
