import type { ScriptStructure } from "./tokens.js";

/**
 * The structure catalog: 13 distinct script skeletons.
 *
 * Like the theme catalog, these vary *shape*, not topic: how the video opens,
 * how segments relate, how many there are and how long they run, where the
 * analysis sits, and how it ends. No two structures share the same combination,
 * and the spread is deliberate — 3-segment deep dives to 7-segment wires, so
 * consecutive videos differ in rhythm, not just wording.
 *
 * Word budgets are constrained by the product's 5-20 minute runtime target
 * (~150 spoken wpm): every structure's minimum lands >= ~750 words and no
 * structure can exceed 3000. test-script-structure.mts enforces that
 * arithmetically, so a new structure that breaks the runtime envelope fails
 * the build.
 */

/** Spoken-word budget for the opening hook, shared by all structures. */
export const OPENING_WORDS = { min: 40, max: 90 };
/** Spoken-word budget for the outro, shared by all structures. */
export const OUTRO_WORDS = { min: 40, max: 90 };

export const SCRIPT_STRUCTURES: readonly ScriptStructure[] = [
  {
    id: "anchor-brief",
    name: "Anchor Brief",
    description: "Classic bulletin: plain-stated headline, thematic segments, crisp takeaways.",
    opening: "directStatement",
    throughline: "thematic",
    segments: { minSegments: 4, maxSegments: 5, minWordsPerSegment: 230, maxWordsPerSegment: 400, rhythm: "even, steady segments of similar weight" },
    analysis: "perSegment",
    outro: "keyTakeaways",
  },
  {
    id: "cold-open-scene",
    name: "Cold Open",
    description: "Drops into one concrete moment, then widens out to the full story.",
    opening: "scene",
    throughline: "zoomOut",
    segments: { minSegments: 4, maxSegments: 5, minWordsPerSegment: 230, maxWordsPerSegment: 400, rhythm: "starts tight and specific, each segment wider than the last" },
    analysis: "bookended",
    outro: "viewerImplication",
  },
  {
    id: "by-the-numbers",
    name: "By The Numbers",
    description: "Leads with the striking figure; data-forward segments, analysis in the middle.",
    opening: "statistic",
    throughline: "thematic",
    segments: { minSegments: 5, maxSegments: 6, minWordsPerSegment: 190, maxWordsPerSegment: 330, rhythm: "brisk data-led segments, one number anchoring each" },
    analysis: "midpointBlock",
    outro: "whatToWatch",
  },
  {
    id: "open-question",
    name: "Open Question",
    description: "Poses the question, works through responses, ends without pretending certainty.",
    opening: "question",
    throughline: "problemResponse",
    segments: { minSegments: 4, maxSegments: 5, minWordsPerSegment: 230, maxWordsPerSegment: 400, rhythm: "problem laid out first, responses weighed in turn" },
    analysis: "closingBlock",
    outro: "openQuestion",
  },
  {
    id: "two-sides",
    name: "Two Sides",
    description: "A tension established up front, both positions given their strongest case.",
    opening: "contrast",
    throughline: "compareContrast",
    segments: { minSegments: 4, maxSegments: 6, minWordsPerSegment: 230, maxWordsPerSegment: 380, rhythm: "alternating perspective, each segment answering the previous one" },
    analysis: "midpointBlock",
    outro: "viewerImplication",
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "Today's story told against the events that led here, in strict time order.",
    opening: "historicalEcho",
    throughline: "chronological",
    segments: { minSegments: 5, maxSegments: 7, minWordsPerSegment: 180, maxWordsPerSegment: 300, rhythm: "short chronological beats, accelerating toward the present" },
    analysis: "closingBlock",
    outro: "whatToWatch",
  },
  {
    id: "deep-dive",
    name: "Deep Dive",
    description: "Three long segments that actually go deep instead of skimming five.",
    opening: "question",
    throughline: "thematic",
    segments: { minSegments: 3, maxSegments: 3, minWordsPerSegment: 340, maxWordsPerSegment: 560, rhythm: "three substantial chapters, each fully developed before moving on" },
    analysis: "perSegment",
    outro: "keyTakeaways",
  },
  {
    id: "rapid-wire",
    name: "Rapid Wire",
    description: "Many short segments, one per affected party — wire-service tempo.",
    opening: "directStatement",
    throughline: "stakeholderLens",
    segments: { minSegments: 6, maxSegments: 7, minWordsPerSegment: 180, maxWordsPerSegment: 320, rhythm: "quick hits, one stakeholder per segment, no lingering" },
    analysis: "midpointBlock",
    outro: "whatToWatch",
  },
  {
    id: "ground-level",
    name: "Ground Level",
    description: "Starts with the people affected and stays close to lived consequences.",
    opening: "scene",
    throughline: "stakeholderLens",
    segments: { minSegments: 4, maxSegments: 5, minWordsPerSegment: 230, maxWordsPerSegment: 390, rhythm: "each segment stays concrete: who, where, what changes for them" },
    analysis: "perSegment",
    outro: "viewerImplication",
  },
  {
    id: "domino",
    name: "Domino",
    description: "One triggering number, then the chain of consequences it sets off.",
    opening: "statistic",
    throughline: "problemResponse",
    segments: { minSegments: 5, maxSegments: 6, minWordsPerSegment: 190, maxWordsPerSegment: 330, rhythm: "cause first, then each knock-on effect in sequence" },
    analysis: "bookended",
    outro: "keyTakeaways",
  },
  {
    id: "long-lens",
    name: "Long Lens",
    description: "A few unhurried segments framing today inside a much longer arc.",
    opening: "historicalEcho",
    throughline: "zoomOut",
    segments: { minSegments: 3, maxSegments: 4, minWordsPerSegment: 340, maxWordsPerSegment: 540, rhythm: "patient, essayistic segments that earn their length" },
    analysis: "bookended",
    outro: "openQuestion",
  },
  {
    id: "pressure-points",
    name: "Pressure Points",
    description: "Maps where the tension concentrates and who is squeezed at each point.",
    opening: "contrast",
    throughline: "problemResponse",
    segments: { minSegments: 5, maxSegments: 6, minWordsPerSegment: 190, maxWordsPerSegment: 320, rhythm: "each segment isolates one pressure point and tests it" },
    analysis: "perSegment",
    outro: "viewerImplication",
  },
  {
    id: "the-explainer",
    name: "The Explainer",
    description: "The long-form treatment: full background, mechanics, and implications.",
    opening: "question",
    throughline: "zoomOut",
    segments: { minSegments: 4, maxSegments: 5, minWordsPerSegment: 330, maxWordsPerSegment: 520, rhythm: "expansive teaching segments, definitions before consequences" },
    analysis: "midpointBlock",
    outro: "keyTakeaways",
  },
];

export const DEFAULT_STRUCTURE_ID = "anchor-brief";

const STRUCTURE_BY_ID = new Map(SCRIPT_STRUCTURES.map((s) => [s.id, s]));

export function getStructure(structureId: string): ScriptStructure {
  const structure = STRUCTURE_BY_ID.get(structureId);
  if (!structure) {
    throw new Error(
      `Unknown script structure id "${structureId}". Known ids: ${SCRIPT_STRUCTURES.map((s) => s.id).join(", ")}`,
    );
  }
  return structure;
}

/** Non-throwing lookup for callers that want to fall back rather than fail. */
export function getStructureOrDefault(structureId: string | null | undefined): ScriptStructure {
  if (!structureId) return getStructure(DEFAULT_STRUCTURE_ID);
  return STRUCTURE_BY_ID.get(structureId) ?? getStructure(DEFAULT_STRUCTURE_ID);
}

export const STRUCTURE_IDS: readonly string[] = SCRIPT_STRUCTURES.map((s) => s.id);
