/**
 * Generic no-recent-repeats rotation over a catalog of ids.
 *
 * Extracted from theme selection when script-structure rotation needed the
 * identical behaviour: pick from a catalog while excluding the last few picks
 * (a strictly stronger guarantee than "never twice in a row"), honour manual
 * overrides but record them in history, and degrade gracefully when the catalog
 * is smaller than the exclusion window. Both rotations share this one
 * implementation so the guarantees stay verified in one place.
 */

export interface RotationState {
  /** Most recent first. */
  recentIds: string[];
}

export const EMPTY_ROTATION: RotationState = { recentIds: [] };

export interface RotateOptions {
  /** Catalog to pick from. Must be non-empty. */
  ids: readonly string[];
  state?: RotationState;
  /** Manual override; wins over rotation when set, but still joins history. */
  override?: string | null;
  /** How many recent picks to exclude. */
  avoidWindow: number;
  /** Injectable for deterministic tests. Must return [0, 1). */
  random?: () => number;
}

export interface RotationResult {
  id: string;
  /** True when the id came from a manual override rather than rotation. */
  manual: boolean;
  nextState: RotationState;
}

export function rotate(options: RotateOptions): RotationResult {
  const { ids, state = EMPTY_ROTATION, override = null, avoidWindow, random = Math.random } = options;

  if (ids.length === 0) {
    throw new Error("Cannot rotate over an empty catalog");
  }

  if (override) {
    if (!ids.includes(override)) {
      throw new Error(`Override "${override}" is not in the catalog: ${ids.join(", ")}`);
    }
    return { id: override, manual: true, nextState: pushRecent(state, override, avoidWindow) };
  }

  // Never exclude everything: if the catalog is smaller than the avoid window,
  // exclude only as much as still leaves a choice.
  const maxExclusions = Math.max(0, Math.min(avoidWindow, ids.length - 1));
  const excluded = new Set(state.recentIds.slice(0, maxExclusions));
  const candidates = ids.filter((id) => !excluded.has(id));
  const pool = candidates.length > 0 ? candidates : [...ids];

  const picked = pool[Math.floor(random() * pool.length) % pool.length];
  return { id: picked, manual: false, nextState: pushRecent(state, picked, avoidWindow) };
}

function pushRecent(state: RotationState, id: string, avoidWindow: number): RotationState {
  const deduped = state.recentIds.filter((existing) => existing !== id);
  return { recentIds: [id, ...deduped].slice(0, avoidWindow * 2) };
}
