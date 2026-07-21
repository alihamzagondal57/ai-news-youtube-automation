import Groq from "groq-sdk";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "./types.js";

export interface GroqProviderOptions {
  apiKey: string;
  model: string;
}

/**
 * Resilience fallback, not a quality peer.
 *
 * Used only when Claude is unavailable — an outage, a rate limit, a transient
 * API error. Output goes through exactly the same validation, so a weaker model
 * that restates its sources gets rejected rather than silently shipping a
 * lower-quality script.
 *
 * Uses JSON mode; Groq has no equivalent of Anthropic's structured outputs, so
 * the response is still parsed and schema-checked by the caller.
 */
export class GroqProvider implements ScriptProvider {
  readonly name = "groq";
  private readonly client: Groq;
  private readonly model: string;

  constructor(options: GroqProviderOptions) {
    this.client = new Groq({ apiKey: options.apiKey });
    this.model = options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      throw new Error(`Groq hit max_tokens (${request.maxTokens}) — the script was truncated mid-generation`);
    }

    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      throw new Error("Groq returned no text content");
    }

    return {
      text,
      model: completion.model ?? this.model,
      inputTokens: completion.usage?.prompt_tokens ?? null,
      outputTokens: completion.usage?.completion_tokens ?? null,
    };
  }
}
