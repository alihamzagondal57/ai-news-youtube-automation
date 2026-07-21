import { rotate, type RotationState } from "../rotation/select.js";
import { THEME_IDS } from "./catalog.js";

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
 * Picks the theme for the next video. Thin wrapper over the shared rotation
 * helper (../rotation) — the field names here predate it and are kept for the
 * stored state/theme-rotation.json format.
 */
export function selectTheme(options: SelectThemeOptions = {}): ThemeSelection {
  const { state = EMPTY_ROTATION_STATE, override = null, random, availableThemeIds = THEME_IDS } = options;

  const result = rotate({
    ids: availableThemeIds,
    state: toRotationState(state),
    override,
    avoidWindow: ROTATION_AVOID_WINDOW,
    random,
  });

  return {
    themeId: result.id,
    manual: result.manual,
    nextState: { recentThemeIds: result.nextState.recentIds },
  };
}

function toRotationState(state: ThemeRotationState): RotationState {
  return { recentIds: state.recentThemeIds };
}
