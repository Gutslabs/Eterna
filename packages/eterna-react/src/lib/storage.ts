/**
 * LocalStorage adapter implementing KeyValueStorage interface
 * Provides a simple browser localStorage backend for settings and data persistence
 */

import {
  type KeyValueStorage,
  safeJsonParse,
  type WatchCallback,
} from "@eterna/core";

export class LocalStorageKeyValueAdapter<T = unknown>
  implements KeyValueStorage<T>
{
  private watchers = new Map<string, Set<WatchCallback<T>>>();
  private updateQueues = new Map<string, Promise<void>>();
  private storageListener: ((event: StorageEvent) => void) | null = null;
  // Last value seen per key, so save() can hand watchers an oldValue without
  // re-reading + re-parsing the stored blob before every write. Kept fresh by
  // our own writes and by cross-tab storage events.
  private lastKnown = new Map<string, T>();

  constructor() {
    this.setupStorageListener();
  }

  private setupStorageListener(): void {
    if (typeof window === "undefined") return;

    this.storageListener = (event: StorageEvent) => {
      if (!event.key) return;
      const newValue = safeJsonParse<T>(event.newValue);
      if (newValue === null || newValue === undefined) {
        this.lastKnown.delete(event.key);
      } else {
        this.lastKnown.set(event.key, newValue);
      }
      const callbacks = this.watchers.get(event.key);
      if (callbacks) {
        const oldValue = safeJsonParse<T>(event.oldValue);
        for (const callback of callbacks) {
          callback({ newValue, oldValue });
        }
      }
    };

    window.addEventListener("storage", this.storageListener);
  }

  async save(key: string, data: T): Promise<void> {
    if (typeof localStorage === "undefined") return;
    let oldValue: T | undefined;
    if (this.watchers.get(key)?.size) {
      oldValue = this.lastKnown.has(key)
        ? this.lastKnown.get(key)
        : ((await this.load(key)) ?? undefined);
    }
    localStorage.setItem(key, JSON.stringify(data));
    this.lastKnown.set(key, data);
    this.notifyWatchers(key, {
      newValue: data,
      oldValue,
    });
  }

  private notifyWatchers(
    key: string,
    change: { newValue?: T; oldValue?: T },
  ): void {
    const callbacks = this.watchers.get(key);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(change);
      }
    }
  }

  async load(key: string): Promise<T | null> {
    if (typeof localStorage === "undefined") return null;
    try {
      const value = safeJsonParse<T>(localStorage.getItem(key));
      if (value !== null && value !== undefined) {
        this.lastKnown.set(key, value);
      }
      return value ?? null;
    } catch {
      return null;
    }
  }

  async update(key: string, updater: (current: T | null) => T): Promise<T> {
    const previous = this.updateQueues.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        const write = async (): Promise<T> => {
          const next = updater(await this.load(key));
          await this.save(key, next);
          return next;
        };
        const locks =
          typeof navigator !== "undefined"
            ? (
                navigator as Navigator & {
                  locks?: {
                    request<R>(
                      name: string,
                      callback: () => Promise<R>,
                    ): Promise<R>;
                  };
                }
              ).locks
            : undefined;
        return locks ? locks.request(`eterna-storage:${key}`, write) : write();
      });
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.updateQueues.set(key, settled);
    try {
      return await operation;
    } finally {
      if (this.updateQueues.get(key) === settled) {
        this.updateQueues.delete(key);
      }
    }
  }

  async delete(key: string): Promise<void> {
    if (typeof localStorage === "undefined") return;
    const oldValue = await this.load(key);
    localStorage.removeItem(key);
    this.lastKnown.delete(key);
    if (oldValue !== null) {
      this.notifyWatchers(key, { oldValue: oldValue ?? undefined });
    }
  }

  async listAll(): Promise<T[]> {
    if (typeof localStorage === "undefined") return [];
    const results: T[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        try {
          const value = safeJsonParse<T>(localStorage.getItem(key));
          if (value !== undefined) {
            results.push(value);
          }
        } catch {
          // Skip non-JSON values
        }
      }
    }
    return results;
  }

  async query(predicate: (item: T) => boolean): Promise<T[]> {
    const allItems = await this.listAll();
    return allItems.filter(predicate);
  }

  async clear(): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.clear();
  }

  watch(key: string, callback: WatchCallback<T>): () => void {
    let callbacks = this.watchers.get(key);
    if (!callbacks) {
      callbacks = new Set();
      this.watchers.set(key, callbacks);
    }
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.watchers.delete(key);
      }
    };
  }
}

export const localStorageKeyValueAdapter = new LocalStorageKeyValueAdapter();
