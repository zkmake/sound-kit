import { type MixerSettings } from "./types.ts";

type SettingsOptions<Bus extends string> = {
  defaults: MixerSettings<Bus>;
  /** localStorage key. `null`: keep settings in memory only. */
  storageKey: string | null;
  /**
   * Turn what was stored (or `null`) into settings, for a game moving off its own keys. Whatever
   * it returns is merged over the defaults and saved under `storageKey`.
   */
  migrate?: (stored: unknown) => Partial<MixerSettings<Bus>> | null | undefined;
};

const read = (key: string) => {
  try {
    const raw = globalThis.localStorage?.getItem(key);

    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: settings still apply for this session.
  }
};

/** Keeps only what a settings object may hold, so a stale or hand-edited entry can't break the mixer. */
const sanitize = <Bus extends string>(
  defaults: MixerSettings<Bus>,
  stored: unknown,
): Partial<MixerSettings<Bus>> => {
  if (typeof stored !== "object" || stored === null) {
    return {};
  }

  const value = stored as Partial<Record<keyof MixerSettings<Bus>, unknown>>;
  const result: Partial<MixerSettings<Bus>> = {};

  if (typeof value.muted === "boolean") {
    result.muted = value.muted;
  }

  if (typeof value.levels === "object" && value.levels !== null) {
    const levels = { ...defaults.levels };

    for (const key of Object.keys(levels) as (Bus | "master")[]) {
      const level = (value.levels as Record<string, unknown>)[key];

      if (typeof level === "number" && Number.isFinite(level) && level >= 0) {
        levels[key] = level;
      }
    }

    result.levels = levels;
  }

  if (Array.isArray(value.mutedBuses)) {
    result.mutedBuses = value.mutedBuses.filter(
      (bus): bus is Bus => typeof bus === "string" && bus in defaults.levels && bus !== "master",
    );
  }

  return result;
};

/**
 * The mixer's settings as an external store: `get` returns a stable snapshot until something
 * changes, which is what `useSyncExternalStore` needs. Persisted to localStorage when keyed.
 */
const createSettings = <Bus extends string>({
  defaults,
  storageKey,
  migrate,
}: SettingsOptions<Bus>) => {
  const stored = storageKey === null ? null : read(storageKey);
  const migrated = migrate ? migrate(stored) : stored;
  let current: MixerSettings<Bus> = { ...defaults, ...sanitize(defaults, migrated) };
  const listeners = new Set<() => void>();

  if (migrate && storageKey !== null && migrated) {
    write(storageKey, current);
  }

  return {
    get: () => current,
    set(patch: Partial<MixerSettings<Bus>>) {
      current = { ...current, ...patch };

      if (storageKey !== null) {
        write(storageKey, current);
      }

      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export { createSettings };
export type { SettingsOptions };
