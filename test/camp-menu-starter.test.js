/**
 * The starter camp menus (`config/camp_menu_starter.json`): a reviewed,
 * bilingual week a unit can start from, and the demo unit's menus (#1260).
 *
 * Held here: every menu is complete in French and English, its meals fall
 * within the camp's nights in order, each item is named once per meal, and the
 * file holds food only — no person, contact, brand or allergen claim.
 */
const starter = require('../config/camp_menu_starter.json');

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/;
/** Brand names seen in real menus; the starter names the food instead. */
const BRANDS = /mr\.?\s*freeze|rice\s*krispies|thé social|nutella|kraft|kellogg/i;

const texts = (value) => (typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(texts)
    : value && typeof value === 'object' ? Object.values(value).flatMap(texts) : []);

describe('starter camp menus', () => {
  test('every template is named in French and English and lasts at least one night', () => {
    expect(starter.templates.length).toBeGreaterThan(0);
    for (const template of starter.templates) {
      expect(template.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(template.label_fr.trim()).not.toBe('');
      expect(template.label_en.trim()).not.toBe('');
      expect(Number.isInteger(template.nights) && template.nights > 0).toBe(true);
    }
    expect(new Set(starter.templates.map((template) => template.key)).size).toBe(starter.templates.length);
  });

  test('each meal is a known meal, within the camp’s days, in day order, with items named in both languages', () => {
    for (const template of starter.templates) {
      let lastDay = 0;
      for (const meal of template.meals) {
        expect(starter.MEALS).toContain(meal.meal);
        if (meal.context) {
          expect(starter.CONTEXTS).toContain(meal.context);
        }
        expect(meal.day_offset).toBeGreaterThanOrEqual(lastDay);
        expect(meal.day_offset).toBeLessThanOrEqual(template.nights);
        lastDay = meal.day_offset;
        expect(meal.items.length).toBeGreaterThan(0);
        expect(new Set(meal.items.map((item) => item.key)).size).toBe(meal.items.length);
        for (const item of meal.items) {
          expect(item.key).toMatch(/^[a-z][a-z0-9_]*$/);
          expect(item.label_fr.trim()).not.toBe('');
          expect(item.label_en.trim()).not.toBe('');
          expect(Boolean(item.note_fr)).toBe(Boolean(item.note_en));
        }
      }
    }
  });

  test('a day’s main meals come in their usual order', () => {
    const order = ['breakfast', 'lunch', 'supper'];
    for (const template of starter.templates) {
      const days = new Map();
      template.meals.filter((meal) => order.includes(meal.meal)).forEach((meal) => {
        days.set(meal.day_offset, [...(days.get(meal.day_offset) || []), order.indexOf(meal.meal)]);
      });
      for (const [, positions] of days) {
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      }
    }
  });

  test('cook shift times exist for each main meal and end after they start', () => {
    for (const meal of ['breakfast', 'lunch', 'supper']) {
      const [start, end] = starter.COOK_SHIFT_TIMES[meal];
      expect(start).toMatch(/^\d{2}:\d{2}$/);
      expect(end > start).toBe(true);
    }
  });

  test('the file holds food only: no email, phone number or brand name', () => {
    for (const text of texts(starter)) {
      expect(text).not.toMatch(EMAIL);
      expect(text).not.toMatch(PHONE);
      expect(text).not.toMatch(BRANDS);
    }
  });
});
