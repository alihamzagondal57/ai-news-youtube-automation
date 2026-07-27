import { config, requireApiKey } from "../config.js";
import type { Candidate } from "../types.js";
import { fetchJsonWithRetry } from "./http.js";

/** Shapes verified against a live `GET /videos/search` response (2026-07). */
interface PexelsVideoFile {
  width: number;
  height: number;
  link: string;
  size: number;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  tags?: string[];
  user?: { name?: string };
  video_files: PexelsVideoFile[];
}
interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

/**
 * Pexels' `tags` field is frequently empty in practice (verified live), so the
 * page-URL slug — Pexels puts a human-written description there, e.g.
 * ".../video/cyclist-passing-european-parliament-building-28743038/" — is a
 * real second source of matchable text, not a fallback for a broken field.
 */
function slugWords(pageUrl: string): string[] {
  const slug = pageUrl.replace(/\/$/, "").split("/").pop() ?? "";
  return slug
    .replace(/-\d+$/, "") // trailing numeric id
    .split("-")
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2);
}

/** Closest rendition to config.targetWidth without exceeding it; if every file exceeds it, the smallest available. */
function pickRendition(files: PexelsVideoFile[]): PexelsVideoFile {
  const mp4 = files.filter((f) => f.file_type === "video/mp4");
  const usable = mp4.length > 0 ? mp4 : files;
  const withinTarget = usable.filter((f) => f.width <= config.targetWidth);
  const pool = withinTarget.length > 0 ? withinTarget : usable;
  return pool.reduce((best, f) => (f.width > best.width ? f : best));
}

function toCandidate(video: PexelsVideo): Candidate | null {
  if (video.video_files.length === 0) return null;
  const rendition = pickRendition(video.video_files);
  return {
    provider: "pexels",
    id: String(video.id),
    pageUrl: video.url,
    previewImage: video.image,
    width: rendition.width,
    height: rendition.height,
    durationSeconds: video.duration,
    downloadUrl: rendition.link,
    fileSizeBytes: rendition.size,
    tags: [...(video.tags ?? []).map((t) => t.toLowerCase()), ...slugWords(video.url)],
    user: video.user?.name ?? "",
  };
}

export async function searchPexels(query: string): Promise<Candidate[]> {
  const key = requireApiKey("PEXELS_API_KEY");
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${config.perPageSearch}&orientation=landscape`;
  const json = (await fetchJsonWithRetry(url, { headers: { Authorization: key } }, "pexels")) as PexelsSearchResponse;
  return (json.videos ?? []).map(toCandidate).filter((c): c is Candidate => c !== null);
}
