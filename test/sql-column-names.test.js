/**
 * A column the server's SQL names through a table alias (`p.first_name`) must
 * exist on that table in the schema baseline or a migration. A missing column
 * fails the query on every call, and mocked-pool route tests cannot notice
 * (GET /api/v1/participants/calendar once read fundraiser_entries.date and
 * .organization_id, neither of which exists).
 *
 * Only qualified references are checked, and an alias is skipped when one
 * statement binds it to a CTE, a subquery or two different tables.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'services', 'middleware', 'utils'];
const STRING_LITERAL = /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'/g;
const LOOKS_LIKE_SQL = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)\b/i;
const SQL_COMMENT = /--[^\n]*/g;
const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
const CREATE_VIEW = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
const ALTER_TABLE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi;
const ADD_COLUMN = /ADD(?:\s+COLUMN)?\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+\w/gi;
const RENAME_COLUMN = /RENAME\s+COLUMN\s+"?\w+"?\s+TO\s+"?(\w+)"?/gi;
const TABLE_CONSTRAINTS = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like']);
const TABLE_WITH_ALIAS = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:public\.)?(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi;
const CTE_NAME = /\b(\w+)\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(/gi;
const QUALIFIED_COLUMN = /\b(\w+)\.(\w+)\b/g;
/** Words that can follow a table name without being its alias. */
const NOT_ALIASES = new Set(('on where and or as using left right inner outer full cross join lateral group order '
  + 'limit having set returning select from union except intersect window natural values for').split(' '));

/** Split a CREATE TABLE body on its top-level commas. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') {depth += 1;}
    if (ch === ')') {depth -= 1;}
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** @returns {Map<string, Set<string>|null>} Columns per table; null for a view (not checked). */
function knownColumns() {
  const columns = new Map();
  const add = (table, column) => {
    const key = table.toLowerCase();
    if (!columns.get(key)) {columns.set(key, new Set());}
    columns.get(key).add(column.toLowerCase());
  };
  const files = [path.join(ROOT, 'attached_assets/Full_Database_schema.sql'),
    ...fs.readdirSync(path.join(ROOT, 'migrations')).map((file) => path.join(ROOT, 'migrations', file))];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(SQL_COMMENT, '');
    for (const match of text.matchAll(CREATE_TABLE)) {
      let depth = 1;
      let end = match.index + match[0].length;
      while (end < text.length && depth > 0) {
        if (text[end] === '(') {depth += 1;}
        if (text[end] === ')') {depth -= 1;}
        end += 1;
      }
      for (const part of topLevelParts(text.slice(match.index + match[0].length, end - 1))) {
        const column = /^\s*"?(\w+)"?\s+\w/.exec(part);
        if (column && !TABLE_CONSTRAINTS.has(column[1].toLowerCase())) {add(match[1], column[1]);}
      }
    }
    for (const match of text.matchAll(ALTER_TABLE)) {
      for (const column of match[2].matchAll(ADD_COLUMN)) {add(match[1], column[1]);}
      for (const column of match[2].matchAll(RENAME_COLUMN)) {add(match[1], column[1]);}
    }
    for (const match of text.matchAll(CREATE_VIEW)) {
      if (!columns.has(match[1].toLowerCase())) {columns.set(match[1].toLowerCase(), null);}
    }
  }
  return columns;
}

function sourceFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {return sourceFiles(relative);}
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

/** Aliases of known tables in one statement, leaving out any that is ambiguous. */
function tableAliases(sql, columns) {
  const ctes = new Set([...sql.matchAll(CTE_NAME)].map((match) => match[1].toLowerCase()));
  const aliases = new Map();
  const ambiguous = new Set(ctes);
  for (const [, rawTable, rawAlias] of sql.matchAll(TABLE_WITH_ALIAS)) {
    const table = rawTable.toLowerCase();
    const alias = rawAlias && !NOT_ALIASES.has(rawAlias.toLowerCase()) ? rawAlias.toLowerCase() : null;
    if (!columns.has(table) || ctes.has(table)) {
      if (alias) {ambiguous.add(alias);}
      continue;
    }
    for (const name of [table, alias].filter(Boolean)) {
      if (aliases.has(name) && aliases.get(name) !== table) {ambiguous.add(name);}
      aliases.set(name, table);
    }
  }
  ambiguous.forEach((name) => aliases.delete(name));
  return aliases;
}

test('every column named through a table alias exists on that table', () => {
  const columns = knownColumns();
  const missing = [];
  for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const literal of source.match(STRING_LITERAL) || []) {
      const sql = literal.slice(1, -1).replace(SQL_COMMENT, '');
      if (!LOOKS_LIKE_SQL.test(sql)) {continue;}
      const aliases = tableAliases(sql, columns);
      for (const [, rawAlias, rawColumn] of sql.matchAll(QUALIFIED_COLUMN)) {
        const table = aliases.get(rawAlias.toLowerCase());
        const tableColumns = table ? columns.get(table) : null;
        if (tableColumns && !tableColumns.has(rawColumn.toLowerCase())) {
          missing.push(`${file}: ${rawAlias}.${rawColumn} (${table})`);
        }
      }
    }
  }
  expect(columns.size).toBeGreaterThan(0);
  expect([...new Set(missing)]).toEqual([]);
});
