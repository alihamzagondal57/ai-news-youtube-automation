import OpenAI from "openai";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "./types.js";

export interface OpenAICompatibleOptions {
  /** Provider id used in logs and diagnostics. */
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
  /** Output-token ceiling for THIS provider and plan. */
  maxTokens: number;
  /**
   * Some gateways reject `response_format: {type: "json_object"}` outright.
   * Where it's supported it materially reduces unparseable responses, so it is
   * on by default and disabled per-provider only where needed.
   */
  jsonMode?: boolean;
}

/**
 * One adapter for every OpenAI-compatible gateway — Groq, Cerebras, and GitHub
 * Models all speak the same wire protocol, so they differ only in base URL,
 * credential, model id and token ceiling.
 *
 * Keeping them behind a single implementation means a new gateway is a registry
 * entry rather than a new file, and any fix to error handling or truncation
 * detection lands for all of them at once.
 */
export class OpenAICompatibleProvider implements ScriptProvider {
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly jsonMode: boolean;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name;
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.jsonMode = options.jsonMode ?? true;
    // Two-phase generation fires many calls in quick succession (1 plan + N
    // segments), which trips free-tier per-minute limits. The SDK retries 429s
    // with exponential backoff; raise the ceiling so a transient rate limit is
    // ridden out rather than failing the whole script. A genuinely exhausted
    // quota still surfaces after the retries.
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 5 });
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Per-request format wins over the constructor default: the plan call wants
    // JSON, the per-segment prose calls want plain text (JSON mode shortens output).
    const wantJson = request.format ? request.format === "json" : this.jsonMode;
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(wantJson ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });

    const choice = completion.choices[0];

    // Truncation is a hard provider failure rather than a parse error: a script
    // cut off mid-sentence is not something a corrective retry can repair, and
    // silently accepting it would ship a short script.
    if (choice?.finish_reason === "length") {
      throw new Error(`${this.name} hit max_tokens (${this.maxTokens}) — output was truncated mid-generation`);
    }

    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      throw new Error(`${this.name} returned no text content`);
    }

    return {
      text,
      model: completion.model ?? this.model,
      inputTokens: completion.usage?.prompt_tokens ?? null,
      outputTokens: completion.usage?.completion_tokens ?? null,
    };
  }
}
