import { config, requireApiKey } from "../config.js";
import type { Candidate } from "../types.js";
import { fetchJsonWithRetry } from "./http.js";

/** Shapes verified against a live `GET /api/videos/` response (2026-07). */
interface PixabayRendition {
  url: string;
  width: number;
  height: number;
  size: number;
}
interface PixabayHit {
  id: number;
  tags: string; // comma-separated, e.g. "brexit, eu, trade, britain"
  duration: number;
  pageURL: string;
  user: string;
  videos: { large?: PixabayRendition; medium?: PixabayRendition; small?: PixabayRendition; tiny?: PixabayRendition };
}
interface PixabaySearchResponse {
  hits: PixabayHit[];
}

/** Pixabay's own rendition sizes are fixed (large 1080p / medium 720p / small 540p / tiny 360p); pick the largest at or under the target width. */
function pickRendition(videos: PixabayHit["videos"]): PixabayRendition | null {
  for (const key of ["large", "medium", "small", "tiny"] as const) {
    const rendition = videos[key];
    if (rendition && rendition.width <= config.targetWidth) return rendition;
  }
  return videos.large ?? videos.medium ?? videos.small ?? videos.tiny ?? null;
}

function toCandidate(hit: PixabayHit): Candidate | null {
  const rendition = pickRendition(hit.videos);
  if (!rendition) return null;
  return {
    provider: "pixabay",
    id: String(hit.id),
    pageUrl: hit.pageURL,
    previewImage: rendition.url.replace(/\.mp4$/, ".jpg"),
    width: rendition.width,
    height: rendition.height,
    durationSeconds: hit.duration,
    downloadUrl: rendition.url,
    fileSizeBytes: rendition.size,
    tags: hit.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    user: hit.user,
  };
}

export async function searchPixabay(query: string): Promise<Candidate[]> {
  const key = requireApiKey("PIXABAY_API_KEY");
  const url =
    `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}` +
    `&per_page=${config.perPageSearch}&safesearch=true&video_type=film`;
  const json = (await fetchJsonWithRetry(url, {}, "pixabay")) as PixabaySearchResponse;
  return (json.hits ?? []).map(toCandidate).filter((c): c is Candidate => c !== null);
}
