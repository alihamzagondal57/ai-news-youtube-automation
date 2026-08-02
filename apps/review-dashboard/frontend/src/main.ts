import "./style.css";
import { api, type JobDetail, type ThemeCatalogEntry, type VoiceCatalogEntry } from "./api";

const app = document.getElementById("app")!;

function statusPillHtml(status: string): string {
  return `<span class="pill ${status}">${status.replace(/-/g, " ")}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ── Router: #/ (job list) or #/job/:jobId (review view) ─────────────────────
function route(): void {
  const hash = location.hash.replace(/^#/, "");
  const match = hash.match(/^\/job\/(.+)$/);
  if (match) {
    renderReviewView(decodeURIComponent(match[1]));
  } else {
    renderJobList();
  }
}
window.addEventListener("hashchange", route);

// ── Job list ─────────────────────────────────────────────────────────────
async function renderJobList(): Promise<void> {
  app.innerHTML = `
    <header class="app-header"><h1>Jobs awaiting review</h1></header>
    <div id="job-list-container">Loading…</div>
  `;
  const container = document.getElementById("job-list-container")!;
  try {
    const { jobs } = await api.listJobs();
    if (jobs.length === 0) {
      container.innerHTML = `<div class="empty-state">Nothing parked at the review gate right now.</div>`;
      return;
    }
    container.innerHTML = `<ul class="job-list">${jobs
      .map(
        (j) => `
      <li data-job-id="${escapeHtml(j.jobId)}">
        <div>
          <div class="job-title">${escapeHtml(j.title)}</div>
          <div class="job-meta">${escapeHtml(j.jobId)} · created ${new Date(j.createdAt).toLocaleString()}</div>
        </div>
        ${statusPillHtml(j.status)}
      </li>`,
      )
      .join("")}</ul>`;
    container.querySelectorAll<HTMLLIElement>("li[data-job-id]").forEach((li) => {
      li.addEventListener("click", () => {
        location.hash = `/job/${encodeURIComponent(li.dataset.jobId!)}`;
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load jobs: ${escapeHtml((err as Error).message)}</div>`;
  }
}

// ── Review view ──────────────────────────────────────────────────────────
async function renderReviewView(jobId: string): Promise<void> {
  app.innerHTML = `<a href="#/" class="back-link">&larr; All jobs</a><div id="review-container">Loading…</div>`;
  const container = document.getElementById("review-container")!;

  let job: JobDetail;
  let themes: ThemeCatalogEntry[];
  let voices: VoiceCatalogEntry[];
  try {
    [job, { themes }, { voices }] = await Promise.all([api.getJob(jobId), api.listThemes(), api.listVoices()]);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load job: ${escapeHtml((err as Error).message)}</div>`;
    return;
  }

  const style = job.reviewState.style;

  container.innerHTML = `
    <header class="app-header">
      <h1>${escapeHtml(job.title)}</h1>
      ${statusPillHtml(job.reviewState.status)}
    </header>

    <div class="review-layout">
      <div>
        <video class="preview" id="preview-video" src="${job.renderUrl}" controls></video>

        <div class="panel">
          <h2>Scenes</h2>
          <div id="segments"></div>
        </div>
      </div>

      <div>
        <div class="panel">
          <h2>Voice</h2>
          <div class="field-row">
            <label>Narrator</label>
            <select id="voice-select">
              ${voices.map((v) => `<option value="${v.id}" ${v.id === job.voiceId ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}
            </select>
            <button id="voice-preview-btn">Preview</button>
          </div>
          <audio id="voice-preview-audio" style="display:none"></audio>
        </div>

        <div class="panel">
          <h2>Theme</h2>
          <div class="theme-grid" id="theme-grid">
            ${themes
              .map(
                (t) => `
              <div class="theme-swatch ${t.id === job.themeId ? "selected" : ""}" data-theme-id="${t.id}"
                   style="background: linear-gradient(135deg, ${t.baseColor}, ${t.surfaceColor} 60%, ${t.accentColor})"
                   title="${escapeHtml(t.name)}"></div>`,
              )
              .join("")}
          </div>
        </div>

        <div class="panel">
          <h2>Text overlay style</h2>
          <div class="field-row"><label>Caption color</label><input type="color" id="style-caption-color" value="${style.captions?.color ?? "#ffffff"}"></div>
          <div class="field-row"><label>Caption highlight</label><input type="color" id="style-caption-highlight" value="${style.captions?.highlightColor ?? "#ffffff"}"></div>
          <div class="field-row"><label>Ticker background</label><input type="color" id="style-ticker-bg" value="${style.ticker?.backgroundColor ?? "#151a24"}"></div>
          <div class="field-row"><label>Ticker text</label><input type="color" id="style-ticker-text" value="${style.ticker?.textColor ?? "#ffffff"}"></div>
          <div class="field-row"><label>Lower-third bg</label><input type="color" id="style-lt-bg" value="${style.lowerThird?.backgroundColor ?? "#151a24"}"></div>
          <div class="field-row"><label>Lower-third text</label><input type="color" id="style-lt-text" value="${style.lowerThird?.textColor ?? "#ffffff"}"></div>
          <div class="field-row"><label>Accent</label><input type="color" id="style-lt-accent" value="${style.lowerThird?.accentColor ?? "#e11d2e"}"></div>
          <button id="apply-style-btn">Apply style</button>
        </div>

        <div class="panel">
          <h2>Decision</h2>
          <div class="field-row"><label>Reviewed by</label><input type="text" id="reviewed-by" placeholder="optional name"></div>
          <div class="action-row">
            <button class="primary" id="approve-btn">Approve</button>
            <button class="danger" id="reject-btn">Reject</button>
          </div>
        </div>

        <div class="status-line" id="status-line"></div>
      </div>
    </div>
  `;

  renderSegments(job);
  wireVoicePanel(job);
  wireThemePanel(job);
  wireStylePanel(job);
  wireDecisionPanel(job);
}

function setStatus(message: string, isError = false): void {
  const el = document.getElementById("status-line");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "var(--accent)" : "var(--text-muted)";
}

function renderSegments(job: JobDetail): void {
  const el = document.getElementById("segments")!;
  el.innerHTML = job.segments
    .map(
      (s) => `
    <div class="segment" data-segment-id="${s.id}">
      <div class="segment-head">
        <span class="segment-headline">${escapeHtml(s.headline)}</span>
        <span class="segment-time">${s.startSeconds.toFixed(1)}s &ndash; ${s.endSeconds.toFixed(1)}s</span>
      </div>
      <div class="segment-text">${escapeHtml(s.text)}</div>
      <div class="clip-row">
        ${s.currentClip ? `<video class="clip-thumb current" src="${s.currentClip.url}" muted loop playsinline title="Current clip"></video>` : ""}
        ${s.alternatives
          .map(
            (a) =>
              `<video class="clip-thumb" src="${a.url}" muted loop playsinline data-swap-segment="${s.id}" data-swap-file="${escapeHtml(a.file)}" title="Click to use this clip"></video>`,
          )
          .join("")}
      </div>
    </div>`,
    )
    .join("");

  el.querySelectorAll<HTMLVideoElement>("video.clip-thumb").forEach((v) => v.play().catch(() => {}));

  el.querySelectorAll<HTMLVideoElement>("video[data-swap-segment]").forEach((v) => {
    v.addEventListener("click", async () => {
      const segmentId = Number(v.dataset.swapSegment);
      const file = v.dataset.swapFile!;
      setStatus("Saving clip swap…");
      try {
        await api.setClipOverride(job.jobId, segmentId, file);
        setStatus(`Segment ${segmentId} clip swapped. Trigger a re-render to see it in the video.`);
        const refreshed = await api.getJob(job.jobId);
        job.segments = refreshed.segments;
        job.reviewState = refreshed.reviewState;
        renderSegments(job);
      } catch (err) {
        setStatus(`Failed to swap clip: ${(err as Error).message}`, true);
      }
    });
  });
}

function wireVoicePanel(job: JobDetail): void {
  const select = document.getElementById("voice-select") as HTMLSelectElement;
  const previewBtn = document.getElementById("voice-preview-btn") as HTMLButtonElement;
  const audio = document.getElementById("voice-preview-audio") as HTMLAudioElement;

  select.addEventListener("change", async () => {
    setStatus("Saving voice selection… (a full re-render is required for this to take effect)");
    try {
      await api.patchReviewState(job.jobId, { voiceId: select.value });
      setStatus("Voice saved. A full re-render (voiceover -> captions -> render) is needed for it to take effect.");
    } catch (err) {
      setStatus(`Failed to save voice: ${(err as Error).message}`, true);
    }
  });

  previewBtn.addEventListener("click", () => {
    audio.src = api.voiceSampleUrl(select.value);
    audio.play().catch((err) => setStatus(`Couldn't play sample: ${err.message}`, true));
  });
}

function wireThemePanel(job: JobDetail): void {
  const grid = document.getElementById("theme-grid")!;
  grid.querySelectorAll<HTMLDivElement>(".theme-swatch").forEach((swatch) => {
    swatch.addEventListener("click", async () => {
      const themeId = swatch.dataset.themeId!;
      setStatus("Saving theme override… (a full re-render is required for this to take effect)");
      try {
        await api.patchReviewState(job.jobId, { themeId });
        grid.querySelectorAll(".theme-swatch").forEach((s) => s.classList.remove("selected"));
        swatch.classList.add("selected");
        setStatus("Theme saved. A full re-render is needed for it to take effect.");
      } catch (err) {
        setStatus(`Failed to save theme: ${(err as Error).message}`, true);
      }
    });
  });
}

function wireStylePanel(job: JobDetail): void {
  const btn = document.getElementById("apply-style-btn")!;
  btn.addEventListener("click", async () => {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    const style = {
      captions: { color: val("style-caption-color"), highlightColor: val("style-caption-highlight") },
      ticker: { backgroundColor: val("style-ticker-bg"), textColor: val("style-ticker-text") },
      lowerThird: { backgroundColor: val("style-lt-bg"), textColor: val("style-lt-text"), accentColor: val("style-lt-accent") },
    };
    setStatus("Saving style… (a re-render is required for this to take effect)");
    try {
      await api.patchReviewState(job.jobId, { style });
      setStatus("Style saved. A re-render is needed for it to take effect.");
    } catch (err) {
      setStatus(`Failed to save style: ${(err as Error).message}`, true);
    }
  });
}

function wireDecisionPanel(job: JobDetail): void {
  const reviewedByInput = document.getElementById("reviewed-by") as HTMLInputElement;
  const approveBtn = document.getElementById("approve-btn") as HTMLButtonElement;
  const rejectBtn = document.getElementById("reject-btn") as HTMLButtonElement;

  approveBtn.addEventListener("click", async () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    setStatus("Approving…");
    try {
      await api.approve(job.jobId, reviewedByInput.value || undefined);
      setStatus("Approved — released to youtube-uploader.");
      await renderReviewView(job.jobId);
    } catch (err) {
      setStatus(`Approve failed: ${(err as Error).message}`, true);
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  });

  rejectBtn.addEventListener("click", async () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    setStatus("Rejecting…");
    try {
      await api.reject(job.jobId, reviewedByInput.value || undefined);
      setStatus("Rejected.");
      await renderReviewView(job.jobId);
    } catch (err) {
      setStatus(`Reject failed: ${(err as Error).message}`, true);
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  });
}

// Service worker registration is auto-injected by vite-plugin-pwa
// (registerType: "autoUpdate") into the built output — nothing to wire here.
route();
