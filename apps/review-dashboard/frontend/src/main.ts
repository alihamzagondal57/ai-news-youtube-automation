import "./style.css";
import { api, type JobDetail, type ResolutionPreset, type ThemeCatalogEntry, type VoiceCatalogEntry } from "./api";

const app = document.getElementById("app")!;

function statusPillHtml(status: string): string {
  return `<span class="pill ${status}">${status.replace(/-/g, " ")}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ── Router: #/ (job list), #/new (start a job), or #/job/:jobId (review) ────
function route(): void {
  const hash = location.hash.replace(/^#/, "");
  if (hash === "/new") {
    renderNewJobView();
    return;
  }
  const jobMatch = hash.match(/^\/job\/(.+)$/);
  const runningMatch = hash.match(/^\/running\/(.+)$/);
  if (jobMatch) {
    renderReviewView(decodeURIComponent(jobMatch[1]));
  } else if (runningMatch) {
    renderRunningView(decodeURIComponent(runningMatch[1]));
  } else {
    renderJobList();
  }
}
window.addEventListener("hashchange", route);

// ── Job list ─────────────────────────────────────────────────────────────
async function renderJobList(): Promise<void> {
  app.innerHTML = `
    <header class="app-header">
      <h1>Jobs awaiting review</h1>
      <div class="header-actions">
        <div class="auto-mode-toggle">
          <span>Auto mode</span>
          <div class="switch" id="auto-mode-switch" title="Loading…"></div>
        </div>
        <a href="#/new" class="button-link">+ New job</a>
      </div>
    </header>
    <div id="job-list-container">Loading…</div>
  `;
  wireAutoModeToggle();
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

function wireAutoModeToggle(): void {
  const switchEl = document.getElementById("auto-mode-switch") as HTMLDivElement;
  let current: boolean | null = null;
  let busy = false;

  const render = () => {
    switchEl.classList.toggle("on", current === true);
    switchEl.classList.toggle("disabled", busy || current === null);
    switchEl.title =
      current === null
        ? "Could not reach n8n to check auto-mode's status"
        : current
          ? "Auto mode is ON — click to turn off"
          : "Auto mode is OFF — click to turn on";
  };

  api
    .getAutoModeStatus()
    .then(({ active }) => {
      current = active;
      render();
    })
    .catch(() => render());

  switchEl.addEventListener("click", async () => {
    if (busy || current === null) return;
    busy = true;
    render();
    try {
      const { active } = await api.setAutoModeActive(!current);
      current = active;
    } catch (err) {
      switchEl.title = `Failed to change auto-mode: ${(err as Error).message}`;
    } finally {
      busy = false;
      render();
    }
  });
}

// ── New job ──────────────────────────────────────────────────────────────
const RESOLUTION_LABELS: Record<ResolutionPreset, string> = {
  "480p": "480p (854×480)",
  "720p": "720p (1280×720)",
  "1080p": "1080p (1920×1080) — default",
  "2k": "2K (2560×1440)",
  "4k": "4K (3840×2160)",
};

/**
 * Rough total-time estimate per resolution, shown on the New job screen.
 * script (~5min) + voiceover (~10min) + captions (~2min) + media (~1min) +
 * metadata (~1min) + thumbnail (~1min) is resolution-independent — only
 * render scales with pixel count. The fixed-steps figure and the 1080p
 * render figure are both real measurements from an actual end-to-end run on
 * GitHub's shared runners (a ~14.5min video: ~26min of fixed steps, ~2h02m
 * render). Every other resolution's render time is that 1080p figure scaled
 * by pixel-count ratio (480p/720p/2K/4K vs 1080p's 1920×1080) — an
 * extrapolation, not a separate measurement, since only 1080p has actually
 * been timed end-to-end so far.
 */
const RESOLUTION_ESTIMATES: Record<ResolutionPreset, string> = {
  "480p": "45 minutes – 1 hour",
  "720p": "1 – 1.5 hours",
  "1080p": "2 – 3 hours",
  "2k": "3.5 – 5 hours",
  "4k": "7 – 10 hours",
};

async function renderNewJobView(): Promise<void> {
  app.innerHTML = `
    <a href="#/" class="back-link">&larr; All jobs</a>
    <header class="app-header"><h1>New job</h1></header>
    <div class="panel">
      <div class="field-row"><label>Topic</label><input type="text" id="new-job-topic" placeholder="What should this video be about?" style="flex:1"></div>
      <div class="field-row"><label>Angle</label><input type="text" id="new-job-angle" placeholder="optional — defaults to the topic"></div>
      <div class="field-row">
        <label>Resolution</label>
        <select id="new-job-resolution">
          ${Object.entries(RESOLUTION_LABELS)
            .map(([id, label]) => `<option value="${id}" ${id === "1080p" ? "selected" : ""}>${escapeHtml(label)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="job-meta" id="new-job-estimate"></div>
      <div id="new-job-4k-warning" class="fact-check-warning" style="display:none">
        <span class="fact-check-warning-title">⚠ No render VM configured</span> — 4K will render locally on this machine's CPU, which is impractically slow. It will still work, just expect a long render.
      </div>
      <div class="action-row">
        <button class="primary" id="new-job-start-btn">Start pipeline run</button>
      </div>
      <div class="status-line" id="new-job-status"></div>
    </div>
  `;

  const resolutionSelect = document.getElementById("new-job-resolution") as HTMLSelectElement;
  const warning = document.getElementById("new-job-4k-warning")!;
  const estimateEl = document.getElementById("new-job-estimate")!;
  const startBtn = document.getElementById("new-job-start-btn") as HTMLButtonElement;
  const statusEl = document.getElementById("new-job-status")!;

  let hasRenderVm = true; // fail open — don't warn if the capability check itself fails
  try {
    ({ hasRenderVm } = await api.getRenderCapability());
  } catch {
    // ignore — warning just won't show
  }

  const updateWarning = () => {
    const resolution = resolutionSelect.value as ResolutionPreset;
    warning.style.display = resolution === "4k" && !hasRenderVm ? "block" : "none";
    estimateEl.textContent =
      `Estimated: ${RESOLUTION_ESTIMATES[resolution]} (rough — actual time depends mainly on how long the ` +
      `generated script turns out to be, which varies per topic)`;
  };
  resolutionSelect.addEventListener("change", updateWarning);
  updateWarning();

  startBtn.addEventListener("click", async () => {
    const topic = (document.getElementById("new-job-topic") as HTMLInputElement).value.trim();
    const angle = (document.getElementById("new-job-angle") as HTMLInputElement).value.trim();
    if (!topic) {
      statusEl.textContent = "Topic is required.";
      statusEl.style.color = "var(--accent)";
      return;
    }
    startBtn.disabled = true;
    statusEl.textContent = "Starting pipeline run…";
    statusEl.style.color = "var(--text-muted)";
    try {
      const { jobId } = await api.createJob({
        topic,
        angle: angle || undefined,
        resolution: resolutionSelect.value as ResolutionPreset,
      });
      location.hash = `/running/${encodeURIComponent(jobId)}`;
    } catch (err) {
      statusEl.textContent = `Failed to start: ${(err as Error).message}`;
      statusEl.style.color = "var(--accent)";
      startBtn.disabled = false;
    }
  });
}

// ── Running-job progress (polls job.json until it reaches the review gate) ──
function renderRunningView(jobId: string): void {
  app.innerHTML = `
    <a href="#/" class="back-link">&larr; All jobs</a>
    <header class="app-header"><h1>Pipeline running</h1></header>
    <div class="panel">
      <div class="job-meta">${escapeHtml(jobId)}</div>
      <div id="running-status" class="status-line">Starting…</div>
    </div>
  `;
  const statusEl = document.getElementById("running-status")!;

  const poll = async () => {
    try {
      const manifest = await api.getJobStatus(jobId);
      if (manifest.status === "failed") {
        statusEl.textContent = `Failed at ${manifest.currentStep ?? "?"}: ${manifest.error ?? "unknown error"}`;
        statusEl.style.color = "var(--accent)";
        return;
      }
      if (manifest.currentStep === "review" && manifest.status === "completed") {
        statusEl.textContent = "Reached the review gate — redirecting…";
        location.hash = `/job/${encodeURIComponent(jobId)}`;
        return;
      }
      statusEl.textContent = `Running: ${manifest.currentStep ?? "…"}`;
      setTimeout(poll, 4000);
    } catch (err) {
      statusEl.textContent = `Lost track of job status: ${(err as Error).message} — retrying…`;
      setTimeout(poll, 4000);
    }
  };
  poll();
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
          <div class="fact-check-warning">
            <span class="fact-check-warning-title">⚠ Changing voice does not re-render automatically</span> — the video
            you see above still has the OLD voice until you manually re-run these GitHub Actions workflows, in
            order, for this exact job ID (<code>${escapeHtml(job.jobId)}</code>), waiting for each to finish before
            starting the next:
            <ol style="margin:8px 0 0 20px; padding:0;">
              <li><code>03 - Generate Voiceover</code></li>
              <li><code>04 - Sync Captions</code></li>
              <li><code>07 - Render</code></li>
              <li><code>07b - Generate Thumbnail</code></li>
            </ol>
            On each workflow's page on GitHub, click <strong>Run workflow</strong>, paste the job ID above into the
            box, then click the green <strong>Run workflow</strong> button. No coding or terminal needed — just
            GitHub's own website. Refresh this page once thumbnail generation finishes to see the updated video.
          </div>
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
          ${
            job.segments.some((s) => s.factCheckWarnings.length > 0)
              ? `<div class="fact-check-warning">
                  <span class="fact-check-warning-title">⚠ ${job.segments.filter((s) => s.factCheckWarnings.length > 0).length} segment(s) have unverified claims</span> — see highlighted segments below before approving.
                </div>`
              : ""
          }
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
      ${
        s.factCheckWarnings.length > 0
          ? `<div class="fact-check-warning">
              <span class="fact-check-warning-title">⚠ Unverified against sources — check before publishing:</span>
              <ul>${s.factCheckWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
            </div>`
          : ""
      }
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
      const previouslySelected = grid.querySelector<HTMLDivElement>(".theme-swatch.selected");

      // Apply on click, not on server confirmation — a theme pick should feel
      // instant. Reverted below only if the save itself fails.
      grid.querySelectorAll(".theme-swatch").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
      setStatus("Theme applied — saving… (a full re-render is required for this to take effect)");
      try {
        await api.patchReviewState(job.jobId, { themeId });
        setStatus("Theme saved. A full re-render is needed for it to take effect.");
      } catch (err) {
        swatch.classList.remove("selected");
        previouslySelected?.classList.add("selected");
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
