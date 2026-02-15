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

    // Demo-role checks for blockDemoRoles middleware should default to non-demo
    if (queryLower.includes("r.role_name in ('demoadmin', 'demoparent')")) {
      return { rows: [] };
    }
    
    // Permission checks (supports both FROM and JOIN patterns)
    if (
      queryLower.includes(' role_permissions ') ||
      queryLower.includes(' permissions ') ||
      queryLower.includes('permission_key')
    ) {
      return { 
        rows: [
          // User permissions
          { permission_id: 1, permission_key: 'users.view', permission_name: 'View Users', category: 'users' },
          { permission_id: 2, permission_key: 'users.manage', permission_name: 'Manage Users', category: 'users' },
          { permission_id: 3, permission_key: 'users.edit', permission_name: 'Edit Users', category: 'users' },
          { permission_id: 4, permission_key: 'users.assign_roles', permission_name: 'Assign User Roles', category: 'users' },
          
          // Participant permissions
          { permission_id: 5, permission_key: 'participants.view', permission_name: 'View Participants', category: 'participants' },
          { permission_id: 6, permission_key: 'participants.edit', permission_name: 'Edit Participants', category: 'participants' },
          { permission_id: 7, permission_key: 'participants.create', permission_name: 'Create Participants', category: 'participants' },
          { permission_id: 8, permission_key: 'participants.delete', permission_name: 'Delete Participants', category: 'participants' },
          
          // Activity permissions
          { permission_id: 9, permission_key: 'activities.view', permission_name: 'View Activities', category: 'activities' },
          { permission_id: 10, permission_key: 'activities.create', permission_name: 'Create Activities', category: 'activities' },
          { permission_id: 11, permission_key: 'activities.edit', permission_name: 'Edit Activities', category: 'activities' },
          { permission_id: 12, permission_key: 'activities.delete', permission_name: 'Delete Activities', category: 'activities' },
          
          // Medication permissions
          { permission_id: 13, permission_key: 'medication.view', permission_name: 'View Medication', category: 'medication' },
          { permission_id: 14, permission_key: 'medication.manage', permission_name: 'Manage Medication', category: 'medication' },
          
          // Finance permissions
          { permission_id: 15, permission_key: 'finance.view', permission_name: 'View Finance', category: 'finance' },
          { permission_id: 16, permission_key: 'finance.manage', permission_name: 'Manage Finance', category: 'finance' },
          
          // Budget permissions
          { permission_id: 17, permission_key: 'budget.view', permission_name: 'View Budget', category: 'budget' },
          { permission_id: 18, permission_key: 'budget.manage', permission_name: 'Manage Budget', category: 'budget' },
          
          // Attendance permissions
          { permission_id: 19, permission_key: 'attendance.view', permission_name: 'View Attendance', category: 'attendance' },
          { permission_id: 20, permission_key: 'attendance.manage', permission_name: 'Manage Attendance', category: 'attendance' },
          
          // Forms permissions
          { permission_id: 21, permission_key: 'forms.view', permission_name: 'View Forms', category: 'forms' },
          { permission_id: 22, permission_key: 'forms.manage', permission_name: 'Manage Forms', category: 'forms' },
          
          // Guardian permissions
          { permission_id: 23, permission_key: 'guardians.view', permission_name: 'View Guardians', category: 'guardians' },
          { permission_id: 24, permission_key: 'guardians.manage', permission_name: 'Manage Guardians', category: 'guardians' },
          
          // Carpool permissions
          { permission_id: 25, permission_key: 'carpools.view', permission_name: 'View Carpools', category: 'carpools' },
          
          // Groups permissions
          { permission_id: 26, permission_key: 'groups.view', permission_name: 'View Groups', category: 'groups' },
          { permission_id: 27, permission_key: 'groups.create', permission_name: 'Create Groups', category: 'groups' },
          { permission_id: 28, permission_key: 'groups.edit', permission_name: 'Edit Groups', category: 'groups' },
          { permission_id: 29, permission_key: 'groups.delete', permission_name: 'Delete Groups', category: 'groups' },
          
          // Badge permissions
          { permission_id: 30, permission_key: 'badges.view', permission_name: 'View Badges', category: 'badges' },
          { permission_id: 31, permission_key: 'badges.manage', permission_name: 'Manage Badges', category: 'badges' },
          { permission_id: 32, permission_key: 'badges.approve', permission_name: 'Approve Badges', category: 'badges' },
          
          // Points permissions
          { permission_id: 33, permission_key: 'points.view', permission_name: 'View Points', category: 'points' },
          { permission_id: 34, permission_key: 'points.manage', permission_name: 'Manage Points', category: 'points' },
          
          // Honors permissions
          { permission_id: 35, permission_key: 'honors.view', permission_name: 'View Honors', category: 'honors' },
          { permission_id: 36, permission_key: 'honors.create', permission_name: 'Create Honors', category: 'honors' },
          
          // Fundraiser permissions
          { permission_id: 37, permission_key: 'fundraisers.view', permission_name: 'View Fundraisers', category: 'fundraisers' },
          { permission_id: 38, permission_key: 'fundraisers.create', permission_name: 'Create Fundraisers', category: 'fundraisers' },
          { permission_id: 39, permission_key: 'fundraisers.edit', permission_name: 'Edit Fundraisers', category: 'fundraisers' },
          
          // Reports permissions
          { permission_id: 40, permission_key: 'reports.view', permission_name: 'View Reports', category: 'reports' },
          
          // Role permissions
          { permission_id: 41, permission_key: 'roles.view', permission_name: 'View Roles', category: 'roles' },
          { permission_id: 42, permission_key: 'roles.manage', permission_name: 'Manage Roles', category: 'roles' },
          
          // Organization permissions
          { permission_id: 43, permission_key: 'org.view', permission_name: 'View Organization', category: 'org' },
          { permission_id: 44, permission_key: 'org.edit', permission_name: 'Edit Organization', category: 'org' },
          { permission_id: 45, permission_key: 'org.create', permission_name: 'Create Organization', category: 'org' },
          { permission_id: 46, permission_key: 'org.register', permission_name: 'Register Organization', category: 'org' },
          
          // Inventory permissions
          { permission_id: 47, permission_key: 'inventory.view', permission_name: 'View Inventory', category: 'inventory' },
          { permission_id: 48, permission_key: 'inventory.manage', permission_name: 'Manage Inventory', category: 'inventory' },
          { permission_id: 49, permission_key: 'inventory.reserve', permission_name: 'Reserve Inventory', category: 'inventory' },
          
          // Communications permissions
          { permission_id: 50, permission_key: 'communications.send', permission_name: 'Send Communications', category: 'communications' },
          
          // Permission slip permissions
          { permission_id: 51, permission_key: 'permission_slips.sign', permission_name: 'Sign Permission Slips', category: 'permission_slips' }
        ]
      };
    }
    
    // Role checks
    if (queryLower.includes(' roles ') && !queryLower.includes('role_permissions')) {
      return { 
        rows: [{ 
          id: 1,
          role_name: 'district',
          display_name: 'District Leader',
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
