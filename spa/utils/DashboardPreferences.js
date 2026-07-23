/**
 * User-controlled dashboard preferences, persisted in localStorage.
 * Single source of truth for: palette choice, hidden tiles, FAB pinned actions.
 *
 * Applies the active palette by writing CSS custom properties to :root,
 * scoped under [data-dashboard-palette] on documentElement.
 */

import { PALETTES, DEFAULT_PALETTE_ID, DOMAINS } from "../config/dashboard-customization.js";
import { debugLog } from "./DebugUtils.js";

const STORAGE_KEY = "wampums.dashboard.prefs.v1";
const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#000000";

const DEFAULT_PREFS = Object.freeze({
  paletteId: DEFAULT_PALETTE_ID,
  hiddenTiles: [],
  pinnedActions: [],
  collapsedToolGroups: [],
});

function readPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    debugLog("Failed to persist dashboard prefs:", error);
  }
}

export function getDashboardPrefs() {
  return readPrefs();
}

export function setPaletteId(paletteId) {
  const prefs = readPrefs();
  prefs.paletteId = PALETTES[paletteId] ? paletteId : DEFAULT_PALETTE_ID;
  writePrefs(prefs);
  applyPalette(prefs.paletteId);
  return prefs.paletteId;
}

export function setHiddenTiles(hrefs) {
  const prefs = readPrefs();
  prefs.hiddenTiles = Array.from(new Set(hrefs || []));
  writePrefs(prefs);
}

export function setCollapsedToolGroups(groups) {
  const prefs = readPrefs();
  prefs.collapsedToolGroups = Array.from(new Set(groups || []));
  writePrefs(prefs);
}

/**
 * Pick black or white text for a background color using WCAG relative
 * luminance. Choosing the higher-contrast option guarantees at least 4.5:1
 * for valid six-digit hex palette colors.
 *
 * @param {string} backgroundColor - A six-digit hexadecimal color.
 * @returns {string} Accessible foreground color.
 */
function getAccessibleForeground(backgroundColor) {
  const match = /^#([0-9a-f]{6})$/i.exec(backgroundColor);
  if (!match) return LIGHT_TEXT;

  const channels = match[1]
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  const luminance =
    (0.2126 * channels[0]) +
    (0.7152 * channels[1]) +
    (0.0722 * channels[2]);
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;

  return lightContrast >= darkContrast ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * Push palette colors as CSS variables under `--tile-bg-<domain>` etc.
 * Called once at boot and whenever the palette changes.
 */
export function applyPalette(paletteId = null) {
  const id = paletteId || readPrefs().paletteId;
  const palette = PALETTES[id] || PALETTES[DEFAULT_PALETTE_ID];
  const root = document.documentElement;

  DOMAINS.forEach((domain) => {
    const tones = palette.domains[domain] || palette.domains.neutral;
    root.style.setProperty(`--tile-bg-${domain}`, tones.bg);
    root.style.setProperty(`--tile-fg-${domain}`, tones.fg);
    root.style.setProperty(`--tile-accent-${domain}`, tones.accent);
    root.style.setProperty(`--tile-hover-bg-${domain}`, tones.accent);
    root.style.setProperty(
      `--tile-hover-fg-${domain}`,
      getAccessibleForeground(tones.accent),
    );
  });

  root.dataset.dashboardPalette = palette.id;
}

/**
 * Reset everything (escape hatch for the settings UI).
 */
export function resetDashboardPrefs() {
  writePrefs({ ...DEFAULT_PREFS });
  applyPalette(DEFAULT_PALETTE_ID);
}
