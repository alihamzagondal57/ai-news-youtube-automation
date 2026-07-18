/**
 * The bottom-third stacks three bands, bottom to top: ticker, captions,
 * lower-third. Defined together (in 1080p reference pixels, scaled via
 * useScale()) so the three components — built independently — can't drift
 * into overlapping each other.
 */
export const TICKER_HEIGHT = 90;
export const CAPTIONS_BAND_HEIGHT = 210;
export const CAPTIONS_BAND_GAP_ABOVE_TICKER = 0;
export const LOWER_THIRD_GAP_ABOVE_CAPTIONS = 36;

export const captionsBandBottom = () => TICKER_HEIGHT + CAPTIONS_BAND_GAP_ABOVE_TICKER;
export const lowerThirdBottom = () => captionsBandBottom() + CAPTIONS_BAND_HEIGHT + LOWER_THIRD_GAP_ABOVE_CAPTIONS;
