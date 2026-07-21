import { rotate } from "../rotation/select.js";
import { STRUCTURE_IDS } from "./catalog.js";

/**
 * Cross-job rotation state, stored at `state/script-structure-rotation.json`.
 * Same shape and guarantees as theme rotation, via the shared rotation helper.
 */
export interface StructureRotationState {
  /** Most recent first. */
  recentStructureIds: string[];
}

export const EMPTY_STRUCTURE_ROTATION: StructureRotationState = { recentStructureIds: [] };

/**
 * Excluding the last 4 skeletons still leaves a 9-wide pool from the 13-strong
 * catalog, while guaranteeing much more than "not twice in a row".
 */
export const STRUCTURE_AVOID_WINDOW = 4;

export interface SelectStructureOptions {
  state?: StructureRotationState;
  /** Manual override (review dashboard / manual mode); wins over rotation. */
  override?: string | null;
  /** Injectable for deterministic tests. Must return [0, 1). */
  random?: () => number;
  availableStructureIds?: readonly string[];
}

export interface StructureSelection {
  structureId: string;
  manual: boolean;
  nextState: StructureRotationState;
}

export function selectStructure(options: SelectStructureOptions = {}): StructureSelection {
  const {
    state = EMPTY_STRUCTURE_ROTATION,
    override = null,
    random,
    availableStructureIds = STRUCTURE_IDS,
  } = options;

  const result = rotate({
    ids: availableStructureIds,
    state: { recentIds: state.recentStructureIds },
    override,
    avoidWindow: STRUCTURE_AVOID_WINDOW,
    random,
  });

  return {
    structureId: result.id,
    manual: result.manual,
    nextState: { recentStructureIds: result.nextState.recentIds },
  };
}
