/**
 * Den management screen (#1041).
 *
 * The screen was titled "Créer les groupes" although it both creates and
 * deletes, called the units "groups" — a reserved word in scouting, where a
 * Group is the whole organization (Groupe St-Paul d'Aylmer) rather than one den
 * — offered an invisible inline rename, and never showed how many youth were in
 * a den, so one could be deleted out from under them.
 *
 * @module test/spa/ManageDens
 */

import fs from 'fs';
import path from 'path';

import {
  createVocabularyFromProfile,
  getUnitVocabulary,
  getVocabularyTemplateKey
} from '../../spa/utils/UnitVocabularyUtils.js';

const fr = JSON.parse(fs.readFileSync(path.join(__dirname, '../../lang/fr.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../../lang/en.json'), 'utf8'));
const screenSource = fs.readFileSync(path.join(__dirname, '../../spa/manage_groups.js'), 'utf8');

/**
 * Resolve a key the way translate() does: template lookup, then substitution.
 *
 * @param {string} key - Translation key
 * @param {Object} table - A language table
 * @param {string} profile - Vocabulary profile name
 * @returns {string} The rendered string
 */
function render(key, table, profile = 'cubs') {
  const vocabulary = getUnitVocabulary(
    { unit_vocabulary: createVocabularyFromProfile(profile) },
    table === fr ? 'fr' : 'en'
  );
  const resolved = getVocabularyTemplateKey(key) || key;
  return Object.entries(vocabulary).reduce(
    (text, [term, value]) => text.replaceAll(`{${term}}`, value),
    table[resolved] || key
  );
}

describe('Naming follows the unit vocabulary', () => {
  it('calls them dens rather than groups for a Cubs unit', () => {
    expect(render('manage_groups', fr)).toBe('Gestion des Tanières');
    expect(render('existing_groups', fr)).toBe('Liste des Tanières');
    expect(render('group_name', fr)).toBe('Nom de Tanière');
  });

  it('follows a Beavers unit to its own term', () => {
    expect(render('manage_groups', fr, 'beavers')).toContain('Huttes');
    expect(render('manage_groups', en, 'beavers')).toContain('Lodges');
  });

  it('gives the tile and the page the same name', () => {
    // dashboard-tiles.js requires the tile label to match the page's <h1>.
    expect(render('tile_manage_groups', fr)).toBe(render('manage_groups', fr));
    expect(render('tile_manage_groups', en)).toBe(render('manage_groups', en));
  });

  it('says "gestion", not "créer", because the screen also deletes', () => {
    expect(render('manage_groups', fr).toLowerCase()).toContain('gestion');
    expect(render('manage_groups', fr).toLowerCase()).not.toContain('créer');
  });

  it('avoids articles that would assume the term is feminine', () => {
    // "Tanière" and "Hutte" are feminine, "Groupe" is masculine, and the
    // vocabulary cannot express gender — so no singular article may precede it.
    for (const key of ['add_group', 'group_name', 'existing_groups', 'manage_groups']) {
      for (const profile of ['cubs', 'beavers', 'generic']) {
        expect(render(key, fr, profile)).not.toMatch(/\b(une|la|cette|un|le|ce)\s+\{?[A-ZÉÈ]/);
      }
    }
  });
});

describe('The screen itself', () => {
  it('no longer offers an inline rename', () => {
    // It was a contenteditable span that saved on blur, with no visible edit
    // control — and because a den row carries no scout year, renaming it
    // rewrote its name in every past season's records.
    expect(screenSource).not.toContain('contenteditable');
    expect(screenSource).not.toContain('editable-group');
    expect(screenSource).not.toContain('updateGroupName');
  });

  it('shows how many youth are in each den', () => {
    expect(screenSource).toContain('member_count');
    expect(screenSource).toContain('group_member_count');
  });

  it('warns about the youth in a den before deleting it', () => {
    expect(screenSource).toContain('group_has_members_warning');
    expect(screenSource).toContain('confirmDestructive');
  });
});

describe('Translation coverage', () => {
  it('defines every new key in both languages', () => {
    const keys = [
      'vocabulary_manage_groups', 'vocabulary_tile_manage_groups', 'vocabulary_add_group',
      'vocabulary_group_name', 'vocabulary_existing_groups', 'vocabulary_confirm_delete_group',
      'vocabulary_group_has_members_warning', 'vocabulary_no_groups_found',
      'vocabulary_remove_group', 'group_member_count', 'no_groups_found'
    ];
    for (const key of keys) {
      expect(typeof fr[key]).toBe('string');
      expect(typeof en[key]).toBe('string');
    }
  });

  it('keeps the count placeholder the caller substitutes', () => {
    expect(fr.vocabulary_group_has_members_warning).toContain('{{count}}');
    expect(en.vocabulary_group_has_members_warning).toContain('{{count}}');
  });
});
