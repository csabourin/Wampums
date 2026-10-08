/**
 * Mock Helper Functions
 * Provides setupDefaultMocks and mockQueryImplementation
 */
const { MockFactory } = require('./mock-factory');

let globalFactory = null;

/**
 * Get or create the global MockFactory instance
 * @returns {MockFactory} The factory instance
 */
function getFactory() {
  if (!globalFactory) {
    globalFactory = new MockFactory();
  }
  return globalFactory;
}

/**
 * The active scout year handed to any route that resolves one.
 *
 * Read endpoints are year-scoped, so almost every handler now asks for the
 * active year before running its own query. Generating that row from the schema
 * would produce arbitrary boundaries and a random status, which is exactly the
 * kind of detail every test would then have to stub for itself.
 */
const DEFAULT_SCOUT_YEAR = {
  id: 1,
  organization_id: 1,
  label: '2025-2026',
  start_date: '2025-09-01',
  end_date: '2026-08-31',
  status: 'active'
};

/**
 * Match the authentication middleware's live-membership lookup.
 *
 * Route tests normally describe an authenticated organization member. Keeping
 * this prerequisite separate prevents a handler-specific empty result from
 * accidentally turning the test into an authentication-denial test.
 *
 * @param {string|Object} query - SQL query or pg query config
 * @param {Array} params - Query parameters
 * @returns {Object|undefined} Active membership result for the auth lookup
 */
function mockActiveMembershipQuery(query, params = []) {
  const queryText = typeof query === 'string' ? query : query?.text;
  if (typeof queryText !== 'string') {return undefined;}

  const normalized = queryText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized.includes(
    "select organization_id from user_organizations where user_id = $1 and organization_id = $2 and status = 'active'"
  )) {
    return { rows: [{ organization_id: params[1] }] };
  }
  return undefined;
}

/**
 * Answer the scout year lookup, letting everything else fall through.
 *
 * @param {string} query - SQL being run
 * @returns {Object|undefined} Result when this is the year lookup
 */
function mockScoutYearQuery(query) {
  if (typeof query === 'string' && query.includes('FROM scout_years')) {
    return { rows: [{ ...DEFAULT_SCOUT_YEAR }] };
  }
  return undefined;
}

/**
 * Answer the registration eligibility lookup with "no such account".
 *
 * Registration checks whether the address already exists before inserting, so
 * that a deactivated member or a parent from a sister unit is sent to the
 * reactivation flow instead of colliding with the unique index on
 * `users.email`. The schema-based factory answers any recognisable SELECT with
 * an invented row, which would make every address look taken and turn every
 * registration test into a duplicate-address test.
 *
 * Registering a fresh address is the default the suite wants, so it is the
 * default here. A test about an address that *does* exist stubs this shape
 * itself, exactly as it would any other precondition.
 *
 * @param {string|Object} query - SQL being run
 * @returns {Object|undefined} Empty result when this is the eligibility lookup
 */
function mockRegistrationStandingQuery(query) {
  const queryText = typeof query === 'string' ? query : query?.text;
  if (typeof queryText !== 'string') {return undefined;}

  const normalized = queryText.replace(/\s+/g, ' ');
  if (normalized.includes('FROM users u LEFT JOIN user_organizations uo')) {
    return { rows: [] };
  }
  return undefined;
}

/**
 * Build the result of the atomic authorization query for ordered
 * `mockResolvedValueOnce` queues.
 * @param {Object} [context] - Authorization fixture
 * @param {Array<string>} [context.permissions] - Permission keys held
 * @param {Array<Object>} [context.roles] - Rows of { role_name, display_name, data_scope }
 * @param {Object} [context.forms] - Per-form rights keyed by form type
 * @param {string} [context.status] - Membership status
 * @returns {{rows: Array<Object>}} Query result
 */
function authorizationContextRow({ permissions = [], roles = [], forms = {}, status = 'active' } = {}) {
  return { rows: [{
    status,
    authorization_permissions: permissions,
    authorization_roles: roles.map((role) => ({ data_scope: 'linked', ...role })),
    authorization_forms: forms,
  }] };
}

/**
 * Assemble the atomic authorization row from the same logical fixture queries
 * used by route tests. This adapter keeps business-query fixtures independent
 * of authorization SQL layout; the production query remains a single snapshot.
 */
async function mockAuthorizationContext(query, params, factory, customHandler = null) {
  if (typeof query !== 'string' || !query.includes('AS authorization_permissions')) {return undefined;}
  const resolve = async (sql, values = params) => {
    const custom = customHandler ? await customHandler(sql, values) : undefined;
    return custom ?? factory.mockQuery(sql, values);
  };
  const status = await resolve('SELECT status FROM user_organizations WHERE user_id = $1 AND organization_id = $2');
  const permissions = await resolve(`SELECT DISTINCT p.permission_key FROM user_organizations uo
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
    JOIN role_permissions rp ON rp.role_id = role_id_text::integer
    JOIN permissions p ON p.id = rp.permission_id
    WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active'`);
  const roles = await resolve(`SELECT DISTINCT r.role_name, r.display_name FROM user_organizations uo
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
    JOIN roles r ON r.id = role_id_text::integer
    WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active'`);
  const scopeSql = `SELECT DISTINCT r.data_scope FROM user_organizations uo
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(uo.role_ids, '[]'::jsonb)) AS role_id_text
    JOIN roles r ON r.id = role_id_text::integer
    WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.status = 'active' ORDER BY r.data_scope DESC`;
  const explicitScopes = customHandler ? await customHandler(scopeSql, params) : undefined;
  const scopes = explicitScopes ?? factory.mockQuery(scopeSql, params);
  const demo = await resolve(`SELECT DISTINCT r.role_name FROM user_organizations uo
    JOIN roles r ON true WHERE r.role_name IN ('demoadmin', 'demoparent')`);
  const formRows = await resolve(`SELECT off.form_type,
    MAX(CASE WHEN fp.can_view THEN 1 ELSE 0 END)::boolean AS can_view,
    MAX(CASE WHEN fp.can_submit THEN 1 ELSE 0 END)::boolean AS can_submit,
    MAX(CASE WHEN fp.can_edit THEN 1 ELSE 0 END)::boolean AS can_edit,
    MAX(CASE WHEN fp.can_approve THEN 1 ELSE 0 END)::boolean AS can_approve
    FROM organization_form_formats off JOIN form_permissions fp ON fp.form_format_id = off.id
    JOIN roles r ON r.id = fp.role_id WHERE off.organization_id = $1 AND r.role_name = ANY($2)
    GROUP BY off.form_type`, [params[1], roles.rows.map((row) => row.role_name)]);
  return { rows: [{
    status: status.rows[0]?.status || 'active',
    authorization_permissions: permissions.rows.map((row) => row.permission_key),
    authorization_roles: [...(roles.rows.length ? roles.rows : scopes.rows.map((row) => ({ ...row, role_name: 'fixture_role', display_name: 'Fixture role' }))).map((row) => ({ ...row, data_scope: explicitScopes ? explicitScopes.rows[0]?.data_scope || 'linked' : row.data_scope || scopes.rows[0]?.data_scope || 'linked' })),
      ...demo.rows.filter((row) => ['demoadmin', 'demoparent'].includes(row.role_name))],
    authorization_forms: Object.fromEntries(formRows.rows.map((row) => [row.form_type, row])),
  }] };
}

/**
 * Setup default mocks for all database queries
 * Uses schema-aware mock generation for all queries
 * 
 * @param {Object} __mClient - Mocked pg client
 * @param {Object} __mPool - Mocked pg pool
 * 
 * @example
 * ```javascript
 * const { __mClient, __mPool } = require('pg');
 * setupDefaultMocks(__mClient, __mPool);
 * ```
 */
function setupDefaultMocks(__mClient, __mPool) {
  const factory = getFactory();
  
  const handler = async (query, params) => {
    const authorization = await mockAuthorizationContext(query, params, factory);
    if (authorization) {return authorization;}
    return Promise.resolve(
      mockScoutYearQuery(query)
      || mockRegistrationStandingQuery(query)
      || factory.mockQuery(query, params)
    );
  };

  __mClient.query.mockImplementation(handler);
  __mPool.query.mockImplementation(handler);
}

/**
 * Setup custom mock implementation with fallback
 * Custom handler is tried first, then falls back to schema-based mocks
 * 
 * @param {Object} __mClient - Mocked pg client
 * @param {Object} __mPool - Mocked pg pool
 * @param {Function} customHandler - Custom query handler (query, params) => result
 * @param {Object} options - Set activeMembership to false for explicit denial tests
 * 
 * @example
 * ```javascript
 * const { __mClient, __mPool } = require('pg');
 * mockQueryImplementation(__mClient, __mPool, (query, params) => {
 *   if (query.includes('FROM users') && query.includes('status')) {
 *     return Promise.resolve({
 *       rows: [factory.mockTable('users', { status: 'pending' })]
 *     });
 *   }
 *   // Return undefined to trigger fallback to schema-based mock
 * });
 * ```
 */
function mockQueryImplementation(
  __mClient,
  __mPool,
  customHandler,
  { activeMembership = true } = {}
) {
  const factory = getFactory();
  
  const handler = async (query, params) => {
    const authorization = await mockAuthorizationContext(query, params, factory, customHandler);
    if (authorization) {return authorization;}
    if (activeMembership) {
      const membership = mockActiveMembershipQuery(query, params);
      if (membership) {return membership;}
    }
    // Try custom handler first (supports sync + async handlers)
    const customResult = await customHandler(query, params);
    if (customResult !== undefined && customResult !== null) {
      return customResult;
    }

    // Fall back to the scout year and registration standing, then to the
    // schema-based mock
    return mockScoutYearQuery(query)
      || mockRegistrationStandingQuery(query)
      || factory.mockQuery(query, params);
  };
  
  __mClient.query.mockImplementation(handler);
  __mPool.query.mockImplementation(handler);
}

/**
 * Reset factory (useful for test isolation)
 * Creates a new factory instance with fresh ID counters
 * 
 * @example
 * ```javascript
 * beforeEach(() => {
 *   resetMockFactory();
 * });
 * ```
 */
function resetMockFactory() {
  globalFactory = null;
}

/** Adapt a hand-built database fixture to the shared atomic authorization query. */
function adaptAuthorizationMock(pool) {
  const original = pool.query.getMockImplementation();
  pool.query.mockImplementation(async (query, params = []) => {
    const authorization = await mockAuthorizationContext(query, params, getFactory(), original);
    return authorization || original(query, params);
  });
}

module.exports = {
  adaptAuthorizationMock,
  authorizationContextRow,
  setupDefaultMocks,
  mockQueryImplementation,
  resetMockFactory,
  MockFactory,
  DEFAULT_SCOUT_YEAR,
  mockActiveMembershipQuery
};
