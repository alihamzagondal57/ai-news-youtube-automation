import { GoogleGenAI } from "@google/genai";
import type { CompletionRequest, CompletionResult, ScriptProvider } from "./types.js";

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  /** Output-token ceiling for THIS provider and plan. */
  maxTokens: number;
}

/**
 * Google Gemini via AI Studio.
 *
 * Not OpenAI-compatible, so it needs its own adapter: the system prompt is a
 * separate `systemInstruction` rather than a message with role "system", and
 * JSON output is requested through `responseMimeType` instead of
 * `response_format`.
 */
export class GeminiProvider implements ScriptProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxTokens = options.maxTokens;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: this.maxTokens,
        responseMimeType: "application/json",
      },
    });

    const candidate = response.candidates?.[0];
    // MAX_TOKENS means the script was cut off; a hard failure for the same
    // reason as an OpenAI-compatible `length` finish.
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error(`gemini hit maxOutputTokens (${this.maxTokens}) — output was truncated mid-generation`);
    }
    if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") {
      throw new Error(`gemini blocked the request (${candidate.finishReason})`);
    }

    const text = response.text ?? "";
    if (!text.trim()) {
      throw new Error("gemini returned no text content");
    }

    return {
      text,
      model: response.modelVersion ?? this.model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    };
  }
}
