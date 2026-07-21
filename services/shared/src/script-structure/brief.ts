import { OPENING_WORDS, OUTRO_WORDS } from "./catalog.js";
import type { AnalysisPlacement, OpeningStyle, OutroStyle, ScriptStructure, Throughline } from "./tokens.js";

/**
 * Renders a structure into the concrete instruction block the script-generator
 * embeds in its LLM prompt. This is what makes the skeleton *data-driven*: the
 * service's prompt stays fixed, and the structural brief swaps per video.
 *
 * Directives are written as hard constraints, not suggestions — segment counts
 * and word budgets here are what the generator's output validation checks
 * against, so the brief and the validator can't ask for different things.
 */

const OPENING_DIRECTIVES: Record<OpeningStyle, string> = {
  question:
    "Open with a sharp, genuinely open question the video will answer. Not rhetorical filler — a question a well-informed viewer couldn't answer yet.",
  statistic:
    "Open with the single most striking, verifiable number in the story. State it bare first, then say why it matters. The number must come from the source material.",
  scene:
    "Open inside one concrete scene or moment — a place, a person, an event in progress. No throat-clearing; the viewer should see something happening before any framing.",
  directStatement:
    "Open by stating the core development plainly in the first sentence, anchor-style. No teasing, no 'in today's video'.",
  contrast:
    "Open by setting two true facts or positions against each other so the tension is explicit. The video resolves, or honestly fails to resolve, that tension.",
  historicalEcho:
    "Open by anchoring today's development against a specific past event it echoes or reverses. Name the year and the event; the parallel must be real, not decorative.",
};

const THROUGHLINE_DIRECTIVES: Record<Throughline, string> = {
  chronological: "Order body segments strictly by time. Each segment advances the clock; no flashbacks.",
  thematic: "Give each body segment one distinct facet of the story. No segment may restate another's ground.",
  compareContrast:
    "Alternate between the two sides or scenarios. Each segment should engage with the strongest version of the previous segment's position.",
  problemResponse:
    "Establish the problem fully in the early segments, then dedicate the rest to responses and their trade-offs, weighed honestly.",
  zoomOut:
    "Start at the most specific, concrete level and widen the lens with every segment — person, sector, country, system.",
  stakeholderLens:
    "One affected party per segment, ordered by how much is at stake for them. Name who they are concretely.",
};

const ANALYSIS_DIRECTIVES: Record<AnalysisPlacement, string> = {
  perSegment:
    "Every body segment must end with 1-2 sentences of original analysis: context, comparison, or implication that is NOT in the source summaries.",
  midpointBlock:
    "Keep early segments factual. Place one dedicated analysis segment mid-video that interprets everything laid out so far — mark it by shifting register ('So what does this actually mean?').",
  closingBlock:
    "Keep body segments factual and tight. Concentrate the analysis in a substantial final body segment before the outro — this is where the video earns its keep.",
  bookended:
    "State a framing insight in the opening minute, let the body segments accumulate evidence, then return to that insight at the close and deepen or complicate it.",
};

const OUTRO_DIRECTIVES: Record<OutroStyle, string> = {
  openQuestion:
    "Close on the genuinely unresolved question the story leaves behind. Do not manufacture false certainty.",
  keyTakeaways: "Close with the two or three things a viewer should retain, stated tightly. No new information.",
  whatToWatch:
    "Close with the specific dates, decisions, or thresholds that come next — concrete things a viewer can actually watch for.",
  viewerImplication:
    "Close on what this means for the viewer specifically — costs, choices, or changes that reach them. Concrete, not vague.",
};

/** The structural instruction block for the script-generation prompt. */
export function buildStructuralBrief(structure: ScriptStructure): string {
  const { opening, throughline, segments, analysis, outro } = structure;
  return [
    `## Script structure: "${structure.name}" (hard constraints)`,
    ``,
    `OPENING (${OPENING_WORDS.min}-${OPENING_WORDS.max} words): ${OPENING_DIRECTIVES[opening]}`,
    ``,
    `BODY: ${segments.minSegments}-${segments.maxSegments} segments, ${segments.minWordsPerSegment}-${segments.maxWordsPerSegment} spoken words each.`,
    // A midpoint target rather than only the range. Live runs showed models
    // anchoring below the lower bound and staying there across retries.
    // Measured honestly: adding this target did NOT fix that for
    // llama-3.3-70b, which caps out around 150 words per segment regardless of
    // instruction — that turned out to be a capability ceiling, not a prompting
    // problem. Kept because naming a target and a direction to miss in is
    // strictly better guidance, but it is not a solution to under-writing.
    `Target roughly ${Math.round((segments.minWordsPerSegment + segments.maxWordsPerSegment) / 2)} words per segment. Writing too SHORT is the single most common reason a draft is rejected, so if you are unsure, write longer and develop the point further rather than moving on.`,
    `Rhythm: ${segments.rhythm}.`,
    `Throughline: ${THROUGHLINE_DIRECTIVES[throughline]}`,
    ``,
    `ANALYSIS: ${ANALYSIS_DIRECTIVES[analysis]}`,
    ``,
    `OUTRO (${OUTRO_WORDS.min}-${OUTRO_WORDS.max} words): ${OUTRO_DIRECTIVES[outro]}`,
    ``,
    `These are structural constraints, not style suggestions. Segment count and per-segment word budgets are validated mechanically; a script outside them is rejected.`,
  ].join("\n");
}
