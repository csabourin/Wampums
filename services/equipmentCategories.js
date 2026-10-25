'use strict';

/**
 * Equipment categories — a fixed list, so each one has a label in every
 * language of the app (`equipment_category_<key>`) and filters stay reliable.
 *
 * The list lives in config/equipment_categories.json, which the SPA imports
 * too. Categories used to be free text; `categoryFromText` reads what units
 * typed then ("games", "Cuisine", "Premiers soins") into a key.
 *
 * @module services/equipmentCategories
 */

const { categories: EQUIPMENT_CATEGORIES } = require('../config/equipment_categories.json');

/**
 * Words found in free-text categories, by the key they mean. Matched on the
 * whole text or any word of it, accents and case ignored.
 */
const CATEGORY_WORDS = {
  camping: ['camping', 'camp', 'tente', 'tentes', 'tent', 'tents', 'bache', 'baches', 'tarp', 'tarps', 'couchage', 'shelter'],
  kitchen: ['kitchen', 'cuisine', 'cooking', 'popote', 'vaisselle', 'cookware', 'food', 'nourriture'],
  games: ['games', 'game', 'jeux', 'jeu', 'jouets', 'toys'],
  first_aid: ['first aid', 'first-aid', 'firstaid', 'premiers soins', 'secourisme', 'pharmacie', 'medical', 'sante'],
  tools: ['tools', 'tool', 'outils', 'outil', 'quincaillerie', 'hardware', 'pionnier', 'pioneering'],
  crafts: ['crafts', 'craft', 'artisanat', 'bricolage', 'arts', 'art', 'bricolages'],
  sports: ['sports', 'sport', 'ballons', 'ballon', 'balls'],
  water: ['water', 'nautique', 'nautiques', 'canot', 'canots', 'canoe', 'kayak', 'eau', 'aquatique'],
  lighting: ['lighting', 'light', 'lights', 'eclairage', 'lampes', 'lampe', 'lanternes', 'lanterne', 'lamps'],
  other: ['other', 'others', 'autre', 'autres', 'divers', 'misc', 'miscellaneous'],
};

/**
 * @param {string} text
 * @returns {string} Lower case, accents removed, spaces collapsed
 */
function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The category key a free-text category means.
 *
 * @param {string|null|undefined} text - What was typed, or a key already
 * @returns {string|null} A key; null when the text names none of them
 */
function categoryFromText(text) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return null;
  }
  const value = normalize(text);
  if (EQUIPMENT_CATEGORIES.includes(value)) {
    return value;
  }
  const words = value.split(/[^a-z0-9-]+/).filter(Boolean);
  const match = Object.entries(CATEGORY_WORDS).find(([, terms]) =>
    terms.includes(value) || words.some((word) => terms.includes(word)));
  return match ? match[0] : null;
}

module.exports = { EQUIPMENT_CATEGORIES, categoryFromText };
