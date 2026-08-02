import { THEMES } from "@ai-news/shared/theme";

export interface ThemeCatalogEntry {
  id: string;
  name: string;
  accentColor: string;
  baseColor: string;
  surfaceColor: string;
}

/** The 18-theme catalog for the dashboard's theme-override picker — a small swatch per theme, not the full token set (the composition, not the dashboard, needs the rest). */
export function listThemeCatalog(): ThemeCatalogEntry[] {
  return THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    accentColor: t.palette.accent,
    baseColor: t.palette.base,
    surfaceColor: t.palette.surface,
  }));
}
