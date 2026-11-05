/**
 * Every table the server's SQL names must exist in the schema baseline or be
 * created by a migration. A query against a missing table fails on every call
 * (participants once wrote guardian links to a `guardians` table that never
 * existed), and mocked-pool route tests cannot notice.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'services', 'middleware', 'utils'];
const CREATE_TABLE = /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
const CREATE_VIEW = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
const RENAME_TABLE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?[a-z_][a-z0-9_]*\s+RENAME\s+TO\s+([a-z_][a-z0-9_]*)/gi;
const TABLE_REFERENCE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?([a-z_][a-z0-9_]*)\b/gi;
/** Set-returning functions and keywords that follow FROM/JOIN without being tables. */
const NOT_TABLES = new Set([
  'lateral', 'unnest', 'generate_series', 'jsonb_array_elements', 'jsonb_array_elements_text',
  'jsonb_each', 'jsonb_each_text', 'json_array_elements', 'jsonb_to_recordset', 'jsonb_populate_recordset',
  'jsonb_object_keys', 'regexp_split_to_table', 'string_to_table', 'information_schema', 'pg_catalog', 'values',
  'select', 'set', 'only', 'excluded',
]);
/**
 * Known gaps, each awaiting a decision. Shrinks only.
 * routes/forms.js: GET/POST /api/v1/forms, /:id, /:id/submit, /:id/submissions and the approve
 * route read and write a `forms` table no schema or migration creates. Nothing calls them.
 */
const KNOWN_MISSING = new Set(['routes/forms.js: forms']);
/** A string reads as SQL when it starts like a statement. */
const LOOKS_LIKE_SQL = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)\b/i;
/** Characters read before FROM to tell a function argument from a table. */
const FUNCTION_ARGUMENT_LOOKBEHIND = 30;
const STRING_LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;

function namesIn(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1].toLowerCase());
}

function knownRelations() {
  const sources = [fs.readFileSync(path.join(ROOT, 'attached_assets/Full_Database_schema.sql'), 'utf8')];
  for (const file of fs.readdirSync(path.join(ROOT, 'migrations'))) {
    sources.push(fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8'));
  }
  const known = new Set();
  for (const text of sources) {
    for (const pattern of [CREATE_TABLE, CREATE_VIEW, RENAME_TABLE]) {
      namesIn(text, pattern).forEach((name) => known.add(name));
    }
  }
  return known;
}

function sourceFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {return sourceFiles(relative);}
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

test('every table named in server SQL exists in the schema or a migration', () => {
  const known = knownRelations();
  const missing = [];
  for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const literal of source.match(STRING_LITERAL) || []) {
      // SQL comments are prose; they may say "from the …".
      const sql = literal.slice(1, -1).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (!LOOKS_LIKE_SQL.test(sql)) {continue;}
      // Names a statement defines for itself: CTEs (`name AS (`) and aliases of subqueries.
      const local = new Set(namesIn(sql, /\b([a-z_][a-z0-9_]*)\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(/gi));
      for (const match of sql.matchAll(TABLE_REFERENCE)) {
        const name = match[1].toLowerCase();
        const before = sql.slice(Math.max(0, match.index - FUNCTION_ARGUMENT_LOOKBEHIND), match.index);
        // IS DISTINCT FROM x, EXTRACT(YEAR FROM x), SUBSTRING(s FROM n): not a table.
        // FOR UPDATE [OF t | SKIP LOCKED] locks rows; it names no table.
        if (/DISTINCT\s*$/i.test(before) || /\bFOR\s*$/i.test(before) || /\(\s*[a-z_]+\s*$/i.test(before)) {continue;}
        if (KNOWN_MISSING.has(`${file}: ${name}`)) {continue;}
        if (!known.has(name) && !local.has(name) && !NOT_TABLES.has(name)) {
          missing.push(`${file}: ${name}`);
        }
      }
    }
  }
  expect([...new Set(missing)]).toEqual([]);
});
