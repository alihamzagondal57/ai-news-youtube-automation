import { DEFAULT_THEME_ID, THEME_IDS } from "./catalog.js";

/**
 * jobs-independent rotation state, stored at `state/theme-rotation.json`.
 * Keeps an ordered history (most recent first) so rotation can avoid not just
 * the last theme but the last few, which is what actually reads as variety.
 */
export interface ThemeRotationState {
  /** Most recent first. */
  recentThemeIds: string[];
}

export const EMPTY_ROTATION_STATE: ThemeRotationState = { recentThemeIds: [] };

/**
 * How many recent themes to exclude from the next pick. The hard requirement is
 * "never twice in a row"; excluding a window of recent picks is a strictly
 * stronger guarantee and stops the rotation from ping-ponging between two looks.
 */
export const ROTATION_AVOID_WINDOW = 5;

export interface SelectThemeOptions {
  state?: ThemeRotationState;
  /** Manual override from the review dashboard; wins over rotation when set. */
  override?: string | null;
  /** Injectable for deterministic tests. Must return [0, 1). */
  random?: () => number;
  availableThemeIds?: readonly string[];
}

export interface ThemeSelection {
  themeId: string;
  /** True when the id came from a manual override rather than rotation. */
  manual: boolean;
  nextState: ThemeRotationState;
}

/**
 * Picks the theme for the next video.
 *
 * Auto-rotation avoids the most recent `ROTATION_AVOID_WINDOW` themes. A manual
 * override is honoured as-is but still recorded in the history, so a later
 * auto-pick won't immediately repeat what was just chosen by hand.
 */
export function selectTheme(options: SelectThemeOptions = {}): ThemeSelection {
  const {
    state = EMPTY_ROTATION_STATE,
    override = null,
    random = Math.random,
    availableThemeIds = THEME_IDS,
  } = options;

  if (availableThemeIds.length === 0) {
    throw new Error("Cannot select a theme from an empty catalog");
  }

  if (override) {
    if (!availableThemeIds.includes(override)) {
      throw new Error(`Manual theme override "${override}" is not a known theme id`);
    }
    return { themeId: override, manual: true, nextState: pushRecent(state, override) };
  }

  // Never exclude everything: if the catalog is smaller than the avoid window,
  // fall back to excluding only what still leaves a choice.
  const maxExclusions = Math.max(0, Math.min(ROTATION_AVOID_WINDOW, availableThemeIds.length - 1));
  const excluded = new Set(state.recentThemeIds.slice(0, maxExclusions));
  const candidates = availableThemeIds.filter((id) => !excluded.has(id));
  const pool = candidates.length > 0 ? candidates : [...availableThemeIds];

  const picked = pool[Math.floor(random() * pool.length) % pool.length] ?? DEFAULT_THEME_ID;
  return { themeId: picked, manual: false, nextState: pushRecent(state, picked) };
}

function pushRecent(state: ThemeRotationState, themeId: string): ThemeRotationState {
  const deduped = state.recentThemeIds.filter((id) => id !== themeId);
  return { recentThemeIds: [themeId, ...deduped].slice(0, ROTATION_AVOID_WINDOW * 2) };
}
