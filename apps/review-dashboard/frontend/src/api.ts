// Mirrors apps/review-dashboard/server/src/{jobs,voices,themes,reviewState}.ts's
// response shapes. Duplicated rather than imported: this is a separate,
// browser-only TS project with no build-time link to the server workspace.

export interface JobSummary {
  jobId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClipSource {
  file: string;
  url: string;
}

export interface SegmentDetail {
  id: number;
  headline: string;
  text: string;
  visualCue: string;
  startSeconds: number;
  endSeconds: number;
  currentClip: ClipSource | null;
  alternatives: ClipSource[];
  /** Mechanical fact-check warnings (numbers/dates not found in the sources) — advisory, empty when nothing was flagged. */
  factCheckWarnings: string[];
}

export interface RenderStyle {
  captions?: { fontFamily?: string; fontSizePx?: number; color?: string; highlightColor?: string };
  ticker?: { backgroundColor?: string; textColor?: string; speedPxPerSecond?: number };
  lowerThird?: { backgroundColor?: string; textColor?: string; accentColor?: string };
}

export interface ReviewState {
  jobId: string;
  status: "awaiting-review" | "changes-requested" | "approved" | "rejected";
  voiceId: string | null;
  themeId: string | null;
  structureId: string | null;
  stylePresetId: string | null;
  style: RenderStyle;
  clipOverrides: Array<{ segmentId: number; file: string }>;
  reviewedBy: string | null;
  updatedAt: string;
}

export interface JobDetail {
  jobId: string;
  title: string;
  status: string;
  themeId: string;
  voiceId: string;
  segments: SegmentDetail[];
  renderUrl: string;
  thumbnailUrl: string;
  reviewState: ReviewState;
}

export interface ThemeCatalogEntry {
  id: string;
  name: string;
  accentColor: string;
  baseColor: string;
  surfaceColor: string;
}

export interface VoiceCatalogEntry {
  id: string;
  label: string;
  gender: string;
  locale: string;
  accent: string;
  engine: string;
  hasSample: boolean;
}

export type ResolutionPreset = "480p" | "720p" | "1080p" | "2k" | "4k";

export interface RenderCapability {
  hasRenderVm: boolean;
  resolutions: ResolutionPreset[];
}

export interface JobManifest {
  jobId: string;
  mode: "manual" | "auto";
  status: "pending" | "running" | "completed" | "failed";
  currentStep: string | null;
  niche: string;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listJobs: () => request<{ jobs: JobSummary[] }>("/jobs"),
  getJob: (jobId: string) => request<JobDetail>(`/jobs/${jobId}`),
  listThemes: () => request<{ themes: ThemeCatalogEntry[] }>("/themes"),
  listVoices: () => request<{ voices: VoiceCatalogEntry[] }>("/voices"),
  voiceSampleUrl: (voiceId: string) => `/api/voices/${voiceId}/sample`,

  patchReviewState: (jobId: string, patch: Partial<Pick<ReviewState, "voiceId" | "themeId" | "structureId" | "stylePresetId" | "style">>) =>
    request<ReviewState>(`/jobs/${jobId}/review-state`, { method: "PATCH", body: JSON.stringify(patch) }),

  setClipOverride: (jobId: string, segmentId: number, file: string) =>
    request<ReviewState>(`/jobs/${jobId}/clip-override`, { method: "PUT", body: JSON.stringify({ segmentId, file }) }),

  removeClipOverride: (jobId: string, segmentId: number) =>
    request<ReviewState>(`/jobs/${jobId}/clip-override/${segmentId}`, { method: "DELETE" }),

  approve: (jobId: string, reviewedBy?: string) =>
    request<ReviewState>(`/jobs/${jobId}/approve`, { method: "POST", body: JSON.stringify({ reviewedBy: reviewedBy ?? null }) }),

  reject: (jobId: string, reviewedBy?: string) =>
    request<ReviewState>(`/jobs/${jobId}/reject`, { method: "POST", body: JSON.stringify({ reviewedBy: reviewedBy ?? null }) }),

  getRenderCapability: () => request<RenderCapability>("/render-capability"),

  createJob: (input: { topic: string; angle?: string; resolution: ResolutionPreset }) =>
    request<{ jobId: string }>("/jobs", { method: "POST", body: JSON.stringify(input) }),

  getJobStatus: (jobId: string) => request<JobManifest>(`/jobs/${jobId}/status`),
};
