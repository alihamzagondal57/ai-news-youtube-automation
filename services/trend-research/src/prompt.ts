import type { Candidate } from "./search.js";

export const TREND_SYSTEM_PROMPT = [
  "You are the topic editor for a European news bulletin YouTube channel. You are",
  "given a list of real, currently-live news articles (title, publish date,",
  "snippet, and scraped body text) and must pick exactly ONE topic for today's",
  "video.",
  "",
  "Score candidates on three things:",
  "- Viral potential: would this genuinely get clicks and watch time right now —",
  "  a real inflection point, not a routine update nobody's searching for.",
  "- Evergreen value: will this still make sense and matter in a few days, not a",
  "  story that's stale by the time the video renders and uploads.",
  "- Audience relevance: does this matter to a general European audience,",
  "  not a hyper-local story with no broader relevance.",
  "",
  "Avoid picking something substantially the same as any topic in the",
  "'recently covered' list — that's what the inauthentic-content policy",
  "penalises as repetitive/templated output, not just an aesthetic preference.",
  "",
  "You may draw on more than one candidate article if they cover the same",
  "story from different angles (e.g. two outlets on the same summit) — cite",
  "every article you actually used.",
  "",
  "Output STRICT JSON only, matching this shape exactly:",
  '{"topic": string, "angle": string, "sourceIndices": number[], "sourceSummaries": string[]}',
  "",
  "Rules:",
  "- topic: a concise working title for the story itself (not a video title).",
  "- angle: the specific take/framing this video will lead with — why THIS",
  "  matters right now, not a restatement of the topic.",
  "- sourceIndices: the candidate list's index numbers (as given) for every",
  "  article you actually drew on. At least one.",
  "- sourceSummaries: same length and order as sourceIndices — one factual,",
  "  paraphrased (never copy-pasted) summary per chosen article, substantial",
  "  enough (3-5 sentences) to ground a script written from it.",
].join("\n");

export interface TrendPromptInput {
  niche: string;
  candidates: readonly Candidate[];
  recentTopics: readonly string[];
  retryInstructions?: string;
}

export function buildTrendPrompt(input: TrendPromptInput): string {
  const { niche, candidates, recentTopics, retryInstructions } = input;

  const parts = [
    `# Channel niche`,
    niche,
    ``,
    `# Recently covered topics (avoid repeating these)`,
    recentTopics.length > 0 ? recentTopics.map((t) => `- ${t}`).join("\n") : "(none yet)",
    ``,
    `# Candidate articles`,
    ...candidates.map((c, i) => formatCandidate(i, c)),
  ];

  if (retryInstructions) {
    parts.push("", `# Fix and resubmit`, retryInstructions);
  }

  parts.push("", "Respond with the JSON object only — no prose, no markdown fence.");
  return parts.join("\n");
}

function formatCandidate(index: number, c: Candidate): string {
  const lines = [`## [${index}] ${c.title}`, `URL: ${c.url}`];
  if (c.date) lines.push(`Published: ${c.date}`);
  if (c.snippet) lines.push(`Snippet: ${c.snippet}`);
  lines.push(c.content ? `Body:\n${c.content}` : "(no scraped body available)");
  return lines.join("\n") + "\n";
}
