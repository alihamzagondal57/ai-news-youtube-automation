import { useVideoConfig } from "remotion";

/** All layout constants across components are authored against a 1080p-tall frame. */
export const REFERENCE_HEIGHT = 1080;

/** Multiply any reference-frame pixel value by this to get the value for the actual render resolution. */
export function useScale(): number {
  const { height } = useVideoConfig();
  return height / REFERENCE_HEIGHT;
}
