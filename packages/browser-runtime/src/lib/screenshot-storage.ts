/**
 * Screenshot storage using IndexedDB.
 * Stores screenshots with a uid for efficient reference and retrieval.
 * Applies an LRU eviction policy (max 50 screenshots).
 *
 * Uses the same DB/store as the aipex ScreenshotStorage so both
 * can share screenshots during the migration period.
 */

export interface ScreenshotData {
  uid: string;
  /** Complete data URL: data:image/png;base64,... */
  base64Data: string;
  timestamp: number;
  tabId?: number;
  metadata?: {
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  };
}

const DB_NAME = "aipex-screenshots-db";
const DB_VERSION = 1;
const STORE_NAME = "screenshots";
const MAX_SCREENSHOTS = 50;

let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

function initialize(): Promise<void> {
  if (initPromise) return initPromise;
  if (db) return Promise.resolve();

  initPromise = new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      initPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      initPromise = null;
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "uid",
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("tabId", "tabId", { unique: false });
      }
    };
  });

  return initPromise;
}

function generateUid(): string {
  return `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function applyLRU(): Promise<void> {
  if (!db) return;
  // Evict via the timestamp index with a KEY cursor: walk oldest-first and
  // delete just enough keys, never materializing any base64Data. The old
  // getAll() deserialized every stored screenshot (up to ~250MB of base64) on
  // each save just to sort timestamps.
  await new Promise<void>((resolve, reject) => {
    const tx = db!.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_SCREENSHOTS;
      if (excess <= 0) return;
      let removed = 0;
      const cursorReq = store.index("timestamp").openKeyCursor(); // ascending = oldest first
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= excess) return;
        store.delete(cursor.primaryKey);
        removed++;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    };
    countReq.onerror = () => reject(countReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Runtime-level screenshot storage (for use inside browser-runtime tools).
 * Shares the same IndexedDB database as the UI-level ScreenshotStorage
 * in aipex-react so screenshots are accessible across packages.
 */
export const RuntimeScreenshotStorage = {
  /**
   * Save a screenshot and return its uid.
   * The base64Data must be a valid data URL (validated before storing).
   */
  async saveScreenshot(
    base64Data: string,
    metadata?: {
      tabId?: number;
      width?: number;
      height?: number;
      viewportWidth?: number;
      viewportHeight?: number;
    },
  ): Promise<string> {
    // Validate that it's a data URL (not arbitrary content)
    if (
      typeof base64Data !== "string" ||
      !base64Data.startsWith("data:image/")
    ) {
      throw new Error("Invalid screenshot data: expected data:image/ URL");
    }

    await initialize();
    if (!db) throw new Error("Database not initialized");

    const uid = generateUid();
    const entry: ScreenshotData = {
      uid,
      base64Data,
      timestamp: Date.now(),
      tabId: metadata?.tabId,
      metadata: metadata
        ? {
            width: metadata.width ?? 0,
            height: metadata.height ?? 0,
            viewportWidth: metadata.viewportWidth ?? 0,
            viewportHeight: metadata.viewportHeight ?? 0,
          }
        : undefined,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Async LRU eviction — fire-and-forget
    applyLRU().catch(() => {});

    return uid;
  },

  /**
   * Get screenshot base64 data by uid.
   */
  async getScreenshot(uid: string): Promise<string | null> {
    await initialize();
    if (!db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const tx = db!.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(uid);
      req.onsuccess = () => {
        const data = req.result as ScreenshotData | undefined;
        resolve(data?.base64Data ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Clear all screenshots.
   */
  async clearAll(): Promise<void> {
    await initialize();
    if (!db) throw new Error("Database not initialized");

    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};
