# How to run this yourself

No coding, no terminal commands. Everything below is "open this," "click that."

## 1. Start everything

1. Open the project's main folder (the one with `start-pipeline.bat` in it).
2. Double-click **`start-pipeline.bat`**.
3. A window titled "AI News Pipeline - Launcher" opens and prints a few lines while it starts things up. This takes up to about a minute the first time.
4. Up to three more black windows open — these are the actual pipeline running. **Leave them open.** You can minimize them, but closing any of them stops that part of the pipeline.
5. Your browser opens automatically to the dashboard once everything is ready. If it doesn't, go to **http://localhost:5173** yourself.
6. The launcher window prints "You can close THIS window now" — that one (only that one) is safe to close; it's not one of the three running services.

That's it. Everything — the pipeline orchestrator, the review dashboard, and its web page — now runs on your own computer, and the heavy work (writing the script, generating the voice, rendering the video) happens on GitHub's servers, not your PC.

**Re-running the script is always safe.** If some of it is already running, `start-pipeline.bat` notices and skips those parts — it won't open duplicates.

## 2. If something isn't responding

Just double-click `start-pipeline.bat` again. That fixes the large majority of "the page won't load" or "nothing's happening" situations, because it checks each piece and restarts only what's actually stopped.

If that doesn't help:

1. Look at the three black windows for red error text. That usually tells you what's wrong (for example, a missing internet connection).
2. Close all three black windows (and the launcher window, if it's still open), then double-click `start-pipeline.bat` again for a clean restart.
3. Still stuck? Restart your computer and double-click `start-pipeline.bat` once more. This clears out anything stuck in a bad state.
4. If it says it can't find `.env`, don't move or rename `start-pipeline.bat` — keep it in the project's main folder.

## 3. Making a video with your own topic (manual mode)

1. In the dashboard (**http://localhost:5173**), click **+ New job**.
2. Type a **topic** — whatever you want the video to be about.
3. Optionally, type an **angle** (a specific take or focus for the topic). You can leave this blank.
4. Pick a **resolution**. 1080p is the default and a safe choice; higher resolutions (2K/4K) take much longer to finish since they render on GitHub's shared computers, not a dedicated fast machine.
5. Click **Start pipeline run**.
6. You're taken to a status page that updates itself and shows which step is currently running (script → voiceover → captions → media → metadata → render → thumbnail).

You don't need to do anything else — leave the tab open or close it, the job keeps running either way. It typically takes roughly 30–90 minutes depending on the topic length and resolution; 1080p renders are the slowest single step, sometimes over an hour.

## 4. How auto mode works

Auto mode is designed to run by itself every day at a set time (06:00 by default) — it picks its own trending topic, then goes through the exact same steps as a manual job (script, voiceover, captions, media, metadata, render, thumbnail).

**As of 2026-08-18, this daily schedule is not actually turned on yet** — the workflow exists but hasn't been published in n8n, so nothing will happen on its own until you do this once:

1. Open n8n at **http://localhost:5678** and log in (`operator@localhost.local` / `LocalOnly-Pipeline2026!` — this login only works from your own computer, it's not a real secret).
2. Open the **Auto Mode - Full Pipeline** workflow.
3. Click **Publish** near the top right. From then on, it fires automatically every day — you don't need to repeat this.

To trigger a run right now instead of waiting for the daily schedule (works whether or not you've published it):

1. Same login as above.
2. Open the **Auto Mode - Full Pipeline** workflow.
3. Click **Execute workflow** near the top.

Either way — scheduled or manually triggered — the finished video lands in the review dashboard exactly like a manual job does (see below).

## 5. Reviewing and approving a finished video

1. Open the dashboard (**http://localhost:5173**). Finished videos show up automatically in the job list as **"awaiting review"** — no action needed to make them appear, just open the page.
2. Click a job to open it. You'll see the full script broken into scenes, the actual rendered video, the generated title/description, and the thumbnail.
3. Some scenes may show a **"⚠ Unverified against sources"** note — this flags specific numbers or dates the AI couldn't confirm against its source material. Worth a quick read before approving; it doesn't mean the video is wrong, just that those specific claims haven't been double-checked.
4. If you want to swap a clip in any scene, click **"Click to use this clip"** under any of the alternatives shown.
4b. If you want a different narrator voice, pick one from the **Voice** dropdown. This saves your choice, but — unlike a clip swap — **it does not update the video you're looking at.** The panel explains exactly what to do: open GitHub Actions and manually run, in order, `03 - Generate Voiceover`, `04 - Sync Captions`, `07 - Render`, then `07b - Generate Thumbnail`, pasting this job's ID into each one's "Run workflow" box and waiting for each to finish before starting the next. No coding needed, just clicking through GitHub's own website — but it does take a while (mostly the render step). Refresh the dashboard page once thumbnail generation finishes.
5. When you're happy with it, click **Approve**. This automatically uploads the real video to YouTube, sets the thumbnail, and applies the required AI-content disclosure — all in the background on GitHub's servers, nothing further for you to do. The video is published as **Public**.
6. If a video isn't good enough to publish, click **Reject** instead — it's marked abandoned and nothing further happens with it.

## 6. Installing the dashboard as its own app (optional)

You can make the review dashboard open like a real desktop app — its own window, its own icon — instead of a browser tab:

1. Open **http://localhost:5173** in **Chrome** or **Edge** (not the launcher's automatic window, a real browser).
2. Look at the right side of the address bar for an install icon (a little monitor-with-arrow icon), or open the browser's menu (⋮) and look for **"Install Review Dashboard..."**.
3. Click it, then click **Install** in the confirmation popup.
4. The dashboard now has its own icon on your desktop / Start menu, and opens in its own window from now on — no address bar, no browser tabs.

You still need `start-pipeline.bat` running in the background for the installed app to work — installing it as an app just changes how you open it, not what it needs to run.

## Quick reference

| What | Where |
|---|---|
| Start everything | Double-click `start-pipeline.bat` |
| Dashboard (where you review and approve) | http://localhost:5173 |
| n8n (only needed to trigger auto mode manually) | http://localhost:5678 |
| GitHub Actions (see the real progress of each step, if curious) | https://github.com/alihamzagondal57/ai-news-youtube-automation/actions |

## Appendix: one-time setup (already done — for reference only)

Everything below was already configured for this project. You should never need to touch it unless you're setting this up fresh on a new computer.

- **Cloudflare R2** (the shared storage every step reads/writes to) — bucket created, credentials saved in `.env` and as GitHub repo secrets.
- **GitHub token** (`GITHUB_TOKEN` in `.env`) — lets n8n start GitHub Actions runs on your behalf.
- **YouTube upload credentials** (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_CHANNEL_ID`) — set as GitHub repo secrets so `08-upload-youtube.yml` can authenticate.
- **Approval webhook** (`N8N_APPROVAL_WEBHOOK_URL` in `.env`) — tells review-dashboard's Approve button where to notify n8n. Without this, Approve only updates the dashboard's own record of the job and nothing actually uploads (this was broken until 2026-08-18 — see git history on this file's directory for the fix).
- **n8n workflows published** — a workflow only listens for its trigger (webhook / schedule) while it shows **Active** in n8n. Currently published: `Manual Mode - Full Pipeline` and `Release on Approval`. **`Auto Mode - Full Pipeline` is NOT currently published** — its daily schedule will not fire until you open it in n8n and click **Publish**. If you ever edit any of these workflows yourself, click **Publish** again afterward or it'll stop working.
- **Node.js, n8n, and project dependencies installed** on this computer — `start-pipeline.bat` assumes these are already in place; it starts things, it doesn't install them.
