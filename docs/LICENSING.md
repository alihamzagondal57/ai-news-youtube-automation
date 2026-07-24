# Licensing & Terms-of-Use Compliance Audit

**Scope:** every external dependency (npm/PyPI) and every external service/API this
pipeline uses to produce a **monetized** YouTube channel. For each: license type,
whether commercial use / YouTube monetization is permitted, and any attribution or
restriction obligations.

**Audience:** a **solo creator** monetizing AI-generated news videos.

> Last audited: 2026-07-24. Licenses and SaaS terms change — re-verify the two
> 🔴 blockers and any 🟡 item against the linked source before launch. This
> document is an engineering audit, not legal advice.

---

## 1. Risk summary — read this first

| # | Item | Verdict | Why |
|---|---|---|---|
| 🔴 | **Remotion** (render engine) | **Blocker** | Free for a solo creator *by headcount*, but **an automated render pipeline requires the paid "Remotion for Automators" license regardless of team size** — and this project is exactly that. |
| 🔴 | **GitHub Models free tier** (primary script + metadata LLM) | **Blocker** | GitHub's own docs scope the free tier to **prototyping/experimentation, not production**. Using it to produce monetized videos is outside its terms. |
| 🟡 | **Edge TTS** (`edge-tts` path) | **Remove** | Undocumented Microsoft "Read Aloud" endpoint; **no public terms permit commercial/programmatic use**. Already blocked on datacenter IPs. Unlicensed path — delete it. |
| 🟡 | **Pexels / Pixabay footage** | **Use with rules** | Free for commercial use, no attribution — **but** identifiable people, logos/brands, and buildings can carry third-party rights the stock license does **not** clear. Editorial rules below. |
| 🟡 | **Pixabay / stock music** | **Use with rules** | Free in a larger work (not standalone). Can trigger YouTube **Content ID** claims — keep the license record to clear them. |
| 🟡 | **Google Gemini free tier** | **Avoid in prod** | Free (unpaid) tier allows Google to use your data and is not positioned for production; currently disabled in our chain anyway. |
| 🟡 | **Firecrawl** (trend research) | **OK, with care** | Paid SaaS, commercial use fine. Risk is the **source articles' copyright** — we must extract *facts*, never reproduce article text (already enforced by the script verbatim check). |
| 🟢 | **Kokoro-82M + kokoro-js** (primary TTS) | **Clear** | Apache-2.0 model trained on permissive audio; Apache-2.0 library. Generated audio is unrestricted for commercial use. |
| 🟢 | **ffmpeg-static** (GPL-3.0 build) | **Clear for our use** | We *run* ffmpeg as a tool; its output is not a derivative work and we don't redistribute the binary. GPL obligations would only attach if we shipped the binary. |
| 🟢 | **YouTube Data API v3** | **Clear, with disclosure** | Uploading our own content is permitted; synthetic-media disclosure is already set on every upload. |
| 🟢 | All other libraries (SDKs, AWS S3, Whisper, sharp, React, etc.) | **Clear** | Permissive (MIT / Apache-2.0). Details in §4. |

**Bottom line:** two things must change before monetized launch — **pay for a
Remotion Automators license** (or switch renderer) and **stop using GitHub
Models' free tier for production** (pay-as-you-go or a different provider). Both
are cheaper to fix now than after a strike or an audit.

---

## 2. Action items (do before monetizing)

1. **Remotion — license the automation.** Purchase **Remotion for Automators**
   ($0.01/render, $100/month minimum spend per Remotion's published terms) *or*
   move the render step to a non-Remotion, permissively-licensed renderer. See §3.1.
2. **Script/metadata LLM — leave the GitHub Models free tier.** Switch the
   production provider to a path whose terms permit production use: **paid GitHub
   Models (pay-as-you-go)**, **Anthropic Claude** (paid; adapter already in the
   registry), or another provider whose free tier explicitly allows commercial
   production. Keep GitHub Models free only for local prototyping. See §3.2.
3. **Delete the Edge TTS engine + voices.** It is an unlicensed path for
   commercial use and is blocked on datacenter IPs. Kokoro is the primary and
   the rotation pool is already Kokoro-only, so removal costs nothing in
   production. See §3.3.
4. **Adopt the stock-media editorial rules** (§3.4) in `media-sourcing` and keep
   writing the per-asset license record into `media-manifest.json`.

---

## 3. The flagged items in detail

### 3.1 🔴 Remotion — automation requires a paid license

Remotion is **source-available, not open source** (Remotion License, not MIT). Two
independent rules decide whether you pay:

- **Headcount:** free for individuals and for-profit orgs up to 3 people.
- **Use case:** *"If you are setting up an automation to render videos
  programmatically, you need to purchase Renders."* Owning code that calls
  `renderMedia()`, `npx remotion render`, `<Player>`, or the Lambda/cloud render
  APIs makes the use case **"Remotion for Automators" — regardless of team size.**

This project renders programmatically from GitHub Actions (`renderMedia` in
`infra/render-server`), so the **automation rule applies even for a solo
creator**. The free/individual tier does **not** cover it.

- **Compliant path A — pay:** Remotion for Automators, **$0.01/render** with a
  **$100/month minimum**. At our volume (a handful of renders/day) the per-render
  cost is trivial; the $100 floor is the real number to budget.
- **Compliant path B — replace:** move rendering to a permissively-licensed stack
  (e.g. compositing directly with ffmpeg, or an MIT/Apache renderer). Larger
  engineering cost, zero recurring license fee. Only worth it if the $100/month
  minimum is prohibitive pre-revenue.

**Recommendation:** budget the Automators license for launch (path A). Re-evaluate
path B only if render licensing becomes the dominant cost. Verify current numbers
at <https://www.remotion.pro/license> before committing.

### 3.2 🔴 GitHub Models free tier — prototyping only

GitHub's documentation is explicit: *"you can use GitHub Models to find and
experiment with AI models for free. Once you are ready to bring your application
to production, [opt in to paid usage]."* The free tier is scoped to
experimentation/prototyping; the 8K-in/4K-out limits reinforce that. Using it as
the **production** script/metadata generator for a monetized channel is outside
its intended terms.

This matters most because GitHub Models `gpt-4o` is our **primary** script
provider (and the metadata generator uses "the same LLM").

- **Compliant path A:** enable **GitHub Models paid (pay-as-you-go)** on the same
  account — same models, terms then cover production.
- **Compliant path B:** switch the production chain to **Anthropic Claude**
  (paid; `claude-opus-4-8` adapter already ranked first when `ANTHROPIC_API_KEY`
  is set) or another provider whose terms permit commercial production. Our
  multi-provider registry makes this a config change, not a rewrite.

**Recommendation:** for launch, run production on a **paid** provider (Claude is
already wired and highest-quality; or GitHub Models PAYG if cost-optimizing).
Keep the GitHub Models free key strictly for local prototyping/tests. The
qualification harness and quality bar are provider-independent, so quality does
not regress.

### 3.3 🟡→ delete Edge TTS

`edge-tts` calls Microsoft Edge's **undocumented** "Read Aloud" endpoint with
short-lived anti-abuse tokens. Microsoft publishes **no terms granting
commercial or programmatic use**; community guidance only says *personal* use is
unlikely to be a legal problem. For a **monetized** product that is an
unacceptable gray area — and the endpoint already **403s from datacenter IPs**
(verified from the dev sandbox and a GitHub `ubuntu-latest` runner), so it can't
run in the pipeline regardless.

**Recommendation: remove the Edge engine and Edge voices from the codebase**
(`services/voiceover/src/engines/edge.ts`, the `edge` entries in `voices.ts`, the
`edge` branch of engine resolution, and the probe workflow). Kokoro is the
primary and the rotation pool is Kokoro-only, so nothing in production depends on
Edge. Keeping it invites accidental use of an unlicensed path. (If a
higher-naturalness *local, personal* option is ever wanted, it can be added back
behind an explicit non-production flag — but not shipped in the monetized
pipeline.)

### 3.4 🟡 Stock media — the real restrictions

Pexels and Pixabay both grant **royalty-free commercial use with no attribution**
for content embedded in a larger work (our video). Neither grants rights to
**things depicted in** the content:

- **Identifiable people.** Neither platform verifies model releases. Do not use a
  clip of an identifiable person in a way that implies they are part of the news
  story, endorses anything, or shows them unfavorably — that risks false-light /
  defamation / publicity-rights claims independent of the stock license. For a
  news channel this is the sharpest edge: **prefer generic, non-identifying
  B-roll** (buildings, wide crowds, hands, screens, skylines) over close-ups of
  identifiable faces tied to a named subject.
- **Logos, brands, trademarks.** The license does not grant trademark rights.
  Incidental appearance in editorial B-roll is generally fine; do **not** imply a
  brand endorses the video, and don't build the thumbnail/branding around a
  third-party mark.
- **Buildings/architecture** (Pixabay flags these explicitly) can carry property
  rights in some jurisdictions.
- **No standalone redistribution.** Fine — we always embed in a rendered video.

**Music/SFX (Pixabay Audio):** usable in commercial video **as part of a larger
work**, not distributed standalone. Some tracks trigger **YouTube Content ID**
claims; these are cleared by showing the Pixabay license. **Keep the per-asset
license record in `media-manifest.json`** (source, license type, URL) as the
standing proof — the pipeline already does this; treat it as mandatory, not
optional.

**Pexels/Pixabay API terms** (distinct from the content license): don't mirror or
compete with their libraries, and credit Pexels/photographer where technically
feasible. On-screen credit isn't required for embedded video use, but keeping the
source URL in the manifest satisfies the spirit and eases any dispute.

### 3.5 🟢 ffmpeg-static (GPL-3.0) — fine for how we use it

`ffmpeg-static` ships **GPL-3.0-or-later** static builds (gyan.dev on Windows,
John Van Sickle on Linux). GPL matters when you **distribute** the binary or link
it into distributed software. We do neither: the pipeline **invokes ffmpeg as a
command-line tool** to transcode our own audio/video. FFmpeg's *output* is not a
derivative work of FFmpeg, so **the videos carry no GPL obligation**, and running
a GPL program server-side is unrestricted.

- **Only caveat:** if we ever ship a downloadable app that *bundles* this binary,
  GPL source-offer obligations attach. Not our case (server-side CI + render VM).
- If we ever want to avoid GPL entirely, swap to an **LGPL** ffmpeg build; not
  necessary today.

---

## 4. Full dependency inventory

### Libraries (npm / PyPI)

| Package | License | Commercial / monetization | Notes |
|---|---|---|---|
| `remotion`, `@remotion/*` | Remotion License (source-available) | ⚠️ **Paid for automations** | See §3.1. |
| `ffmpeg-static` (ffmpeg binary) | GPL-3.0-or-later | ✅ (we run it, don't ship it) | See §3.5. |
| `ffprobe-static` | MIT (wrapper) / ffprobe GPL binary | ✅ same reasoning as ffmpeg | Probing our own files. |
| `kokoro-js` | Apache-2.0 | ✅ | Primary TTS runtime. |
| Kokoro-82M weights | Apache-2.0 | ✅ | Trained on permissive audio; see §5. |
| `edge-tts` path (`ws` client to Edge) | ⚠️ no license for the *service* | ❌ commercial | Remove — §3.3. (`ws` itself is MIT.) |
| `@anthropic-ai/sdk` | MIT | ✅ | Claude adapter. |
| `openai` | Apache-2.0 | ✅ | OpenAI-compatible providers. |
| `@google/genai` | Apache-2.0 | ✅ | Gemini adapter (service terms differ — §5). |
| `@aws-sdk/client-s3` | Apache-2.0 | ✅ | Talks to Cloudflare R2. |
| `faster-whisper` + Whisper weights | MIT | ✅ | Transcribes our own audio. |
| `sharp` | Apache-2.0 (libvips LGPL-3.0) | ✅ | Thumbnail compositing. |
| `express`, `pino`, `pino-pretty` | MIT | ✅ | Render server / logging. |
| `zod`, `dotenv`, `ws`, `react`, `react-dom` | MIT | ✅ | Utilities / Remotion UI. |
| `pydantic`, `boto3` | MIT / Apache-2.0 | ✅ | Python services. |
| `s3rver` | MIT | ✅ (dev/test only) | In-process S3 for smoke tests; never in prod. |
| `tsx`, `typescript`, `@types/*` | MIT / Apache-2.0 | ✅ | Build/dev tooling. |

### External services / APIs

| Service | Role | Commercial / monetization | Notes |
|---|---|---|---|
| **Remotion (Automators)** | Rendering | ⚠️ **paid license required** | §3.1. |
| **GitHub Models (free)** | Script + metadata LLM | ❌ **prototyping only** | §3.2 — switch to paid/other for prod. |
| **Anthropic Claude** | LLM (paid) | ✅ | Commercial use permitted; you retain rights to outputs. Highest-quality path. |
| **Google Gemini (AI Studio free)** | LLM fallback | ⚠️ avoid in prod | Free tier lets Google use your data; not for production. Paid tier has protections. Currently disabled in our chain. |
| **Cerebras / Mistral / OpenRouter (free)** | LLM fallbacks | ⚠️ check per-provider | Disabled in our chain today; if enabled, verify each free tier permits commercial production before relying on it. |
| **Firecrawl** | Trend research (scraping) | ✅ service; ⚠️ source copyright | §1 — extract facts, never reproduce article text. |
| **Pexels API** | Stock footage/photos | ✅ with rules | §3.4. |
| **Pixabay API** | Footage + music + SFX | ✅ with rules | §3.4; keep license records. |
| **YouTube Data API v3** | Upload | ✅ with disclosure | Own content; `containsSyntheticMedia` set on every upload (mandatory since 2025-05-21). |
| **Cloudflare R2** | Storage | ✅ | Standard commercial cloud storage terms. |

---

## 5. Notes on AI-model provenance & outputs

- **Kokoro-82M (voice):** Apache-2.0 weights, trained *"exclusively on
  permissive/non-copyrighted audio."* Generated audio is unrestricted for
  commercial use — no voice-likeness or attribution strings attached. This is the
  cleanest AI component in the stack and a key reason it's the primary TTS.
- **LLM outputs (script/metadata):** commercial ownership of outputs depends on
  the **provider** used, not the SDK. Anthropic (paid) and OpenAI/Azure (paid)
  grant you rights to outputs for commercial use. The *content* obligation is
  ours: the script must add original insight and not reproduce source text — the
  reason the `script-generator` verbatim/novelty/insight checks exist (see
  `services/script-generator/README.md`). This is both a monetization-policy and
  a copyright safeguard.
- **Whisper (captions):** transcribing our *own* synthetic audio — no third-party
  rights involved.
- **YouTube synthetic-media disclosure:** set on every upload from
  `metadata.json.containsSyntheticMedia` (default true). Non-negotiable and
  already wired end-to-end.

---

## 6. Sources

- Remotion license / automation rule: <https://www.remotion.dev/docs/license/faq>,
  <https://www.remotion.pro/license>, <https://www.remotion.dev/docs/license/pricing>
- GitHub Models scope (prototyping vs production):
  <https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models>,
  <https://github.blog/changelog/2025-06-24-github-models-now-supports-moving-beyond-free-limits/>
- Pexels license: <https://www.pexels.com/license/>,
  <https://help.pexels.com/hc/en-us/articles/900005880463>
- Pixabay content license: <https://pixabay.com/service/license-summary/>,
  <https://pixabay.com/blog/posts/how-to-clear-a-youtube-content-id-claim-with-a-pix-190/>
- Edge TTS commercial-use ambiguity:
  <https://learn.microsoft.com/en-au/answers/questions/5925556/>,
  <https://github.com/rany2/edge-tts>
- Kokoro-82M license/provenance: <https://huggingface.co/hexgrad/Kokoro-82M>
- ffmpeg-static build (GPL): <https://github.com/eugeneware/ffmpeg-static>
