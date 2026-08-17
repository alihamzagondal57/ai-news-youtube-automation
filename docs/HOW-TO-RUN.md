# How to run this yourself

This is the plain-language version: exactly what to open and click. It assumes n8n and the review-dashboard are already running on your machine (see "Starting things up" below) and R2 is configured (see "Before any of this works" — read that first if you haven't set R2 up yet).

## Before any of this works: R2 is required

Every workflow (n8n's own local writes, and every step that runs on GitHub Actions) needs a real, shared, network-reachable place to read and write job files — that's Cloudflare R2. Without it, nothing beyond the very first step can run.

**What you need to do, once:**
1. Cloudflare dashboard → R2 → **Create bucket** (any name, e.g. `ai-news-pipeline`).
2. R2 → **Manage API tokens** → **Create API token** with **Object Read & Write** permission scoped to that bucket.
3. Note down: **Account ID**, **Access Key ID**, **Secret Access Key**, and the bucket's **S3 endpoint URL** (shown on the token-creation screen).
4. Give me those four values (paste them in chat — I'll write them into `.env` and GitHub Secrets without ever echoing them back), or set them yourself:
   - In `.env` at the repo root: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`.
   - As GitHub repo secrets (Settings → Secrets and variables → Actions) with the same five names — every GitHub Actions workflow reads them from there, not from your local `.env`.
5. Restart n8n so it picks up the new `.env` values (n8n reads `R2_*` from its own process environment for the small local writes it does — job.json updates, trend.json, review-state.json).

Until this is done, a job will start and immediately fail at its first real write — that's expected, not a bug.

## Starting things up

Two things need to be running locally:

- **n8n** — the orchestrator. From the repo root:
  ```bash
  GITHUB_TOKEN=<your token> GITHUB_REPO=alihamzagondal57/ai-news-youtube-automation NODES_EXCLUDE='["n8n-nodes-base.localFileTrigger"]' n8n start
  ```
  Then open **http://localhost:5678** and log in (`operator@localhost.local` / `LocalOnly-Pipeline2026!` — this is a local-only login, not a real secret, already in the committed source).
- **review-dashboard** — where you review and approve finished videos. From the repo root:
  ```bash
  npx tsx apps/review-dashboard/server/src/index.ts
  ```
  and separately, the frontend:
  ```bash
  npm run dev --workspace=@ai-news/review-dashboard-frontend
  ```
  Open the URL Vite prints (typically **http://localhost:5173**).

## (a) Manual mode — you give it a topic

1. In the review-dashboard frontend, click **+ New job** (top right of the job list).
2. Type a **topic** (required) and optionally an **angle**.
3. Pick a **resolution** — 480p/720p/1080p/2K/4K. If you pick 4K without a dedicated render VM configured, a warning appears: 4K will render on GitHub's shared runner CPU, which is slow but does work.
4. Click **Start pipeline run**. You're redirected to a live status page that polls and shows which step is currently running.

Behind the scenes: the dashboard calls n8n's webhook, n8n writes the job's initial files, then dispatches each step (script, voiceover, captions, media, metadata, render, thumbnail) as a separate GitHub Actions run, waiting for each to finish before starting the next. Nothing heavy runs on your PC.

**Alternative: trigger manual mode directly from n8n**, without the dashboard — open the **Manual Mode - Full Pipeline** workflow in n8n, use the **On form submission** trigger's hosted form (n8n shows its URL, typically `http://localhost:5678/form/manual-mode-start`), fill in topic/angle/resolution there instead.

## (b) Auto mode — it picks a trending topic itself

The **Auto Mode - Full Pipeline** workflow in n8n runs on a daily schedule (06:00 by default — change this in the workflow's **Daily schedule** trigger node if you want a different time). It runs trend-research first (also on GitHub Actions) to pick a topic, then the same script→voiceover→...→thumbnail chain as manual mode.

To run it once immediately instead of waiting for the schedule: open the workflow in n8n and click **Execute workflow**.

**Important:** both `Manual Mode - Full Pipeline` and `Auto Mode - Full Pipeline` need to be **Published** in n8n (top-right "Publish" button in the editor) for their triggers (webhook / schedule) to actually listen. If you ever republish after an edit, do it for both.

## (c) How a finished video reaches you for approval

Once every step succeeds, the job's `currentStep` becomes `review` and it appears in the review-dashboard's job list automatically (no action needed — just refresh or wait for the list to poll). Open it to watch the real rendered video, see the generated title/description/thumbnail, and any fact-check warnings on individual segments.

- **Voice / Theme**: pick from the dropdown/swatches — theme applies instantly; voice needs a full re-render to take effect (a re-render isn't wired up from the dashboard yet — that's a manual re-run for now).
- **Approve**: click **Approve**. This flips the job's review status and (if you've set `N8N_APPROVAL_WEBHOOK_URL` in `.env` to n8n's `release-on-approval` webhook) automatically triggers `08-upload-youtube.yml` on GitHub Actions, which uploads the real video, sets the thumbnail, and applies the mandatory AI-content disclosure — all on GitHub's infrastructure, not your PC.
- **Reject**: marks it abandoned; nothing further happens.

## Quick reference

| What | Where |
|---|---|
| n8n | http://localhost:5678 |
| review-dashboard | http://localhost:5173 (frontend) / :4000 (API) |
| Manual-mode form (direct from n8n) | http://localhost:5678/form/manual-mode-start |
| GitHub Actions runs | https://github.com/alihamzagondal57/ai-news-youtube-automation/actions |
