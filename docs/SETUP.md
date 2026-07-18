# Setup

## 1. Accounts & API keys needed
| Service | Used for | Free tier? |
|---|---|---|
| Anthropic (Claude API) | Script + metadata writing | Pay-as-you-go |
| Groq | Fallback script writing (`llama-3.3-70b`) | Free tier available |
| Firecrawl | Trending news discovery (auto mode) | Free tier available |
| Pexels API | Stock footage/photos | Free |
| Pixabay API | Stock footage/photos/audio | Free |
| Cloudflare R2 | Shared job artifact storage between steps | Free tier (10GB) |
| YouTube Data API v3 (Google Cloud project) | Upload | Free (quota-limited, ~6 uploads/day) |
| Oracle Cloud | Render VM (Always Free Ampere shape) | Free forever |
| n8n | Orchestration | Self-host free, or n8n Cloud paid |

Copy `.env.example` to `.env` and fill in every key above before running anything locally.

## 2. Local install
```bash
npm install            # Node workspaces: remotion, services/*, infra/render-server
pip install -r services/voiceover/requirements.txt
pip install -r services/caption-sync/requirements.txt
```

## 3. YouTube OAuth (one-time, interactive — never run in CI)
```bash
npm run youtube:oauth-setup --workspace=services/youtube-uploader
```
Produces a refresh token; put it in `YOUTUBE_REFRESH_TOKEN` (locally in `.env`, and as a GitHub Actions secret).

## 4. Provision the render VM
See [`infra/oracle-cloud/README.md`](../infra/oracle-cloud/README.md).

## 5. Import n8n workflows
Import `n8n/workflows/manual-mode.json` and `auto-mode.json` into your n8n instance, then fill in credentials for: GitHub (PAT with `workflow` scope), the render-server shared secret, and your notification channel of choice.

## 6. GitHub repo secrets
Set every key from `.env.example` as a GitHub Actions secret (Settings → Secrets and variables → Actions) — the pipeline workflows in `.github/workflows/` read them from there.
