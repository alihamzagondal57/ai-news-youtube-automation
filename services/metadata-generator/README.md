# metadata-generator

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Generates everything YouTube needs besides the video file itself:

- **Thumbnail**: composited with `sharp` from a keyframe still + headline text + channel branding template (`assets/templates/`), 1280×720
- **SEO title** (≤100 chars, CTR-oriented but not clickbait/false), **description** (with timestamps, sources, hashtags), **tags**, **hashtags**, and **chapters** (derived from `segment-timing.json`)

All copy generated via the same LLM used for the script, then validated against YouTube's field-length limits before being written out.

## Output (`jobs/{jobId}/metadata.json`, `jobs/{jobId}/thumbnail.png`)
