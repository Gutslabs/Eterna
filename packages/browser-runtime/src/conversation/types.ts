/**
 * Message part types
 */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; imageData: string; imageTitle?: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

/**
 * UI Message structure
 */
export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  timestamp?: number;
}

/**
 * Conversation data structure stored in IndexedDB
 */
export interface ConversationData {
  id: string; // Conversation ID (e.g., "conv_1234567890_abc123")
  title: string; // Conversation title (generated from first user message)
  messages: UIMessage[]; // Message list (system messages filtered out)
  createdAt: number; // Creation timestamp
  updatedAt: number; // Last update timestamp
  pinned?: boolean; // Pinned conversations float to the top and survive LRU
  domain?: string; // Page domain the conversation started on (for display)
}

/**
 * Conversation storage configuration
 */
export interface ConversationStorageConfig {
  maxConversations?: number; // Max UNPINNED conversations to keep (default: 300)
  dbName?: string; // IndexedDB database name
  storeName?: string; // IndexedDB store name
}
