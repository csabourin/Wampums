/**
 * Mock Data Factory
 * Generates realistic mock data based on database schema
 */
const { parseSchema } = require('./schema-parser');

class MockFactory {
  constructor() {
    this.schema = parseSchema();
    this.idCounters = {};
  }
  
  /**
   * Generate mock row for a table
   * @param {string} tableName - Name of the table
   * @param {Object} overrides - Custom values to override defaults
   * @returns {Object} Mock row data
   */
  mockTable(tableName, overrides = {}) {
    const table = this.schema[tableName];
    if (!table) {
      console.warn(`Table ${tableName} not found in schema`);
      return {};
    }
    
    const row = {};
    Object.entries(table.columns).forEach(([colName, colDef]) => {
      if (overrides[colName] !== undefined) {
        row[colName] = overrides[colName];
      } else {
        row[colName] = this.generateValue(tableName, colName, colDef);
      }
    });
    
    return row;
  }
  
  /**
   * Generate value based on column type
   * @param {string} tableName - Name of the table
   * @param {string} colName - Name of the column
   * @param {Object} colDef - Column definition with type, nullable, hasDefault
   * @returns {*} Generated value
   */
  generateValue(tableName, colName, colDef) {
    const { type, nullable, hasDefault } = colDef;
    
    // Handle nullable columns
    if (nullable && !hasDefault && Math.random() < 0.1) {
      return null;
    }
    
    // Type-specific generation
    switch (type.toLowerCase()) {
      case 'integer':
      case 'bigint':
        return this.generateId(tableName, colName);
      
      case 'uuid':
        return '550e8400-e29b-41d4-a716-446655440000';
      
      case 'character':
      case 'text':
        return this.generateString(colName);
      
      case 'boolean':
        return colName.startsWith('is_') ? true : false;
      
      case 'timestamp':
      case 'date':
        return new Date('2026-01-01').toISOString();
      
      case 'time':
        return '09:00:00';
      
      case 'numeric':
      case 'double':
        return colName.includes('amount') || colName.includes('fee') ? 100.00 : 42.5;
      
      case 'jsonb':
      case 'json':
        return colName.includes('array') || colName.endsWith('_ids') ? [] : {};
      
      case 'ARRAY':
        return [];
      
      default:
        return null;
    }
  }
  
  /**
   * Generate sequential ID for a table column
   * @param {string} tableName - Name of the table
   * @param {string} colName - Name of the column
   * @returns {number} Sequential ID
   */
  generateId(tableName, colName) {
    const key = `${tableName}.${colName}`;
    if (!this.idCounters[key]) {
      this.idCounters[key] = 1;
    }
    return this.idCounters[key]++;
  }
  
  /**
   * Generate string value based on column name
   * @param {string} colName - Name of the column
   * @returns {string} Generated string
   */
  generateString(colName) {
    const stringMap = {
      email: 'test@example.com',
      name: 'Test Name',
      first_name: 'John',
      last_name: 'Doe',
      full_name: 'John Doe',
      description: 'Test description',
      message: 'Test message',
      subject: 'Test subject',
      role_name: 'admin',
      permission_key: 'users.view',
      status: 'active'
    };
    
    return stringMap[colName] || 'Test Value';
  }
  
  /**
   * Smart query response generator
   * Analyzes query and generates appropriate mock response
   * @param {string|Object} query - SQL query string or object
   * @param {Array} params - Query parameters
   * @returns {Object} Mock query result with rows array
   */
  mockQuery(query, params = []) {
    const queryStr = typeof query === 'string' ? query : (query.text || '');
    const queryLower = queryStr.toLowerCase();
    
    // COUNT queries - return both total and count for compatibility
    if (queryLower.includes('count(')) {
      return { rows: [{ total: '10', count: '10' }] };
    }
    
    // Permission checks
    if (queryLower.includes('from role_permissions') || queryLower.includes('from permissions')) {
      return { 
        rows: [{ 
          permission_id: 1,
          permission_key: 'users.view',
          permission_name: 'View Users',
          category: 'users'
        }] 
      };
    }
    
    // Role checks
    if (queryLower.includes('from roles')) {
      return { 
        rows: [{ 
          id: 1,
          role_name: 'admin',
          display_name: 'Administrator',
          data_scope: 'organization'
        }] 
      };
    }
    
    // User organization membership
    if (queryLower.includes('from user_organizations')) {
      return { 
        rows: [{ 
          user_id: '550e8400-e29b-41d4-a716-446655440000',
          organization_id: 3,
          role_ids: [1]
        }] 
      };
    }
    
    // Extract table name from query
    const tableMatch = queryStr.match(/FROM\s+(?:public\.)?(\w+)/i);
    if (tableMatch) {
      const tableName = tableMatch[1];
      
      // Check if it's a SELECT with WHERE clause (single row expected)
      if (queryLower.includes('where') && queryLower.includes('select')) {
        if (this.schema[tableName]) {
          return { rows: [this.mockTable(tableName)] };
        }
      }
      
      // Multiple rows
      if (queryLower.includes('select') && this.schema[tableName]) {
        return { 
          rows: [
            this.mockTable(tableName),
            this.mockTable(tableName)
          ] 
        };
      }
    }
    
    // Default: empty result
    return { rows: [] };
  }
}

module.exports = { MockFactory };
