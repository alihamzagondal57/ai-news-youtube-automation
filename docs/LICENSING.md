# Licensing & Terms-of-Use Compliance Audit

**Scope:** every external dependency (npm/PyPI) and every external service/API this
pipeline uses to produce a **monetized** YouTube channel. For each: license type,
whether commercial use / YouTube monetization is permitted, and any attribution or
restriction obligations.

**Audience:** a **solo creator** monetizing AI-generated news videos.

> Last audited: 2026-07-28 (FLUX.1 [schnell] + Hugging Face Inference
> Providers added, §3.6). Licenses and SaaS terms change — re-verify the two
> 🔴 blockers and any 🟡 item against the linked source before launch. This
> document is an engineering audit, not legal advice.

---

## 1. Risk summary — read this first

| # | Item | Verdict | Why |
|---|---|---|---|
| 🔴 | **Remotion** (render engine) | **Blocker** | Free for a solo creator *by headcount*, but **an automated render pipeline requires the paid "Remotion for Automators" license regardless of team size** — and this project is exactly that. |
| 🔴 | **GitHub Models free tier** (primary script + metadata LLM) | **Blocker** | GitHub's own docs scope the free tier to **prototyping/experimentation, not production**. Using it to produce monetized videos is outside its terms. |
| ✅ | **Edge TTS** (`edge-tts` path) | **Removed** | Undocumented Microsoft "Read Aloud" endpoint; **no public terms permit commercial/programmatic use**; blocked on datacenter IPs. **Deleted** from the codebase — Kokoro is the sole production TTS. |
| 🟡 | **Pexels / Pixabay footage** | **Use with rules** | Free for commercial use, no attribution — **but** identifiable people, logos/brands, and buildings can carry third-party rights the stock license does **not** clear. Editorial rules below. |
| 🟡 | **Pixabay / stock music** | **Use with rules** | Free in a larger work (not standalone). Can trigger YouTube **Content ID** claims — keep the license record to clear them. |
| 🟡 | **Google Gemini free tier** | **Avoid in prod** | Free (unpaid) tier allows Google to use your data and is not positioned for production; currently disabled in our chain anyway. |
| 🟡 | **Firecrawl** (trend research) | **OK, with care** | Paid SaaS, commercial use fine. Risk is the **source articles' copyright** — we must extract *facts*, never reproduce article text (already enforced by the script verbatim check). |
| 🟡 | **Hugging Face Inference Providers** (FLUX.1 [schnell] thumbnail image) | **Cheap paid, not free at our volume** | No contractual "prototyping only" ban like GitHub Models — but the free credit ($0.10/month) covers only ~30 images with zero retry margin. Treat as a ~$0.10–1/month paid service, not a free one. |
| 🟢 | **Kokoro-82M + kokoro-js** (primary TTS) | **Clear** | Apache-2.0 model trained on permissive audio; Apache-2.0 library. Generated audio is unrestricted for commercial use. |
| 🟢 | **FLUX.1 [schnell]** (thumbnail background image model) | **Clear** | Unmodified Apache-2.0 license (verified against the actual LICENSE file, not a summary) — commercial use of the model and its generated images is unrestricted. |
| 🟢 | **ffmpeg-static** (GPL-3.0 build) | **Clear for our use** | We *run* ffmpeg as a tool; its output is not a derivative work and we don't redistribute the binary. GPL obligations would only attach if we shipped the binary. |
| 🟢 | **YouTube Data API v3** | **Clear, with disclosure** | Uploading our own content is permitted; synthetic-media disclosure is already set on every upload. |
| 🟢 | All other libraries (SDKs, AWS S3, Whisper, sharp, React, etc.) | **Clear** | Permissive (MIT / Apache-2.0). Details in §4. |

**Bottom line:** two unresolved blockers remain before monetized launch.
**(1) Remotion:** confirm the automation license question with Remotion directly
(their docs are self-contradictory for the solo case); if it applies and $100/mo
is unaffordable, migrating to a permissive renderer is a major project. **(2) The
production LLM:** no free hosted tier is commercially compliant, so the realistic
choices are self-hosting an Apache-2.0 model (free, but quality vs. our bar is
unproven and must be trialed) or a cheap paid API. Both are cheaper to resolve
now than after a strike or an audit. (Edge TTS — the third flag — is already
removed.)

---

## 2. Action items (do before monetizing)

1. **Remotion — confirm the license, then decide.** Its own docs and pricing page
   disagree for the solo-automation case; get a written answer from Remotion
   before spending effort. If Automators genuinely applies and the $100/month
   minimum is unaffordable, the compliant escape is a **major** migration to a
   permissive renderer (Revideo, MIT). Don't migrate on spec. See §3.1.
2. **Script/metadata LLM — no free hosted tier is compliant.** GitHub Models,
   Mistral, Gemini, OpenRouter, and DeepSeek free tiers are all prototyping/
   non-commercial (and most train on your data). The genuinely-free compliant
   path is **self-hosting an Apache-2.0/MIT model** (Qwen2.5-14B) via the existing
   OpenAI-compatible adapter — **but its quality against our strict bar is
   unproven and must be trialed**. Otherwise a cheap **paid** API. See §3.2.
3. **[DONE] Deleted the Edge TTS engine + voices** — unlicensed for commercial
   use and blocked on datacenter IPs; Kokoro is the sole production TTS. See §3.3.
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
  **$100/month minimum**. Per-render cost is trivial at our volume; the $100 floor
  is the real number.
- **Compliant path B — replace with a permissively-licensed renderer.** The
  strongest candidate is **Revideo** (MIT, a Motion Canvas fork *"specifically
  designed for commercial automation pipelines"* with a render API and template
  system). **Motion Canvas** (MIT) also works but its headless/automated
  rendering is rougher. Pure-ffmpeg compositing is possible but can't express the
  themed motion graphics/transitions without huge effort.

**Verification (2026-07-24), because the stakes are high and Remotion's own pages
disagree:**

- The **docs FAQ** (the most specific source) is strict: an automation is *"owning
  code that programmatically calls"* `renderMedia()` etc., and *"if you are
  setting up an automation to render videos programmatically, you need to purchase
  Renders"* — **with no free threshold**, and it does not exempt a solo individual.
  By this text, our pipeline needs Automators.
- The **pricing page** (`remotion.pro/license`) frames eligibility by *headcount*
  ("individuals and companies up to 3 people" free), which reads as if a solo
  creator is covered. It does not clearly address the solo-**automation** case.
- These are genuinely inconsistent for our exact situation (one person, no
  company, automated, monetized). The safe reading is the stricter FAQ.

**Recommendation:**
1. **Get a written determination from Remotion** before spending engineering
   effort — email them / ask on Discord, describe the exact case (solo, no
   company, automated GitHub Actions render, monetized own channel). This is free
   and definitive; the docs alone are ambiguous.
2. If they confirm Automators applies **and** $100/month is not affordable
   pre-revenue: migrating to **Revideo (MIT)** is the compliant escape — but scope
   it as a **major rewrite**, not a swap. Our entire composition layer
   (`remotion/src`: themed React components, captions, lower-third, ticker,
   transitions) and the render orchestration (`infra/render-server`:
   `renderSegmented`, `segmentPlan`, chunk cache, targeted re-render — all on
   `@remotion/renderer` + `@remotion/bundler`) are Remotion-specific. Revideo uses
   Motion Canvas's scene-graph API, not React components, so the composition is
   rewritten from scratch. It is the single largest module in the project.
3. **Do not migrate on spec.** Confirm the license answer first; only migrate if
   forced.

Verify current numbers/terms at <https://www.remotion.pro/license> and
<https://www.remotion.dev/docs/license/faq>.

### 3.2 🔴 GitHub Models free tier — prototyping only

GitHub's documentation is explicit: *"you can use GitHub Models to find and
experiment with AI models for free. Once you are ready to bring your application
to production, [opt in to paid usage]."* The free tier is scoped to
experimentation/prototyping; the 8K-in/4K-out limits reinforce that. Using it as
the **production** script/metadata generator for a monetized channel is outside
its intended terms.

This matters most because GitHub Models `gpt-4o` is our **primary** script
provider (and the metadata generator uses "the same LLM").

**Is any FREE hosted tier both compliant and good enough? Verified (2026-07-24):**
No — the major free API tiers are uniformly scoped to prototyping/non-commercial
use, and most also train on your inputs:

| Free tier | Commercial production? | Trains on your data? | Verdict |
|---|---|---|---|
| GitHub Models | ❌ *"experiment… once you are ready to bring your application to production, opt in to paid usage"* | — | prototyping only |
| Mistral "Experiment" (free) | ❌ evaluation/prototyping, "not production" | ⚠️ yes on free; opt-out only on paid | not compliant |
| Google Gemini (free) | ❌ sources: not for revenue-generating use | ⚠️ yes on free (opt-out); paid/Vertex don't | not compliant |
| OpenRouter `:free` models | ❌ "not recommended for production"; per-provider terms vary | ⚠️ some providers train on inputs | not compliant/unreliable |
| DeepSeek API (free) | ❌ "restricted to personal, academic, or non-commercial projects" | ⚠️ yes | not compliant (paid tier is commercial) |

So the free hosted route is a dead end for a monetized product. Note Mistral
*passed our quality bar* (the-explainer 428–455 words) and only failed on rate
limits — but its **free** terms are prototyping-only regardless, so throttling it
would not make it compliant. That leaves three real options:

- **Path A — pay per use (cheap).** DeepSeek **paid** (~$0.14/1M output) or
  GitHub Models **pay-as-you-go** or **Anthropic Claude** (`claude-opus-4-8`,
  already ranked first when `ANTHROPIC_API_KEY` is set; ~$0.10–0.15/script,
  highest quality). Our multi-provider registry makes this a config change.
- **Path B — self-host an open-weight model (genuinely free + clean, the Kokoro
  playbook).** An **Apache-2.0 / MIT** model's *weights license* grants
  commercial use of its outputs with no ToS and no per-call cost. Best CPU-viable
  candidates: **Qwen2.5-14B-Instruct** (Apache-2.0) or **-7B**; **Mistral-Nemo**
  (Apache-2.0); **DeepSeek** distills (MIT). Avoid Llama (its community license
  isn't OSI-free). **Architecture fit is excellent:** Ollama/llama.cpp/vLLM expose
  an OpenAI-compatible `/v1` endpoint, so this is **one new registry entry**
  (`baseURL` → localhost), not a rewrite — the same adapter Groq/Cerebras/GitHub
  use. The qualification harness can test it directly.
  - **Reality check — speed:** CPU inference is slow. ~9 tok/s for a 4-bit 7B on a
    6-core desktop; a 2-core GitHub runner is slower. A full two-phase script is
    ~4,000–6,000 output tokens → roughly **10–25 min/script on CPU** plus retries.
    Fine at low volume; a GPU on the render VM would remove the pain.
  - **Reality check — quality (the real risk):** our bar is strict (novelty,
    <8-word verbatim runs, insight coverage, per-segment word bands). gpt-4o
    clears it; a 7–14B open model is materially weaker at instruction-following
    and sustaining insight+length, so it **may** pass with two-phase + retries or
    **may** fail novelty/insight consistently. **Unproven — it must be measured,
    not assumed.**

**Recommendation:** since paying isn't currently an option, **run an empirical
trial of Path B before committing**: install Ollama, pull `qwen2.5:14b-instruct`
(Apache-2.0), add a `local` provider entry pointing the OpenAI-compatible adapter
at `http://localhost:11434/v1`, and run `qualify-providers.mts` against the same
strict bar. If it passes → we have a compliant, free, zero-ToS primary that runs
on the render VM like Kokoro. **If it does not pass, the honest conclusion is
that free-and-compliant-and-good-enough does not currently exist**, and the
channel needs either a cheap paid API (Path A) or better self-host hardware
(a 32B model / a GPU). I will not recommend shipping a free tier whose terms
forbid it, nor claim a small CPU model matches gpt-4o without measuring it.

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

### 3.6 🟡 FLUX.1 [schnell] + Hugging Face Inference Providers (thumbnail image)

Two genuinely separate questions here, same lesson as GitHub Models (§3.2): a
model's *weights license* and the *API service's* terms are independent, and
both have to clear.

**The model — clear.** Fetched the actual license file (not a summary):
[`model_licenses/LICENSE-FLUX1-schnell`](https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell)
in Black Forest Labs' own repo is the **standard, unmodified Apache 2.0
license** — no extra clauses layered on top (unlike FLUX.1-dev, which is a
separate non-commercial license requiring a paid license for commercial use).
Apache-2.0 grants unrestricted commercial use of the model and everything it
generates, with no attribution requirement toward end viewers.

**The API service — not a contractual blocker, but not free at our volume
either.** Read Hugging Face's actual **Supplemental Terms for Inference
Services** (effective 2025-04-28) directly as a PDF, plus their current
pricing docs:

- No clause restricts the Inference Providers service to
  prototyping/evaluation — unlike GitHub Models, there is **no** "opt in to
  paid usage once you're ready for production" ToS language here.
- But "Inference API" as a flat free tier no longer really exists: requests
  now route through third-party providers (fal, Replicate, Together, etc.)
  who bill **per request**, and a free HF account gets **$0.10/month in
  credits ("subject to change")**. At FLUX.1-schnell's typical per-image cost
  via those providers (~$0.003/image), that's **~30 images/month with zero
  margin for a bad generation needing a retry**.
- Hugging Face's own docs frame exceeding the free credit as what "ensures
  uninterrupted access to models for **production workloads**" — their own
  mental model is free = trial, paid = production, not free = forbidden.

**Verdict:** no compliance risk in using it, but calling it "free at
production volume" would be inaccurate. It's realistically a **cheap paid
service** (≈$0.003–0.01/image) that happens to start with a small trial
credit — the same shape of decision as the LLM problem in §3.2, just at a much
smaller absolute cost. Also checked fal.ai's own ToS directly (one of the
providers HF can route to): customer retains ownership of generated outputs,
commercial use is fine, no extra restriction beyond the model's own license.

**Current implementation choice:** per explicit instruction, the free credit
is used as-is with **no payment method configured** — `HUGGINGFACE_API_TOKEN`
is optional, and thumbnail-generator falls back to its own real-frame/
theme-gradient backdrop (unchanged from before this feature) whenever
generation is unavailable — missing token, exhausted credit, rate limit, or
any other failure. See `services/thumbnail-generator/README.md`. If volume
ever grows past what the free credit covers, adding a payment method is a
config change, not a code change — HF bills the same token automatically
once the free credit runs out.

Note also checked and ruled out: **self-hosting FLUX.1-schnell** (the
Kokoro/Whisper playbook, §3.2 Path B) isn't practical here the way it is for
TTS/captions — schnell is a 12B-parameter diffusion model, and the render VM
is CPU-only; diffusion inference on CPU is minutes per image, not viable as a
pipeline step. Together AI's often-cited "free FLUX.1-schnell" endpoint was
also checked directly and found to be discontinued — their own model page now
states *"This model is not available on Together's Serverless API."*

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
| `sharp` | Apache-2.0 (libvips LGPL-3.0) | ✅ | Thumbnail compositing. |
| `firecrawl` | MIT | ✅ | trend-research's search+scrape SDK — see §1 above: extract facts into `sourceSummaries`, never reproduce article text. |
| `@huggingface/inference` | Apache-2.0 (JS SDK) | ✅ | Calls FLUX.1-schnell via Inference Providers — see §3.6. |
| `express`, `pino`, `pino-pretty` | MIT | ✅ | Render server / logging. |
| `zod`, `dotenv`, `ws`, `react`, `react-dom` | MIT | ✅ | Utilities / Remotion UI. |
| `@huggingface/transformers` | Apache-2.0 | ✅ | caption-sync's self-hosted Whisper (transformers.js) — no Python/pydantic component exists in this pipeline; every service is Node/TypeScript. |
| `fastify`, `@fastify/cors` | MIT | ✅ | review-dashboard's API server. |
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
| **Hugging Face Inference Providers (FLUX.1 [schnell])** | Thumbnail background image | ✅ cheap paid, not free at volume | §3.6 — no ToS block, but budget for it as a paid service once the $0.10/month credit runs out. |
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
- FLUX.1 [schnell] license (verified against the actual file, not a summary):
  <https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell>,
  <https://huggingface.co/black-forest-labs/FLUX.1-schnell>
- Hugging Face Inference Services terms and pricing:
  <https://cdn-media.huggingface.co/landing/assets/Supplemental+Terms+-+Inference+Services.pdf>,
  <https://huggingface.co/docs/inference-providers/pricing>,
  <https://huggingface.co/docs/inference-providers/en/index>
- fal.ai terms of service (one of the providers HF can route to): <https://fal.ai/terms>
- Together AI's FLUX.1-schnell no longer served (checked directly, contradicting
  older secondhand claims): <https://www.together.ai/models/flux-1-schnell>
