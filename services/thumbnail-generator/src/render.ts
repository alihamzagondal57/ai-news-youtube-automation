import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { config } from "./config.js";

export interface ThumbnailInputProps {
  themeId: string;
  headline: string;
  kicker?: string;
  channelName?: string;
  /** Filename relative to `publicDir`, resolved via staticFile() inside the composition. Empty renders the theme's own gradient fallback. */
  backgroundFrameSrc?: string;
  fontSizePx: number;
}

export interface RenderThumbnailStillOptions {
  /** Directory backgroundFrameSrc (if any) lives in — passed to bundle() as publicDir, same as render-server's runRender. */
  publicDir: string;
  inputProps: ThumbnailInputProps;
  outputPath: string;
}

/**
 * Bundles the Remotion project and renders one still of the `Thumbnail`
 * composition (see remotion/src/compositions/Thumbnail.tsx) — the same
 * bundle+selectComposition+renderStill shape render-theme-contact-sheet.mts
 * uses for the theme catalog's own review stills.
 */
export async function renderThumbnailStill(options: RenderThumbnailStillOptions): Promise<void> {
  const { publicDir, inputProps, outputPath } = options;

  const serveUrl = await bundle({ entryPoint: config.remotionEntryPoint, publicDir });
  // @remotion/renderer's own types want Record<string, unknown> here; render-server's
  // renderSegmented.ts casts the same way rather than giving typed input-props
  // interfaces a blanket index signature.
  const rawInputProps = inputProps as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: config.remotionCompositionId, inputProps: rawInputProps });

  await renderStill({
    composition: { ...composition, width: config.width, height: config.height },
    serveUrl,
    output: outputPath,
    frame: 0,
    inputProps: rawInputProps,
  });
}
