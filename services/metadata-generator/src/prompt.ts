import type { Script } from "@ai-news/shared";

export const METADATA_SYSTEM_PROMPT = [
  "You write YouTube metadata for a European news bulletin channel. You are given",
  "the finished, already-fact-checked script for one video and must produce SEO",
  "copy that accurately represents it — never invent claims, numbers, or angles",
  "beyond what the script itself says.",
  "",
  "Output STRICT JSON only, matching this shape exactly:",
  '{"title": string, "description": string, "tags": string[], "hashtags": string[]}',
  "",
  "Rules:",
  "- title: <=100 characters. Front-load the concrete news, not a generic tease.",
  "  Accurate and specific beats punchy-but-vague; never clickbait or a claim the",
  "  video doesn't support.",
  "- description: a genuine 2-4 paragraph summary a viewer would actually read —",
  "  what happened, why it matters, who's affected — grounded in the script.",
  "  Do not include a timestamp/chapter list; that is added separately. Do not",
  "  pad with generic channel boilerplate.",
  "- tags: short keyword phrases (not sentences) a viewer might search for.",
  "  Their TOTAL combined length (joined with commas) must stay under 480",
  "  characters, so keep the list focused rather than exhaustive.",
  "- hashtags: 3-6 words or shortphrases, no leading '#', ordered by relevance —",
  "  only the first few are shown prominently, so lead with the most specific one.",
].join("\n");

export interface MetadataPromptInput {
  script: Script;
  totalDurationSeconds: number;
  retryInstructions?: string;
}

export function buildMetadataPrompt(input: MetadataPromptInput): string {
  const { script, totalDurationSeconds, retryInstructions } = input;
  const minutes = (totalDurationSeconds / 60).toFixed(1);

  const parts = [
    `# Video title (working)`,
    script.title,
    ``,
    `# Duration`,
    `~${minutes} minutes`,
    ``,
    `# Segments (headline — excerpt of narration)`,
    ...script.segments.map((s, i) => `${i + 1}. ${s.headline} — "${excerpt(s.text)}"`),
  ];

  if (retryInstructions) {
    parts.push("", `# Fix and resubmit`, retryInstructions);
  }

  parts.push("", "Respond with the JSON object only — no prose, no markdown fence.");
  return parts.join("\n");
}

function excerpt(text: string, maxWords = 35): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : `${words.slice(0, maxWords).join(" ")}…`;
}
