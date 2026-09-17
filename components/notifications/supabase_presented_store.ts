import AsyncStorage from "@react-native-async-storage/async-storage";

// Supabase-backed once-only store for notification presentation.
// Floating banners (floating_notif.tsx) + system notifications
// (system_notif.tsx) share this module so the same update presents ONCE.
// Keys live in Supabase `notification_dedupe` table + AsyncStorage mirror.
// Lazy-imports the Supabase client (dynamic require) so this module never
// crashes when Supabase env config is missing. Crash-safe: never throws.
const getSupabaseClient = (): {
  from: (table: string) => any;
} | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../../api/supabase") as {
      supabase?: { from: (table: string) => any };
    };
    return mod?.supabase ?? null;
  } catch {
    return null;
  }
};

export type DedupeItem = {
  kind?: string;
  id?: string;
  status?: string;
  createdAtMs?: number;
  seenKey?: string | null;
};

const MAX_PRESENTED_KEYS = 200;
const LEGACY_STORAGE_PREFIX = "@puredrop/presented_floating_notifs/";
const SUPABASE_TIMEOUT_MS = 3000;

const getStorageKey = (uid: string): string => `${LEGACY_STORAGE_PREFIX}${uid}`;

// Must match both presenters:
// report: "<docId>:<statusUpdatedAtMs>:<status>"
// verification: "verification:<seenKey or status:createdAtMs>"
export const getNotificationDedupeKey = (item: DedupeItem): string => {
  try {
    if ((item as { kind?: string }).kind === "verification") {
      const seen = (item as { seenKey?: string | null }).seenKey;
      const status = (item as { status?: string }).status ?? "";
      const ts = (item as { createdAtMs?: number }).createdAtMs ?? 0;
      return `verification:${seen ?? `${status}:${ts}`}`;
    }
    const id = (item as { id?: string }).id ?? "";
    const ts = (item as { createdAtMs?: number }).createdAtMs ?? 0;
    const status = (item as { status?: string }).status ?? "";
    return `${id}:${ts}:${status}`;
  } catch {
    return "";
  }
};

const presentedKeysRef = new Set<string>();
const loadedUidsRef = new Set<string>();
const inflightLoadsRef = new Map<string, Promise<Set<string>>>();
let activeUidRef: string | null = null;

export const hasPresentedKey = (key: string): boolean => {
  try {
    if (!key) return false;
    return presentedKeysRef.has(key);
  } catch {
    return false;
  }
};

export const isPresentedLoadedForUser = (uid: string | null): boolean => {
  try {
    if (!uid) return true;
    return loadedUidsRef.has(uid);
  } catch {
    return false;
  }
};
const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
  try {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      });
      const result = await Promise.race([promise, timeout]);
      return result as T | null;
    } finally {
      if (timer != null) {
        clearTimeout(timer);
      }
    }
  } catch {
    return null;
  }
};

const readSupabaseKeys = async (uid: string): Promise<string[]> => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return [];
    }
    const query = client
      .from("notification_dedupe")
      .select("presented_keys")
      .eq("user_id", uid)
      .maybeSingle();
    const result = (await withTimeout(
      query as unknown as Promise<unknown>,
      SUPABASE_TIMEOUT_MS,
    )) as { data?: { presented_keys?: unknown } } | null;
    const raw = result?.data?.presented_keys;
    if (Array.isArray(raw)) {
      return raw.filter((k): k is string => typeof k === "string" && k.length > 0);
    }
    return [];
  } catch {
    return [];
  }
};

const writeSupabaseKeys = async (uid: string): Promise<void> => {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }
    const arr = Array.from(presentedKeysRef).slice(-MAX_PRESENTED_KEYS);
    const upsert = client.from("notification_dedupe").upsert(
      { user_id: uid, presented_keys: arr, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    await withTimeout(upsert as unknown as Promise<unknown>, SUPABASE_TIMEOUT_MS);
  } catch {
    // Non-fatal: AsyncStorage mirror already has the keys.
  }
};

const persistKeys = (uid: string): void => {
  try {
    const arr = Array.from(presentedKeysRef).slice(-MAX_PRESENTED_KEYS);
    void AsyncStorage.setItem(getStorageKey(uid), JSON.stringify(arr)).catch(() => {
      // Non-fatal.
    });
  } catch {
    // Non-fatal.
  }
  try {
    void writeSupabaseKeys(uid).catch(() => {
      // Non-fatal.
    });
  } catch {
    // Non-fatal.
  }
};
// Loads presented keys for a uid into shared set.
// Unions Supabase (source of truth) + AsyncStorage mirror (offline/boot).
// Resolves once per uid; concurrent callers share promise. Never throws.
export const loadPresentedKeys = (uid: string): Promise<Set<string>> => {
  try {
    if (!uid) {
      return Promise.resolve(new Set<string>());
    }
    if (activeUidRef !== uid) {
      activeUidRef = uid;
      presentedKeysRef.clear();
      loadedUidsRef.clear();
    }
    if (loadedUidsRef.has(uid)) {
      return Promise.resolve(new Set(presentedKeysRef));
    }
    const inflight = inflightLoadsRef.get(uid);
    if (inflight) {
      return inflight;
    }
    const task = (async (): Promise<Set<string>> => {
      try {
        let localKeys: string[] = [];
        try {
          const raw = await AsyncStorage.getItem(getStorageKey(uid));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              localKeys = parsed.filter(
                (k): k is string => typeof k === "string" && k.length > 0,
              );
            }
          }
        } catch {
          localKeys = [];
        }
        const remoteKeys = await readSupabaseKeys(uid);
        const merged = new Set<string>();
        localKeys.forEach((k) => merged.add(k));
        remoteKeys.forEach((k) => merged.add(k));
        const bounded = Array.from(merged).slice(-MAX_PRESENTED_KEYS);
        presentedKeysRef.clear();
        bounded.forEach((k) => presentedKeysRef.add(k));
        loadedUidsRef.add(uid);
        try {
          if (remoteKeys.length > 0) {
            persistKeys(uid);
          }
        } catch {
          // Non-fatal.
        }
        return new Set(presentedKeysRef);
      } finally {
        inflightLoadsRef.delete(uid);
      }
    })();
    inflightLoadsRef.set(uid, task);
    return task;
  } catch {
    return Promise.resolve(new Set<string>());
  }
};

// Atomically claims a key. True ONLY to first caller for a key.
export const tryClaimPresentedKey = (uid: string | null, key: string): boolean => {
  try {
    if (!key) {
      return false;
    }
    if (presentedKeysRef.has(key)) {
      return false;
    }
    presentedKeysRef.add(key);
    if (presentedKeysRef.size > MAX_PRESENTED_KEYS) {
      const oldest = presentedKeysRef.values().next().value as string | undefined;
      if (oldest !== undefined) {
        presentedKeysRef.delete(oldest);
      }
    }
    if (uid) {
      persistKeys(uid);
    }
    return true;
  } catch {
    return false;
  }
};

// Clears shared state + persisted mirrors for uid. Called on logout.
export const resetPresentedState = (uid?: string | null): void => {
  try {
    presentedKeysRef.clear();
    loadedUidsRef.clear();
    inflightLoadsRef.clear();
    activeUidRef = null;
  } catch {
    // Non-fatal.
  }
  if (uid) {
    try {
      void AsyncStorage.removeItem(getStorageKey(uid)).catch(() => {
        // Non-fatal.
      });
    } catch {
      // Non-fatal.
    }
    try {
      const client = getSupabaseClient();
      if (client) {
        const deletion = client.from("notification_dedupe").delete().eq("user_id", uid);
        void withTimeout(deletion as unknown as Promise<unknown>, 3000).catch(() => {
          // Non-fatal.
        });
      }
    } catch {
      // Non-fatal.
    }
  }
};
