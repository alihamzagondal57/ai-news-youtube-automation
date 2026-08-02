import { reviewStateSchema, type JobStore, type ReviewState } from "@ai-news/shared";

const REVIEW_STATE_FILE = "review-state.json";

function emptyReviewState(jobId: string): ReviewState {
  return reviewStateSchema.parse({ jobId, status: "awaiting-review", updatedAt: new Date().toISOString() });
}

/** review-state.json if it exists, or a fresh "awaiting-review" default — a job parked at the review gate for the first time has no file yet, and that's the ordinary case, not an error. */
export async function getReviewState(store: JobStore, jobId: string): Promise<ReviewState> {
  const existing = await store.getJsonIfExists(store.jobKey(jobId, REVIEW_STATE_FILE), reviewStateSchema);
  return existing ?? emptyReviewState(jobId);
}

export interface ReviewStatePatch {
  voiceId?: string | null;
  themeId?: string | null;
  structureId?: string | null;
  stylePresetId?: string | null;
  style?: ReviewState["style"];
}

/** Shallow-merges the given fields on top of whatever review-state.json currently holds (or the empty default), and persists the result. Never touches clipOverrides — see upsertClipOverride/removeClipOverride, which have array-upsert semantics instead of replace. */
export async function patchReviewState(store: JobStore, jobId: string, patch: ReviewStatePatch): Promise<ReviewState> {
  const current = await getReviewState(store, jobId);
  const next = reviewStateSchema.parse({ ...current, ...patch, jobId, updatedAt: new Date().toISOString() });
  await store.putJson(store.jobKey(jobId, REVIEW_STATE_FILE), next);
  return next;
}

export async function upsertClipOverride(store: JobStore, jobId: string, segmentId: number, file: string): Promise<ReviewState> {
  const current = await getReviewState(store, jobId);
  const clipOverrides = [...current.clipOverrides.filter((o) => o.segmentId !== segmentId), { segmentId, file }];
  const next = reviewStateSchema.parse({ ...current, jobId, clipOverrides, updatedAt: new Date().toISOString() });
  await store.putJson(store.jobKey(jobId, REVIEW_STATE_FILE), next);
  return next;
}

export async function removeClipOverride(store: JobStore, jobId: string, segmentId: number): Promise<ReviewState> {
  const current = await getReviewState(store, jobId);
  const clipOverrides = current.clipOverrides.filter((o) => o.segmentId !== segmentId);
  const next = reviewStateSchema.parse({ ...current, jobId, clipOverrides, updatedAt: new Date().toISOString() });
  await store.putJson(store.jobKey(jobId, REVIEW_STATE_FILE), next);
  return next;
}

/** The single event that releases a job to youtube-uploader (see docs/REVIEW-DASHBOARD.md) — youtube-uploader refuses to run until this flips review-state.json.status to "approved". */
export async function setReviewStatus(
  store: JobStore,
  jobId: string,
  status: "approved" | "rejected",
  reviewedBy: string | null,
): Promise<ReviewState> {
  const current = await getReviewState(store, jobId);
  const next = reviewStateSchema.parse({ ...current, jobId, status, reviewedBy, updatedAt: new Date().toISOString() });
  await store.putJson(store.jobKey(jobId, REVIEW_STATE_FILE), next);
  return next;
}
