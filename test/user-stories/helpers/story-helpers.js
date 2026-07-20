/**
 * Shared helpers for the user-story suites (test/user-stories/*).
 *
 * No jest globals are used here so the file can be required from any suite
 * (jsdom or node) and from static-verification scripts.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const LANG_DIR = path.join(__dirname, '..', '..', '..', 'lang');

let enCache = null;
let frCache = null;

/** Load lang/en.json once */
function en() {
  if (!enCache) {
    enCache = JSON.parse(fs.readFileSync(path.join(LANG_DIR, 'en.json'), 'utf8'));
  }
  return enCache;
}

/** Load lang/fr.json once */
function fr() {
  if (!frCache) {
    frCache = JSON.parse(fs.readFileSync(path.join(LANG_DIR, 'fr.json'), 'utf8'));
  }
  return frCache;
}

/**
 * Translate a key through the real en.json (fallback: the key itself) and
 * apply {{placeholder}} replacements — mirrors how the SPA builds messages,
 * so tests never hardcode English copy.
 * @param {string} key - Translation key
 * @param {Object} [replacements] - {placeholder: value}
 * @returns {string} Translated string
 */
function tr(key, replacements = {}) {
  let text = en()[key] || key;
  Object.entries(replacements).forEach(([name, value]) => {
    text = text.replace(`{{${name}}}`, String(value));
  });
  return text;
}

/**
 * Assert (by throwing) that every key exists non-empty in BOTH en.json and
 * fr.json. Suites wrap this in a test (US-I18N-001).
 * @param {string[]} keys - Translation keys the suite's flows rely on
 * @returns {{missingEn: string[], missingFr: string[]}}
 */
function i18nGaps(keys) {
  const enJson = en();
  const frJson = fr();
  const missingEn = keys.filter((key) => !enJson[key]);
  const missingFr = keys.filter((key) => !frJson[key]);
  return { missingEn, missingFr };
}

/**
 * Deferred promise, for stories that control response ordering.
 * @returns {{promise: Promise, resolve: Function, reject: Function}}
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask queue (safe with fake timers). */
async function flushPromises(times = 5) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential drains are the point
    await Promise.resolve();
  }
}

/**
 * Extract the highest $N placeholder used in a SQL string.
 * Used to assert bind-parameter consistency (US-HON-005).
 * @param {string} sql
 * @returns {number}
 */
function maxPlaceholder(sql) {
  const matches = sql.match(/\$(\d+)/g) || [];
  return matches.reduce((max, token) => Math.max(max, parseInt(token.slice(1), 10)), 0);
}

// --------------------------------------------------------------------------
// Seed data builders (used instead of literals scattered across tests)
// --------------------------------------------------------------------------

/**
 * Build a participant list. Ids are 1-based.
 * @param {Array<Object>} specs - Partial participants
 */
function buildParticipants(specs) {
  return specs.map((spec, index) => ({
    id: spec.id ?? index + 1,
    first_name: spec.first_name ?? `Kid${index + 1}`,
    last_name: spec.last_name ?? 'Tester',
    group_id: spec.group_id ?? null,
    group_name: spec.group_name ?? null,
    first_leader: spec.first_leader ?? false,
    second_leader: spec.second_leader ?? false,
    total_points: spec.total_points ?? 0,
    ...spec
  }));
}

/**
 * Build a group list.
 * @param {Array<Object>} specs - Partial groups
 */
function buildGroups(specs) {
  return specs.map((spec, index) => ({
    id: spec.id ?? index + 1,
    name: spec.name ?? `Group ${index + 1}`,
    total_points: spec.total_points ?? 0,
    ...spec
  }));
}

module.exports = {
  en,
  fr,
  tr,
  i18nGaps,
  deferred,
  flushPromises,
  maxPlaceholder,
  buildParticipants,
  buildGroups
};
