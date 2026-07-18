# media-sourcing

**Runtime:** Node/TypeScript · **Trigger:** GitHub Actions

Reads each segment's `[VISUAL: ...]` cue from `script.json` and fetches matching **copyright-safe** stock footage/photos from Pexels and Pixabay only (both permit free commercial use without attribution). Downloads, dedupes against previously-used clips for the channel (avoids repetition), and normalizes all footage to a common codec/resolution ahead of the Remotion render.

Also pulls background music and SFX from the Pixabay Audio API / YouTube Audio Library mirror, matched to script tone (breaking-news, investigative, human-interest, etc.) via `config/niches/*.config.json` mood tags.

## Output (`jobs/{jobId}/media/`)
- `clip-{n}.mp4` per segment + `media-manifest.json` mapping segment → asset → license record
- `music.mp3`, `sfx/*.mp3`

## License record
Every asset entry stores source, license type, and URL in `media-manifest.json` — kept permanently as proof of copyright-safe sourcing.
