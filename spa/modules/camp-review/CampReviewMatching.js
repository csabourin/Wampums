/**
 * Notes that say the same thing (#1257): while a note is typed, the notes of
 * the same category that share its words are offered, so a "+1" can be given
 * instead of writing it again. Computed on the device, so it works offline.
 *
 * Words are compared without case or accents; short words ("le", "the",
 * "et") are ignored, and a word matches its plural or longer form
 * ("baignade", "baignades"). A note matches when it shares at least one word, and the
 * notes sharing the largest part of the typed words come first.
 *
 * @module spa/modules/camp-review/CampReviewMatching
 */
import rules from '../../../config/camp_reviews.json';

/**
 * @param {string} text - Any text
 * @returns {string[]} Its distinct words, lower case and without accents
 */
export function reviewWords(text) {
  const plain = String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const words = plain.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= rules.SUGGESTION_MIN_WORD_LENGTH);
  return [...new Set(words)];
}

/**
 * @param {string} a - A word, from reviewWords()
 * @param {string} b - Another
 * @returns {boolean} Whether they are the same word, or one is the other with an ending
 */
function sameWord(a, b) {
  return a === b || (Math.min(a.length, b.length) >= rules.SUGGESTION_MIN_WORD_LENGTH + 1
    && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * @param {string} text - What is being typed
 * @param {Object[]} notes - The camp's notes
 * @param {string} category - The category it will be filed under
 * @param {number} [limit] - How many to offer at most
 * @returns {Object[]} Notes that seem to say the same, closest first
 */
export function similarNotes(text, notes, category, limit = rules.SUGGESTIONS_MAX) {
  const typed = reviewWords(text);
  if (!typed.length) {
    return [];
  }
  return notes
    .filter((note) => note.category === category)
    .map((note) => {
      const words = reviewWords(note.text);
      const shared = typed.filter((word) => words.some((other) => sameWord(word, other))).length;
      return { note, score: shared / typed.length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.note.weight || 1) - (a.note.weight || 1))
    .slice(0, limit)
    .map(({ note }) => note);
}
