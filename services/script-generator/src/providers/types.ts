export interface CompletionRequest {
  system: string;
  user: string;
  /**
   * "json" asks the gateway for a JSON object (via response_format /
   * responseMimeType where supported); "text" asks for plain prose.
   *
   * This matters for length, not just parsing: JSON mode measurably suppresses
   * output length (models ration a total budget across fields), so the
   * per-segment prose calls use "text" and only the short plan call uses "json".
   * Default "json" preserves the single-call behaviour for any caller that
   * doesn't set it.
   */
  format?: "json" | "text";
}

export interface CompletionResult {
  /** Raw model text; the caller extracts and parses whatever it expects from it. */
  text: string;
  /** Which model actually produced it, for provenance in logs and job records. */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * One provider = one model behind one call. Kept this narrow so generation
 * logic never branches on provider, and so tests can inject a fake without
 * touching the network.
 *
 * Output-token ceilings are deliberately NOT part of the request: they are a
 * property of the provider and its plan, not of the script being written. A
 * global ceiling either over-requests and trips free-tier request-size limits
 * (measured: Groq returns 413 for a 32k ask) or under-requests and truncates a
 * model that could have gone longer. Each provider owns its own.
 */
export interface ScriptProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
