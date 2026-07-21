/**
 * Script structure tokens: the *shape* of a video's script, independent of its
 * topic. Compliance-motivated, same reason as the visual theme system: even
 * with genuine per-segment insight, scripts that all follow one skeleton
 * (same opening move -> same segment rhythm -> same outro) read as a template.
 * YouTube's 2026 inauthentic-content policy penalises exactly that.
 *
 * Plain TypeScript — no zod, no Node APIs — for the same reason as theme
 * tokens: consumed by the script-generator (Node) now and the review dashboard
 * (browser) later.
 */

/** The script's first 15-30 seconds — the hook. */
export type OpeningStyle =
  /** Opens on a question the video then answers. */
  | "question"
  /** Leads with the single most striking number in the story. */
  | "statistic"
  /** Drops the viewer into a concrete scene or moment before zooming out. */
  | "scene"
  /** States the headline development plainly, anchor-style. */
  | "directStatement"
  /** Sets up a tension between two facts or positions, resolved over the video. */
  | "contrast"
  /** Anchors today's story against a past event it echoes or reverses. */
  | "historicalEcho";

/** How the body segments relate to one another. */
export type Throughline =
  /** Events in time order. */
  | "chronological"
  /** Facets of one story, each segment a different angle. */
  | "thematic"
  /** Two sides or scenarios weighed against each other. */
  | "compareContrast"
  /** Problem established first, then responses and their trade-offs. */
  | "problemResponse"
  /** Starts hyper-specific, each segment widens the lens. */
  | "zoomOut"
  /** Ranked stakes: segments ordered by who is most affected. */
  | "stakeholderLens";

/** Where explicit analysis (the original-insight layer) is concentrated. */
export type AnalysisPlacement =
  /** Every segment carries its own short analysis beat. */
  | "perSegment"
  /** Facts first, then a dedicated mid-video analysis segment. */
  | "midpointBlock"
  /** Analysis held back into a substantial closing block before the outro. */
  | "closingBlock"
  /** A framing insight up front, revisited and deepened at the close. */
  | "bookended";

/** The script's final 15-30 seconds. */
export type OutroStyle =
  /** Ends on the open question the story leaves unresolved. */
  | "openQuestion"
  /** Tight recap of the two or three takeaways. */
  | "keyTakeaways"
  /** What to watch for next: dates, decisions, thresholds. */
  | "whatToWatch"
  /** Ends on what the story means for the viewer specifically. */
  | "viewerImplication";

/** Segment rhythm: how many body segments and how long each runs. */
export interface SegmentProfile {
  /** Inclusive body-segment count range the generator must stay within. */
  minSegments: number;
  maxSegments: number;
  /** Per-segment spoken-word budget (drives estSeconds at ~150 wpm). */
  minWordsPerSegment: number;
  maxWordsPerSegment: number;
  /** One-line rhythm description, rendered into the prompt brief. */
  rhythm: string;
}

export interface ScriptStructure {
  id: string;
  name: string;
  /** One-line editorial character, shown in the review dashboard. */
  description: string;
  opening: OpeningStyle;
  throughline: Throughline;
  segments: SegmentProfile;
  analysis: AnalysisPlacement;
  outro: OutroStyle;
}
