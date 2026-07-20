// Verifies the theme catalog is genuinely varied (not palette swaps) and that
// auto-rotation honours the "never the same theme twice in a row" requirement.
// Pure logic — no rendering, so it runs in a second.
import {
  EMPTY_ROTATION_STATE,
  ROTATION_AVOID_WINDOW,
  THEMES,
  THEME_IDS,
  getTheme,
  getThemeOrDefault,
  selectTheme,
  type ThemeRotationState,
} from "../services/shared/src/theme/index.ts";

let failures = 0;
function check(label: string, condition: boolean, detail: string): void {
  if (condition) console.log(`  PASS  ${label} — ${detail}`);
  else {
    console.error(`  FAIL  ${label} — ${detail}`);
    failures++;
  }
}

// ── Catalog shape ──────────────────────────────────────────────────────────
check("catalog size is 15-20", THEMES.length >= 15 && THEMES.length <= 20, `${THEMES.length} themes`);
check("theme ids are unique", new Set(THEME_IDS).size === THEMES.length, `${new Set(THEME_IDS).size} unique ids`);

// The core requirement: themes must differ structurally, not just by palette.
const structuralCombos = new Set(
  THEMES.map((t) => [t.ticker.variant, t.lowerThird.variant, t.lowerThird.align, t.transition.style, t.intro, t.outro].join("|")),
);
check(
  "no two themes share a structural layout",
  structuralCombos.size === THEMES.length,
  `${structuralCombos.size} distinct ticker/lower-third/transition/intro/outro combinations across ${THEMES.length} themes`,
);

const paletteAccents = new Set(THEMES.map((t) => t.palette.accent.toLowerCase()));
check("accent colours are distinct", paletteAccents.size >= THEMES.length - 2, `${paletteAccents.size} distinct accents`);

const fontPairs = new Set(THEMES.map((t) => `${t.fonts.headline}||${t.fonts.caption}`));
check("font pairings vary", fontPairs.size >= 8, `${fontPairs.size} distinct headline/caption pairings`);

// Every structural variant should actually be exercised by at least one theme,
// otherwise the component code paths are dead.
for (const [dimension, values] of Object.entries({
  ticker: THEMES.map((t) => t.ticker.variant),
  lowerThird: THEMES.map((t) => t.lowerThird.variant),
  captions: THEMES.map((t) => t.captions.variant),
  transition: THEMES.map((t) => t.transition.style),
  intro: THEMES.map((t) => t.intro),
  outro: THEMES.map((t) => t.outro),
})) {
  const used = new Set(values);
  check(`${dimension} variants in use`, used.size >= 3, `${used.size} distinct: ${[...used].join(", ")}`);
}

const frames = THEMES.map((t) => t.transition.frames);
check(
  "transition frame counts vary per theme",
  new Set(frames).size >= 5,
  `${new Set(frames).size} distinct values, range ${Math.min(...frames)}-${Math.max(...frames)} frames`,
);
check(
  "transition frames stay within a sane range",
  frames.every((f) => f >= 8 && f <= 30),
  `all between ${Math.min(...frames)} and ${Math.max(...frames)}`,
);

// ── Lookup ─────────────────────────────────────────────────────────────────
check("getTheme resolves a known id", getTheme("noir").id === "noir", "noir resolved");
let threw = false;
try {
  getTheme("does-not-exist");
} catch {
  threw = true;
}
check("getTheme throws on unknown id", threw, "unknown id rejected rather than silently defaulted");
check(
  "getThemeOrDefault falls back",
  getThemeOrDefault("nope").id === getThemeOrDefault(null).id,
  "unknown and null both fall back to the default theme",
);

// ── Rotation: the actual requirement ───────────────────────────────────────
const DRAWS = 5000;
let state: ThemeRotationState = EMPTY_ROTATION_STATE;
const sequence: string[] = [];
let seed = 12345;
const seededRandom = () => {
  // Deterministic LCG so a failure here is reproducible.
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

for (let i = 0; i < DRAWS; i++) {
  const selection = selectTheme({ state, random: seededRandom });
  sequence.push(selection.themeId);
  state = selection.nextState;
}

let consecutiveRepeats = 0;
for (let i = 1; i < sequence.length; i++) {
  if (sequence[i] === sequence[i - 1]) consecutiveRepeats++;
}
check(
  "auto-rotation never repeats consecutively",
  consecutiveRepeats === 0,
  `0 consecutive repeats across ${DRAWS} draws`,
);

// Stronger than the stated requirement: no repeat within the avoid window.
let windowViolations = 0;
for (let i = ROTATION_AVOID_WINDOW; i < sequence.length; i++) {
  if (sequence.slice(i - ROTATION_AVOID_WINDOW, i).includes(sequence[i])) windowViolations++;
}
check(
  `no repeat within the last ${ROTATION_AVOID_WINDOW} videos`,
  windowViolations === 0,
  `0 violations across ${DRAWS} draws`,
);

check(
  "rotation reaches every theme",
  new Set(sequence).size === THEMES.length,
  `${new Set(sequence).size}/${THEMES.length} themes used`,
);

// ── Manual override ────────────────────────────────────────────────────────
const overridden = selectTheme({ state, override: "ember" });
check("manual override wins", overridden.themeId === "ember" && overridden.manual, "override honoured and flagged manual");
check(
  "override is recorded in history",
  overridden.nextState.recentThemeIds[0] === "ember",
  "a later auto-pick won't immediately repeat a hand-picked theme",
);
let overrideThrew = false;
try {
  selectTheme({ state, override: "not-a-theme" });
} catch {
  overrideThrew = true;
}
check("invalid override rejected", overrideThrew, "unknown override id throws rather than silently rotating");

// Degenerate catalogs must not deadlock the exclusion window.
const tiny = selectTheme({ state: { recentThemeIds: ["a"] }, availableThemeIds: ["a", "b"], random: () => 0 });
check("tiny catalog still rotates", tiny.themeId === "b", "2-theme catalog avoids the previous pick instead of throwing");
const single = selectTheme({ state: { recentThemeIds: ["a"] }, availableThemeIds: ["a"], random: () => 0 });
check("single-theme catalog degrades gracefully", single.themeId === "a", "falls back rather than throwing on an empty pool");

console.log("");
console.log(failures === 0 ? "ALL THEME CATALOG TESTS PASSED" : `${failures} failure(s)`);
if (failures > 0) process.exit(1);
