# shared

Code shared across Node-based services:

- `job-store/` — thin client over the R2 (S3-compatible) bucket used to pass artifacts between pipeline steps (`getJobFile`, `putJobFile`, job manifest read/write). Every service imports this instead of talking to S3 directly.
- `logger/` — structured JSON logger (pino) so GitHub Actions logs and the render VM's logs share one format.
- `schemas/` — Zod schemas for every inter-step JSON contract (`trend.json`, `script.json`, `segment-timing.json`, `captions.json`, `media-manifest.json`, `metadata.json`) — the single source of truth for the pipeline's data contracts. Python services (`voiceover`, `caption-sync`) mirror these as `pydantic` models rather than importing them directly.
