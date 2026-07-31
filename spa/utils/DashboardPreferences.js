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

/** WCAG 2.1 AA minimum contrast for normal-size text. */
const MIN_CONTRAST_AA = 4.5;
/** How far the hover tone moves away from the resting tile colour. */
const HOVER_SHIFT = 0.16;
/** Extra nudge applied per iteration when the first shift is not AA yet. */
const HOVER_SHIFT_STEP = 0.1;
/** Guard against an unbounded loop on pathological colours. */
const MAX_HOVER_SHIFT_STEPS = 12;
/**
 * Below this relative luminance a tile is already near-black, so the hover
 * tone has to get lighter rather than darker to stay visible.
 */
const NEAR_BLACK_LUMINANCE = 0.06;

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
 * Parse a six-digit hexadecimal colour into 0-255 channels.
 *
 * @param {string} color - A six-digit hexadecimal colour.
 * @returns {number[]|null} `[r, g, b]`, or null when the input is not parseable.
 */
function parseHexColor(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;

  return match[1].match(/.{2}/g).map((channel) => Number.parseInt(channel, 16));
}

/**
 * Serialise 0-255 channels back to a six-digit hexadecimal colour.
 *
 * @param {number[]} channels - `[r, g, b]` in the 0-255 range.
 * @returns {string} A six-digit hexadecimal colour.
 */
function toHexColor(channels) {
  return `#${channels
    .map((channel) => {
      const clamped = Math.max(0, Math.min(255, Math.round(channel)));
      return clamped.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/**
 * WCAG relative luminance of 0-255 channels.
 *
 * @param {number[]} channels - `[r, g, b]` in the 0-255 range.
 * @returns {number} Relative luminance between 0 and 1.
 */
function relativeLuminance(channels) {
  const linear = channels
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

/**
 * WCAG contrast ratio between two luminance values.
 *
 * @param {number} a - First relative luminance.
 * @param {number} b - Second relative luminance.
 * @returns {number} Contrast ratio between 1 and 21.
 */
function contrastRatio(a, b) {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
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
  const channels = parseHexColor(backgroundColor);
  if (!channels) return LIGHT_TEXT;

  const luminance = relativeLuminance(channels);
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;

  return lightContrast >= darkContrast ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * Derive the hover/active tone for a tile.
 *
 * The previous behaviour reused the palette's `accent` — the same colour as the
 * tile border — which read as "this tile is selected" rather than "hovered",
 * and left tiles looking permanently stuck in the darkest shade of their
 * domain colour. Instead we shift the resting colour a controlled step away
 * from itself (darker normally, lighter for near-black tiles so the change
 * stays visible) and keep stepping until the paired text colour clears WCAG
 * 2.1 AA at 4.5:1.
 *
 * @param {string} backgroundColor - The resting tile colour.
 * @returns {{bg: string, fg: string}} An AA-compliant hover pair.
 */
function deriveHoverTone(backgroundColor) {
  const channels = parseHexColor(backgroundColor);
  if (!channels) {
    return { bg: backgroundColor, fg: getAccessibleForeground(backgroundColor) };
  }

  const lighten = relativeLuminance(channels) < NEAR_BLACK_LUMINANCE;
  let shift = HOVER_SHIFT;
  let candidate = channels;

  for (let step = 0; step <= MAX_HOVER_SHIFT_STEPS; step += 1) {
    candidate = channels.map((channel) =>
      lighten
        ? channel + ((255 - channel) * shift)
        : channel * (1 - shift),
    );

    const hex = toHexColor(candidate);
    const fg = getAccessibleForeground(hex);
    const pairContrast = contrastRatio(
      relativeLuminance(parseHexColor(hex)),
      relativeLuminance(parseHexColor(fg)),
    );

    if (pairContrast >= MIN_CONTRAST_AA) {
      return { bg: hex, fg };
    }

    shift += HOVER_SHIFT_STEP;
  }

  const fallback = toHexColor(candidate);
  return { bg: fallback, fg: getAccessibleForeground(fallback) };
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

    const hover = deriveHoverTone(tones.bg);
    root.style.setProperty(`--tile-hover-bg-${domain}`, hover.bg);
    root.style.setProperty(`--tile-hover-fg-${domain}`, hover.fg);
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
