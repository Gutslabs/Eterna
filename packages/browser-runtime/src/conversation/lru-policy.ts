import type { ConversationData } from "./types";

/**
 * LRU (Least Recently Used) policy for conversation management
 */
export class LRUPolicy {
  private readonly maxItems: number;

  constructor(maxItems: number = 300) {
    this.maxItems = maxItems;
  }

  /**
   * Sort conversations by updatedAt (most recent first)
   */
  sortByTimestamp(conversations: ConversationData[]): ConversationData[] {
    return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Apply LRU policy: keep only the most recent conversations
   * Returns conversations to keep and conversations to delete
   */
  apply(conversations: ConversationData[]): {
    toKeep: ConversationData[];
    toDelete: ConversationData[];
  } {
    // Pinned conversations are always kept; only unpinned ones are capped.
    const pinned = conversations.filter((c) => c.pinned);
    const unpinned = this.sortByTimestamp(
      conversations.filter((c) => !c.pinned),
    );
    return {
      toKeep: [...pinned, ...unpinned.slice(0, this.maxItems)],
      toDelete: unpinned.slice(this.maxItems),
    };
  }

  /**
   * Get conversations that should be deleted (oldest unpinned beyond the limit)
   */
  getExpiredConversations(
    conversations: ConversationData[],
  ): ConversationData[] {
    return this.apply(conversations).toDelete;
  }
}
