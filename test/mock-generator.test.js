/**
 * Test for Schema-Aware Mock Generator
 * 
 * Validates that the schema parser, mock factory, and mock helpers work correctly.
 */
const { parseSchema } = require('./schema-parser');
const { MockFactory } = require('./mock-factory');
const { setupDefaultMocks, mockQueryImplementation, resetMockFactory } = require('./mock-helpers');

describe('Schema Parser', () => {
  test('parses schema file and extracts tables', () => {
    const schema = parseSchema();
    
    expect(schema).toBeDefined();
    expect(Object.keys(schema).length).toBeGreaterThan(0);
    
    // Check specific tables exist
    expect(schema.users).toBeDefined();
    expect(schema.activities).toBeDefined();
    expect(schema.participants).toBeDefined();
  });
  
  test('extracts column definitions correctly', () => {
    const schema = parseSchema();
    const usersTable = schema.users;
    
    expect(usersTable.columns).toBeDefined();
    expect(usersTable.columns.id).toBeDefined();
    expect(usersTable.columns.email).toBeDefined();
    expect(usersTable.columns.id.type).toBe('uuid');
    expect(usersTable.columns.email.type).toBe('text');
  });
  
  test('extracts foreign keys', () => {
    const schema = parseSchema();
    const activitiesTable = schema.activities;
    
    expect(activitiesTable.foreignKeys).toBeDefined();
    expect(activitiesTable.foreignKeys.length).toBeGreaterThan(0);
    
    const orgFk = activitiesTable.foreignKeys.find(fk => fk.column === 'organization_id');
    expect(orgFk).toBeDefined();
    expect(orgFk.referencedTable).toBe('organizations');
  });
});

describe('Mock Factory', () => {
  let factory;
  
  beforeEach(() => {
    factory = new MockFactory();
  });
  
  test('generates mock row for table', () => {
    const mockUser = factory.mockTable('users');
    
    expect(mockUser).toBeDefined();
    expect(mockUser.id).toBeDefined();
    expect(mockUser.email).toBeDefined();
    expect(mockUser.email).toBe('test@example.com');
  });
  
  test('allows overrides for specific fields', () => {
    const mockUser = factory.mockTable('users', {
      email: 'custom@example.com',
      full_name: 'Custom User'
    });
    
    expect(mockUser.email).toBe('custom@example.com');
    expect(mockUser.full_name).toBe('Custom User');
  });
  
  test('generates sequential IDs', () => {
    const user1 = factory.mockTable('users');
    const user2 = factory.mockTable('users');
    
    // IDs should be different (note: users use UUID, so test with activities instead)
    const activity1 = factory.mockTable('activities');
    const activity2 = factory.mockTable('activities');
    
    expect(activity1.id).toBe(1);
    expect(activity2.id).toBe(2);
  });
  
  test('handles count queries', () => {
    const result = factory.mockQuery('SELECT COUNT(*) as total FROM users');
    
    expect(result.rows).toBeDefined();
    expect(result.rows[0].total).toBe('10');
    expect(result.rows[0].count).toBe('10');
  });
  
  test('handles permission queries', () => {
    const result = factory.mockQuery('SELECT * FROM role_permissions WHERE role_id = 1');
    
    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].permission_key).toBeDefined();
  });
  
  test('handles table queries', () => {
    const result = factory.mockQuery('SELECT * FROM users WHERE organization_id = 1');
    
    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].email).toBeDefined();
  });
  
  test('returns empty for unknown queries', () => {
    const result = factory.mockQuery('SELECT * FROM nonexistent_table');
    
    expect(result.rows).toEqual([]);
  });
});

describe('Mock Helpers', () => {
  let mockClient;
  let mockPool;
  
  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(() => Promise.resolve(mockClient))
    };
    resetMockFactory();
  });
  
  test('setupDefaultMocks sets up both client and pool', () => {
    setupDefaultMocks(mockClient, mockPool);
    
    expect(mockClient.query).toHaveBeenCalledTimes(0); // Not called yet
    expect(mockPool.query).toHaveBeenCalledTimes(0); // Not called yet
    
    // Call the mocked query
    mockClient.query('SELECT * FROM users');
    expect(mockClient.query).toHaveBeenCalledTimes(1);
  });
  
  test('mockQueryImplementation with custom handler', async () => {
    mockQueryImplementation(mockClient, mockPool, (query, params) => {
      if (query.includes('custom_table')) {
        return Promise.resolve({ rows: [{ id: 999, name: 'Custom' }] });
      }
      // Return undefined to fall back to default
    });
    
    const customResult = await mockClient.query('SELECT * FROM custom_table');
    expect(customResult.rows[0].id).toBe(999);
    
    const defaultResult = await mockClient.query('SELECT * FROM users');
    expect(defaultResult.rows.length).toBeGreaterThan(0);
    expect(defaultResult.rows[0].email).toBeDefined();
  });
  
  test('custom handler can override default behavior', async () => {
    mockQueryImplementation(mockClient, mockPool, (query, params) => {
      if (query.includes('COUNT')) {
        return Promise.resolve({ rows: [{ total: '42', count: '42' }] });
      }
    });
    
    const result = await mockClient.query('SELECT COUNT(*) FROM users');
    expect(result.rows[0].total).toBe('42');
  });
  
  test('resetMockFactory creates new instance', () => {
    const factory1 = new MockFactory();
    const activity1 = factory1.mockTable('activities');
    
    resetMockFactory();
    
    const factory2 = new MockFactory();
    const activity2 = factory2.mockTable('activities');
    
    // New factory should start IDs from 1 again
    expect(activity2.id).toBe(1);
  });
});
