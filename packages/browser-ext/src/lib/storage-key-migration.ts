/**
 * One-time storage-key migration for the aipex → eterna rename.
 *
 * The keys are the user's data: settings (which carry provider API keys),
 * long-term memory, persona, scheduled automations, theme and language.
 * Renaming the prefix without moving the values would leave all of it stranded
 * under the old names and the app would come up blank, so every launch copies
 * any surviving `aipex_*` value onto its `eterna_*` name.
 *
 * The old keys are deliberately left in place: a user who downgrades keeps
 * working, and a stale copy is cheaper than destroying the only copy. The
 * migration never overwrites a value that already exists under the new name,
 * so it is safe to run on every startup.
 */

const LEGACY_PREFIX = "aipex_";
const CURRENT_PREFIX = "eterna_";

/** Keys that predate the rename and are not built from STORAGE_KEYS. */
const LEGACY_STANDALONE_KEYS: Record<string, string> = {
  "aipex-input-mode": "eterna-input-mode",
  "aipex-saved-prompts": "eterna-saved-prompts",
};

function renameKey(key: string): string | null {
  if (key in LEGACY_STANDALONE_KEYS) return LEGACY_STANDALONE_KEYS[key] ?? null;
  if (key.startsWith(LEGACY_PREFIX)) {
    return `${CURRENT_PREFIX}${key.slice(LEGACY_PREFIX.length)}`;
  }
  return null;
}

export async function migrateLegacyStorageKeys(): Promise<number> {
  try {
    const all = await chrome.storage.local.get(null);
    const pending: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(all)) {
      const nextKey = renameKey(key);
      // Skip when the new key already holds data — the user has moved on and
      // the legacy copy is stale.
      if (!nextKey || nextKey in all) continue;
      pending[nextKey] = value;
    }

    const count = Object.keys(pending).length;
    if (count > 0) {
      await chrome.storage.local.set(pending);
      console.log(`[Eterna] Migrated ${count} storage key(s) from aipex_*`);
    }
    return count;
  } catch (error) {
    // A failed migration must never block startup — the app still runs, it
    // just comes up with defaults until the next launch retries.
    console.error("[Eterna] Storage key migration failed:", error);
    return 0;
  }
}
