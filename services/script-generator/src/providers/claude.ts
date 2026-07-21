import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "./types.js";

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  /** Thinking depth / token spend. Script writing is quality-critical, so this defaults high. */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Output-token ceiling; shared with adaptive thinking on this model family. */
  maxTokens: number;
}

/**
 * Primary provider.
 *
 * Streams rather than using a plain create(): a 20-minute script plus adaptive
 * thinking runs well past the point where a non-streaming request risks an HTTP
 * timeout, and the SDK's own guidance is to stream anything with a large
 * max_tokens.
 *
 * Adaptive thinking is set explicitly — on this model family, omitting the
 * `thinking` field runs with no thinking at all, which is the wrong default for
 * work that has to weigh sources and construct analysis.
 */
export class ClaudeProvider implements ScriptProvider {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: ClaudeProviderOptions["effort"];
  private readonly maxTokens: number;

  constructor(options: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
    this.effort = options.effort;
    this.maxTokens = options.maxTokens;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort },
      // The system prompt is fixed across every video; only the user turn
      // varies, so this prefix is worth caching.
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request.user }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new Error(`Claude refused the request (${message.stop_details?.category ?? "unknown"})`);
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        `Claude hit max_tokens (${this.maxTokens}) before finishing — the script was truncated mid-generation`,
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text.trim()) {
      throw new Error("Claude returned no text content");
    }

    return {
      text,
      model: message.model,
      inputTokens: message.usage.input_tokens ?? null,
      outputTokens: message.usage.output_tokens ?? null,
    };
  }
}
