/**
 * Schema Parser for Test Mock Generation
 * Parses Full_Database_schema.sql to extract table structures
 */
const fs = require('fs');
const path = require('path');

/**
 * Parse the database schema file to extract table definitions
 * @returns {Object} Dictionary of table names to their column definitions
 */
function parseSchema() {
  const schemaPath = path.join(__dirname, '../attached_assets/Full_Database_schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  const tables = {};
  const tableRegex = /CREATE TABLE public\.(\w+)\s*\(([\s\S]*?)\);/g;
  
  let match;
  while ((match = tableRegex.exec(schema)) !== null) {
    const tableName = match[1];
    const columnDefs = match[2];
    const columns = parseColumns(columnDefs);
    const foreignKeys = parseForeignKeys(columnDefs);
    
    tables[tableName] = { columns, foreignKeys };
  }
  
  return tables;
}

/**
 * Parse column definitions from a CREATE TABLE statement
 * @param {string} columnDefs - The column definitions string from CREATE TABLE
 * @returns {Object} Dictionary of column names to their properties
 */
function parseColumns(columnDefs) {
  const columns = {};
  const lines = columnDefs.split('\n').filter(line => !line.trim().startsWith('CONSTRAINT'));
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) return;
    
    // Match: column_name TYPE [NOT NULL] [DEFAULT value]
    const match = trimmed.match(/^(\w+)\s+([\w\s\[\]()]+?)(?:\s+NOT NULL)?(?:\s+DEFAULT\s+(.+?))?(?:\s+CHECK.*)?(?:,|$)/);
    if (match) {
      const [, name, rawType, defaultValue] = match;
      const type = rawType.trim().split(/\s+/)[0]; // Extract base type
      
      columns[name] = {
        type,
        nullable: !line.includes('NOT NULL'),
        hasDefault: !!defaultValue || line.includes('DEFAULT'),
        defaultValue
      };
    }
  });
  
  return columns;
}

/**
 * Parse foreign key constraints from column definitions
 * @param {string} columnDefs - The column definitions string from CREATE TABLE
 * @returns {Array} Array of foreign key definitions
 */
function parseForeignKeys(columnDefs) {
  const foreignKeys = [];
  const fkRegex = /CONSTRAINT\s+\w+\s+FOREIGN KEY\s+\((\w+)\)\s+REFERENCES\s+public\.(\w+)\((\w+)\)/g;
  
  let match;
  while ((match = fkRegex.exec(columnDefs)) !== null) {
    foreignKeys.push({
      column: match[1],
      referencedTable: match[2],
      referencedColumn: match[3]
    });
  }
  
  return foreignKeys;
}

module.exports = { parseSchema };
