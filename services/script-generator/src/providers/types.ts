export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface CompletionResult {
  /** Raw model text; the caller extracts and parses JSON from it. */
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
 */
export interface ScriptProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
