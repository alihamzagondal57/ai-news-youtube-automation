/**
 * Visual theme tokens for the news video composition.
 *
 * Deliberately plain TypeScript — no zod, no React, no Node APIs. This module is
 * imported by BOTH the Remotion composition (browser bundle, zod 4) and
 * render-server (Node, zod 3), so it must stay free of anything either side
 * can't take. That's also why it lives here rather than in remotion/: it is the
 * single source of truth for theme ids and, critically, transition frame counts,
 * which render-server needs for targeted-re-render invalidation.
 */

/** How one segment's background gives way to the next. */
export type TransitionStyle = "crossfade" | "slideX" | "zoomIn" | "wipeX" | "dipToColor";

/** Structural layout of the scrolling headline strip, not just its colour. */
export type TickerVariant = "band" | "chips" | "ribbon" | "minimal" | "none";

/** Structural layout of the segment headline plate. */
export type LowerThirdVariant = "accentBar" | "card" | "underline" | "cornerTag" | "stackedRule" | "blockShadow";

/** How word-synced captions present the active word. */
export type CaptionVariant = "highlightWord" | "boxedLine" | "underlineWord" | "chipWord";

export type IntroVariant = "barsWipe" | "centerPulse" | "cornerSlate" | "gridReveal" | "minimalRule";

export type OutroVariant = "cardsUp" | "centerFade" | "sideSlide" | "ruleCollapse";

export interface ThemePalette {
  /** Base backdrop behind everything (also the letterbox colour). */
  base: string;
  /** Panel/plate fill. Usually carries alpha so footage reads through. */
  surface: string;
  accent: string;
  accentSoft: string;
  textPrimary: string;
  textMuted: string;
  /** Colour of the active caption word. */
  captionActive: string;
  /** 0–1: how strongly footage is darkened toward the lower third for text legibility. */
  scrimStrength: number;
}

export interface ThemeFonts {
  /**
   * CSS font stacks. `assets/fonts/` is empty today, so these resolve through to
   * a generic family — the serif/sans/condensed/mono distinction survives even
   * with nothing bundled. Dropping woff2 files in and prepending the family name
   * is a per-theme one-liner.
   */
  headline: string;
  headlineWeight: number;
  headlineTransform: "uppercase" | "none";
  /** Letter-spacing in 1080p reference pixels. */
  headlineTracking: number;
  caption: string;
  captionWeight: number;
}

export interface ThemeTicker {
  variant: TickerVariant;
  /** Label chip at the strip's leading edge; null renders no badge. */
  badge: string | null;
  /** Scroll speed in 1080p reference px/sec. */
  speed: number;
  /** Multiplier on the shared TICKER_HEIGHT band. */
  heightScale: number;
}

export interface ThemeLowerThird {
  variant: LowerThirdVariant;
  align: "left" | "right";
  enter: "slideX" | "fadeUp" | "wipeX" | "scaleIn";
}

export interface ThemeCaptions {
  variant: CaptionVariant;
  weight: number;
  /** Multiplier on the base caption size. */
  sizeScale: number;
}

export interface Theme {
  id: string;
  name: string;
  /** One-line editorial character, shown in the review dashboard's theme picker. */
  description: string;
  palette: ThemePalette;
  fonts: ThemeFonts;
  ticker: ThemeTicker;
  lowerThird: ThemeLowerThird;
  captions: ThemeCaptions;
  intro: IntroVariant;
  outro: OutroVariant;
  transition: {
    style: TransitionStyle;
    /**
     * Frames of overlap between adjacent segments. This is the number
     * render-server uses to widen targeted-re-render invalidation — a segment's
     * visuals bleed exactly this far into each neighbour, so getting it wrong
     * leaves a stale clip in the crossfade.
     */
    frames: number;
  };
}
