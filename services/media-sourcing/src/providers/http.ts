/** Shared retry/backoff for both provider APIs — free tiers rate-limit, and a transient 429/5xx shouldn't fail the whole job. */
export async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  providerLabel: string,
  maxAttempts = 4,
): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = err as Error;
      await backoff(attempt);
      continue;
    }

    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      lastError = new Error(`${providerLabel} returned ${res.status} on attempt ${attempt}`);
      await backoff(attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined);
      continue;
    }

    // 4xx other than 429 (bad key, bad query) won't improve on retry.
    const body = await res.text().catch(() => "");
    throw new Error(`${providerLabel} request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  throw new Error(`${providerLabel} request failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

function backoff(attempt: number, explicitMs?: number): Promise<void> {
  const ms = explicitMs ?? Math.min(1000 * 2 ** (attempt - 1), 8000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
