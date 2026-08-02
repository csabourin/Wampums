'use strict';

const fs = require('fs');
const path = require('path');
const { resolveDatabaseConnectionString } = require('../config/database-url');

describe('database connection URL compatibility', () => {
  test('prefers the canonical DATABASE_URL', () => {
    expect(resolveDatabaseConnectionString({
      DATABASE_URL: 'postgresql://canonical/database',
      SB_URL: 'postgresql://legacy/database',
    })).toBe('postgresql://canonical/database');
  });

  test('retains SB_URL for deployments that have not migrated yet', () => {
    expect(resolveDatabaseConnectionString({
      SB_URL: 'postgresql://legacy/database',
    })).toBe('postgresql://legacy/database');
  });

  test('allows individual DB variables when no URL is configured', () => {
    expect(resolveDatabaseConnectionString({ DB_HOST: 'localhost' })).toBeUndefined();
  });

  test('the pool and announcement listener share the compatibility resolver', () => {
    const databaseSource = fs.readFileSync(
      path.join(__dirname, '..', 'config', 'database.js'),
      'utf8',
    );
    const announcementSource = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'announcements.js'),
      'utf8',
    );

    expect(databaseSource).toContain('resolveDatabaseConnectionString()');
    expect(announcementSource).toContain('connectionString: resolveDatabaseConnectionString()');
  });
});
