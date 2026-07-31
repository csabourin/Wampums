/**
 * Dashboard customization metadata.
 *
 * - DOMAINS: semantic groupings used for color-coding
 * - PALETTES: visual presets the user can switch between (all WCAG-AA on white)
 *
 * Tiles themselves — including their moment/domain — live in
 * `dashboard-tiles.js`, the single source of truth.
 */

export const DOMAINS = [
  "people",       // participants, parents, contacts, groups, messages to families
  "attendance",   // points, honors, meeting, attendance
  "progression",  // badges, programme
  "logistics",    // carpool, inventory, material
  "safety",       // medication, incidents, permission slips
  "money",        // finance, fundraisers, budgets, expenses
  "admin",        // unit settings, roles, district
  // Kept so their CSS variables stay defined: no tile uses them, but
  // `applyPalette` writes a var per domain and `_renderTile` falls back to
  // `neutral` for anything unrecognised.
  "communications",
  "neutral",
];

/**
 * Each palette maps a domain to a triplet:
 *   { bg, fg, accent }
 *   - bg: tile background
 *   - fg: text / icon color (must contrast >= 4.5 on bg for AA)
 *   - accent: border / focus / counter pill
 *
 * "brand" reproduces the current uniform look so users who liked it can keep it.
 */
export const PALETTES = {
  brand: {
    id: "brand",
    label: "dashboard_palette_brand",
    description: "dashboard_palette_brand_desc",
    swatches: ["#0f7a5a"],
    domains: {
      neutral: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      people: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      attendance: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      progression: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      logistics: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      safety: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      communications: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      money: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      admin: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
    },
  },

  domains: {
    id: "domains",
    label: "dashboard_palette_domains",
    description: "dashboard_palette_domains_desc",
    swatches: ["#0f7a5a", "#1f6feb", "#b9591e", "#9a3f38", "#7a3eb1"],
    domains: {
      neutral: { bg: "#374151", fg: "#ffffff", accent: "#1f2937" },
      people: { bg: "#0f7a5a", fg: "#ffffff", accent: "#0b5b43" },
      attendance: { bg: "#0d6e6e", fg: "#ffffff", accent: "#08504f" },
      progression: { bg: "#1f6feb", fg: "#ffffff", accent: "#174fb0" },
      logistics: { bg: "#b9591e", fg: "#ffffff", accent: "#8c4117" },
      safety: { bg: "#9a3f38", fg: "#ffffff", accent: "#732c27" },
      communications: { bg: "#7a3eb1", fg: "#ffffff", accent: "#5a2c83" },
      money: { bg: "#a35a0c", fg: "#ffffff", accent: "#794108" },
      admin: { bg: "#374151", fg: "#ffffff", accent: "#1f2937" },
    },
  },

  highContrast: {
    id: "highContrast",
    label: "dashboard_palette_high_contrast",
    description: "dashboard_palette_high_contrast_desc",
    swatches: ["#000000", "#ffffff", "#ffd400"],
    domains: {
      neutral: { bg: "#000000", fg: "#ffffff", accent: "#ffd400" },
      people: { bg: "#000000", fg: "#ffd400", accent: "#ffffff" },
      attendance: { bg: "#000000", fg: "#ffffff", accent: "#ffd400" },
      progression: { bg: "#000000", fg: "#ffd400", accent: "#ffffff" },
      logistics: { bg: "#000000", fg: "#ffffff", accent: "#ffd400" },
      safety: { bg: "#a00000", fg: "#ffffff", accent: "#ffd400" },
      communications: { bg: "#000000", fg: "#ffd400", accent: "#ffffff" },
      money: { bg: "#000000", fg: "#ffffff", accent: "#ffd400" },
      admin: { bg: "#000000", fg: "#ffffff", accent: "#ffd400" },
    },
  },

  colorblindSafe: {
    id: "colorblindSafe",
    label: "dashboard_palette_colorblind",
    description: "dashboard_palette_colorblind_desc",
    swatches: ["#0072B2", "#E69F00", "#007a59", "#CC79A7", "#56B4E9"],
    domains: {
      neutral: { bg: "#4d4d4d", fg: "#ffffff", accent: "#2b2b2b" },
      people: { bg: "#007a59", fg: "#ffffff", accent: "#006c4e" },
      attendance: { bg: "#0072B2", fg: "#ffffff", accent: "#004f7c" },
      progression: { bg: "#56B4E9", fg: "#0b2540", accent: "#0072B2" },
      logistics: { bg: "#E69F00", fg: "#1d1d1d", accent: "#a37100" },
      safety: { bg: "#b34e00", fg: "#ffffff", accent: "#94400a" },
      communications: { bg: "#CC79A7", fg: "#1d1d1d", accent: "#8a4e74" },
      money: { bg: "#a36900", fg: "#ffffff", accent: "#704800" },
      admin: { bg: "#4d4d4d", fg: "#ffffff", accent: "#2b2b2b" },
    },
  },

  mono: {
    id: "mono",
    label: "dashboard_palette_mono",
    description: "dashboard_palette_mono_desc",
    swatches: ["#1f2937", "#4b5563", "#9ca3af"],
    domains: {
      neutral: { bg: "#374151", fg: "#ffffff", accent: "#111827" },
      people: { bg: "#1f2937", fg: "#ffffff", accent: "#111827" },
      attendance: { bg: "#111827", fg: "#ffffff", accent: "#000000" },
      progression: { bg: "#374151", fg: "#ffffff", accent: "#1f2937" },
      logistics: { bg: "#4b5563", fg: "#ffffff", accent: "#1f2937" },
      safety: { bg: "#1f2937", fg: "#ffffff", accent: "#111827" },
      communications: { bg: "#4b5563", fg: "#ffffff", accent: "#1f2937" },
      money: { bg: "#374151", fg: "#ffffff", accent: "#111827" },
      admin: { bg: "#111827", fg: "#ffffff", accent: "#000000" },
    },
  },
};

export const DEFAULT_PALETTE_ID = "domains";

/**
 * Role-based default ordering hint. When two tiles share a moment, lower
 * `roleWeight` floats to the top of that slot.
 *
 * Animators care about attendance/points first; treasurers about money first;
 * parents about their kid's view first.
 */
export const ROLE_WEIGHTS = {
  animator: { attendance: 0, people: 1, progression: 2, safety: 3, logistics: 4 },
  treasurer: { money: 0, admin: 1, attendance: 5 },
  parent: { people: 0, progression: 1, safety: 2 },
  admin: { admin: 0, money: 1, attendance: 2 },
  default: {},
};

export function getPalette(id) {
  return PALETTES[id] || PALETTES[DEFAULT_PALETTE_ID];
}
