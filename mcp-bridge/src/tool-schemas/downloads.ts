import type { ToolSchema } from "./types.js";

// ===== Download Tools =====
export const downloadToolSchemas: ToolSchema[] = [
  {
    name: "download_image",
    description:
      "Download an image from base64 data to the user's local filesystem",
    inputSchema: {
      type: "object",
      properties: {
        imageData: {
          type: "string",
          description: "The base64 image data URL (data:image/...)",
        },
        filename: {
          type: "string",
          description:
            "Descriptive filename for the download (without extension)",
        },
        folderPath: {
          type: "string",
          description: "Optional folder path for organizing downloads",
        },
      },
      required: ["imageData"],
    },
  },
  {
    name: "download_chat_images",
    description: "Download multiple images from chat messages in batch",
    inputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          description: "Array of chat messages containing images",
        },
        folderPrefix: {
          type: "string",
          description: "Descriptive folder name for organizing downloads",
        },
        filenamingStrategy: {
          type: "string",
          enum: ["descriptive", "sequential", "timestamp"],
        },
        displayResults: {
          type: "boolean",
          description: "Whether to display the download results",
        },
      },
      required: ["messages"],
    },
  },
];
