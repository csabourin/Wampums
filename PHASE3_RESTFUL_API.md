# Phase 3: RESTful API & Architecture Improvements Complete ✅

## Summary

Successfully implemented **Phase 3: RESTful API & Architecture Improvements** for the Wampums Scout Management Application. The application now features a **modern RESTful API architecture** with proper authentication middleware, standardized responses, comprehensive API documentation, and database migration infrastructure.

---

## What Was Accomplished

### 1. ✅ RESTful API Architecture

**Before (Legacy API):**
```javascript
GET /api?action=getParticipants&organizationId=123
POST /api?action=addParticipant
```

**After (RESTful API v1):**
```javascript
GET    /api/v1/participants          # List all participants
GET    /api/v1/participants/:id      # Get one participant
POST   /api/v1/participants          # Create participant
PUT    /api/v1/participants/:id      # Update participant
DELETE /api/v1/participants/:id      # Delete participant
```

**Benefits:**
- ✅ **Semantic HTTP verbs** (GET, POST, PUT, DELETE)
- ✅ **Resource-based URLs** (nouns, not actions)
- ✅ **API versioning** (/api/v1 for future compatibility)
- ✅ **Standard REST conventions**
- ✅ **Clear intent** from URL structure

### 2. ✅ Authentication Middleware

**Created:** `middleware/auth.js`

**Features:**
- JWT token validation
- Role-based authorization (admin, animation, parent)
- Optional authentication (for public/private hybrid endpoints)
- Organization ID extraction from token
- Automatic error handling

**Example Usage:**
```javascript
// Require authentication
router.get('/participants', authenticate, asyncHandler(async (req, res) => {
  // req.user is populated: { id, role, organizationId }
}));

// Require specific roles
router.delete('/participants/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    // Only admins can delete
  })
);

// Optional authentication (different response if authenticated)
router.get('/public-data', optionalAuth, asyncHandler(async (req, res) => {
  if (req.user) {
    // Return personalized data
  } else {
    // Return public data only
  }
}));
```

### 3. ✅ Standardized Response Middleware

**Created:** `middleware/response.js`

**Response Formats:**

**Success Response:**
```json
{
  "success": true,
  "message": "Participant created successfully",
  "data": {
    "id": 123,
    "first_name": "Jean",
    "last_name": "Dupont"
  },
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ],
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**Paginated Response:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 234,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  },
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**Benefits:**
- ✅ **Consistent structure** across all endpoints
- ✅ **Timestamp tracking** for debugging
- ✅ **Clear success/error indication**
- ✅ **Automatic error handling** with asyncHandler
- ✅ **Pagination metadata** built-in

### 4. ✅ RESTful Routes Implementation

**Created Three Route Modules:**

#### **A. Participants Routes** (`routes/participants.js`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/participants` | List all participants (paginated) | Required |
| GET | `/api/v1/participants/:id` | Get single participant | Required |
| POST | `/api/v1/participants` | Create new participant | Required |
| PUT | `/api/v1/participants/:id` | Update participant | Required |
| DELETE | `/api/v1/participants/:id` | Delete participant | Admin only |

**Features:**
- Automatic organization filtering (users only see their org's data)
- Pagination support (default 50 items per page)
- Search/filter capabilities (query parameters)
- Full CRUD operations

**Example Request:**
```bash
GET /api/v1/participants?page=2&limit=25&search=Dupont
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

Response:
{
  "success": true,
  "data": [
    { "id": 45, "first_name": "Marie", "last_name": "Dupont", ... },
    { "id": 78, "first_name": "Paul", "last_name": "Dupont-Martin", ... }
  ],
  "pagination": {
    "page": 2,
    "limit": 25,
    "total": 52,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": true
  }
}
```

#### **B. Attendance Routes** (`routes/attendance.js`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/attendance` | Get attendance records (paginated) | Required |
| GET | `/api/v1/attendance/dates` | Get available attendance dates | Required |
| POST | `/api/v1/attendance` | Record attendance | Admin/Animation |

**Features:**
- Automatic point calculation on attendance changes
- Upsert logic (insert or update)
- Previous status tracking for point corrections
- Date filtering capabilities

**Example Request:**
```bash
POST /api/v1/attendance
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "participant_id": 123,
  "date": "2025-01-30",
  "status": "P",
  "previous_status": "A"
}

Response:
{
  "success": true,
  "message": "Attendance recorded successfully",
  "data": {
    "participant_id": 123,
    "date": "2025-01-30",
    "status": "P",
    "points_awarded": 2
  }
}
```

#### **C. Groups Routes** (`routes/groups.js`)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/groups` | List all groups | Required |
| GET | `/api/v1/groups/:id` | Get group with members and total points | Required |
| POST | `/api/v1/groups` | Create new group | Admin only |
| PUT | `/api/v1/groups/:id` | Update group | Admin only |
| DELETE | `/api/v1/groups/:id` | Delete group | Admin only |

**Features:**
- Automatic total points calculation (sum of all members)
- Member list included in group details
- Nested resource handling (groups → members)
- Color/theme support for groups

**Example Request:**
```bash
GET /api/v1/groups/5
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

Response:
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Les Castors",
    "color": "#FF5722",
    "total_points": 245,
    "members": [
      { "id": 12, "first_name": "Alice", "points": 85 },
      { "id": 34, "first_name": "Bob", "points": 90 },
      { "id": 56, "first_name": "Charlie", "points": 70 }
    ]
  }
}
```

### 5. ✅ Swagger/OpenAPI Documentation

**Created:** `config/swagger.js`

**Features:**
- Interactive API documentation at `/api-docs`
- Try-it-out functionality for testing endpoints
- Complete request/response examples
- Authentication testing (Bearer token input)
- Schema definitions for all models

**Access Documentation:**
```bash
# Start server
npm start

# Open browser to:
http://localhost:3000/api-docs
```

**Documentation Includes:**
- All endpoints with descriptions
- Required/optional parameters
- Request body schemas
- Response examples (success & error)
- Authentication requirements
- HTTP status codes

**Swagger Schemas Defined:**
```javascript
- Participant: Full participant object with all fields
- Group: Group with members and points
- Attendance: Attendance record with status
- Error: Standard error response
- Success: Standard success response
- PaginatedParticipants: Paginated participant list
```

### 6. ✅ Database Migration Infrastructure

**Created:**
- `.migrations-config.json` - Migration configuration
- `README-MIGRATIONS.md` - Comprehensive migration guide
- `migrations/` directory - For migration files

**Package Scripts Added:**
```json
{
  "migrate": "node-pg-migrate",
  "migrate:up": "node-pg-migrate up",
  "migrate:down": "node-pg-migrate down",
  "migrate:create": "node-pg-migrate create"
}
```

**Usage Examples:**

**Create Migration:**
```bash
npm run migrate create add-notifications-table

# Creates: migrations/1706644800000_add-notifications-table.js
```

**Run Migrations:**
```bash
export DATABASE_URL="postgresql://user:pass@host/db"
npm run migrate up

# Output:
> Running migration: 1706644800000_add-notifications-table.js
> Migration complete
```

**Rollback:**
```bash
npm run migrate down

# Rolls back the last applied migration
```

**Check Status:**
```bash
npm run migrate status

# Shows which migrations are applied/pending
```

**Migration Example:**
```javascript
// migrations/1706644800000_add-notifications-table.js
exports.up = (pgm) => {
  pgm.createTable('notifications', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users'
    },
    message: { type: 'text' },
    read: { type: 'boolean', default: false },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('notifications', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('notifications');
};
```

**Benefits:**
- ✅ **Version-controlled schema** changes
- ✅ **Rollback capability** for failed migrations
- ✅ **Team collaboration** (migrations tracked in git)
- ✅ **Atomic changes** (transactions by default)
- ✅ **Production deployment** safety

---

## File Structure Changes

### New Directories Created
```
/home/user/Wampums/
├── middleware/               # Middleware functions
│   ├── auth.js              # Authentication & authorization
│   └── response.js          # Standardized responses
├── routes/                  # RESTful API routes
│   ├── participants.js      # Participant CRUD
│   ├── attendance.js        # Attendance tracking
│   └── groups.js            # Group management
├── config/                  # Configuration files
│   └── swagger.js           # OpenAPI/Swagger config
└── migrations/              # Database migrations (empty, ready for use)
```

### New Files Created
```
✅ middleware/auth.js              # 98 lines - Authentication middleware
✅ middleware/response.js          # 73 lines - Response helpers
✅ routes/participants.js          # 187 lines - Participant endpoints
✅ routes/attendance.js            # 142 lines - Attendance endpoints
✅ routes/groups.js                # 156 lines - Group endpoints
✅ config/swagger.js               # 219 lines - API documentation config
✅ .migrations-config.json         # Migration configuration
✅ README-MIGRATIONS.md            # Migration documentation
✅ PHASE3_RESTFUL_API.md           # This file
```

### Modified Files
```
✅ api.js                          # Mounted RESTful routes & Swagger UI
✅ package.json                    # Added migration scripts & dependencies
```

---

## API Architecture Comparison

### Legacy API (Phase 1-2)

**Characteristics:**
- Action-based query parameters (`?action=getParticipants`)
- Mixed GET/POST usage
- No versioning
- Inconsistent response formats
- Authentication in some endpoints only
- No documentation

**Example Endpoints:**
```javascript
GET  /api?action=getParticipants
POST /api?action=addParticipant
POST /api?action=updateParticipant
POST /api?action=deleteParticipant
GET  /api/news
GET  /api/points-data
```

### RESTful API v1 (Phase 3)

**Characteristics:**
- Resource-based URLs (`/api/v1/participants`)
- Proper HTTP verbs (GET, POST, PUT, DELETE)
- Versioned (`/api/v1`)
- Standardized responses
- Consistent authentication
- Interactive documentation (Swagger)

**Example Endpoints:**
```javascript
GET    /api/v1/participants          # List (paginated)
GET    /api/v1/participants/:id      # Read
POST   /api/v1/participants          # Create
PUT    /api/v1/participants/:id      # Update
DELETE /api/v1/participants/:id      # Delete

GET    /api/v1/attendance            # List attendance
POST   /api/v1/attendance            # Record attendance
GET    /api/v1/attendance/dates      # Available dates

GET    /api/v1/groups                # List groups
GET    /api/v1/groups/:id            # Get group with members
POST   /api/v1/groups                # Create group
PUT    /api/v1/groups/:id            # Update group
DELETE /api/v1/groups/:id            # Delete group
```

### Backward Compatibility

**Important:** Legacy API endpoints are still functional! Phase 3 adds new endpoints without breaking existing ones.

- ✅ All Phase 1 endpoints still work (`/api/news`, `/api/initial-data`, etc.)
- ✅ Frontend can gradually migrate to v1 endpoints
- ✅ No breaking changes to existing functionality

---

## Authentication Flow

### 1. Login (Existing Endpoint)
```bash
POST /api/login
Content-Type: application/json

{
  "username": "admin@scouts.org",
  "password": "securepassword"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "role": "admin",
    "organization_id": 5
  }
}
```

### 2. Store Token (Frontend)
```javascript
localStorage.setItem('authToken', response.token);
```

### 3. Authenticated Requests
```javascript
// Using existing ajax-functions.js
const participants = await ajax({
  url: '/api/v1/participants',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
  }
});

// Or with helper function
function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

const response = await fetch('/api/v1/participants', {
  headers: getAuthHeaders()
});
```

### 4. Token Validation (Automatic)

The `authenticate` middleware automatically:
1. Extracts token from `Authorization: Bearer <token>` header
2. Verifies JWT signature with secret key
3. Decodes user information (id, role, organizationId)
4. Populates `req.user` for route handlers
5. Returns 401 error if token is invalid/missing

### 5. Role-Based Authorization

```javascript
// Only admin users can access
router.delete('/participants/:id',
  authenticate,           // Step 1: Verify token
  authorize('admin'),     // Step 2: Check role
  asyncHandler(async (req, res) => {
    // Handler only runs if user is authenticated AND is admin
  })
);

// Multiple roles allowed
router.post('/attendance',
  authenticate,
  authorize('admin', 'animation'),  // Admins OR animation staff
  asyncHandler(async (req, res) => {
    // Handler runs if user has either role
  })
);
```

---

## Error Handling

### Automatic Error Catching

The `asyncHandler` wrapper automatically catches async errors:

```javascript
// Without asyncHandler (manual try-catch needed)
router.get('/participants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM participants');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// With asyncHandler (automatic error handling)
router.get('/participants', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM participants');
  return success(res, result.rows);
  // Errors automatically caught and sent to error middleware
}));
```

### Standard Error Responses

**401 Unauthorized** (No/invalid token):
```json
{
  "success": false,
  "message": "Authentication required",
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**403 Forbidden** (Insufficient permissions):
```json
{
  "success": false,
  "message": "Insufficient permissions. Required roles: admin",
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**404 Not Found**:
```json
{
  "success": false,
  "message": "Participant not found",
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**400 Bad Request** (Validation error):
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "first_name", "message": "First name is required" }
  ],
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

**500 Internal Server Error**:
```json
{
  "success": false,
  "message": "Database connection failed",
  "timestamp": "2025-01-30T20:30:00.000Z"
}
```

---

## Testing the API

### 1. Using Swagger UI (Recommended)

```bash
# Start server
npm start

# Open browser
http://localhost:3000/api-docs

# Steps:
1. Click "Authorize" button
2. Enter: Bearer <your-jwt-token>
3. Click any endpoint to expand
4. Click "Try it out"
5. Fill in parameters
6. Click "Execute"
7. View response
```

### 2. Using curl

```bash
# Login first to get token
TOKEN=$(curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin@scouts.org","password":"pass"}' \
  | jq -r '.token')

# List participants
curl http://localhost:3000/api/v1/participants \
  -H "Authorization: Bearer $TOKEN"

# Get specific participant
curl http://localhost:3000/api/v1/participants/123 \
  -H "Authorization: Bearer $TOKEN"

# Create participant
curl -X POST http://localhost:3000/api/v1/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jean",
    "last_name": "Dupont",
    "email": "jean@example.com",
    "birthdate": "2010-05-15"
  }'

# Update participant
curl -X PUT http://localhost:3000/api/v1/participants/123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "555-1234"}'

# Delete participant (admin only)
curl -X DELETE http://localhost:3000/api/v1/participants/123 \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Using JavaScript (Frontend)

```javascript
// Helper function
async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('authToken');
  const response = await fetch(`/api/v1${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  return response.json();
}

// Usage examples
const participants = await apiRequest('/participants');
const participant = await apiRequest('/participants/123');

const newParticipant = await apiRequest('/participants', {
  method: 'POST',
  body: JSON.stringify({
    first_name: 'Jean',
    last_name: 'Dupont',
    email: 'jean@example.com'
  })
});

const updated = await apiRequest('/participants/123', {
  method: 'PUT',
  body: JSON.stringify({ phone: '555-1234' })
});

await apiRequest('/participants/123', { method: 'DELETE' });
```

---

## Database Migrations Guide

### Setup

**1. Configure Database URL:**
```bash
# Add to .env
DATABASE_URL=postgresql://user:password@host:port/database

# Or export
export DATABASE_URL="postgresql://user:password@localhost:5432/wampums"
```

**2. Verify Configuration:**
```bash
cat .migrations-config.json
# Should show:
# {
#   "database-url-var": "DATABASE_URL",
#   "migrations-table": "pgmigrations",
#   "dir": "migrations",
#   ...
# }
```

### Creating Migrations

**Example 1: Add New Table**
```bash
npm run migrate create add-notifications-table
```

```javascript
// migrations/1706644800000_add-notifications-table.js
exports.up = (pgm) => {
  pgm.createTable('notifications', {
    id: 'id',  // Auto-incrementing primary key
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    title: { type: 'varchar(255)', notNull: true },
    message: { type: 'text' },
    read: { type: 'boolean', default: false },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('notifications', 'user_id');
  pgm.createIndex('notifications', ['user_id', 'read']);
};

exports.down = (pgm) => {
  pgm.dropTable('notifications');
};
```

**Example 2: Add Column**
```bash
npm run migrate create add-participant-email-verified
```

```javascript
exports.up = (pgm) => {
  pgm.addColumn('participants', {
    email_verified: {
      type: 'boolean',
      default: false,
      notNull: true
    },
    email_verified_at: {
      type: 'timestamp',
      default: null
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('participants', ['email_verified', 'email_verified_at']);
};
```

**Example 3: Data Migration**
```bash
npm run migrate create migrate-old-attendance-data
```

```javascript
exports.up = async (pgm) => {
  // Complex data transformations
  await pgm.sql(`
    UPDATE attendance
    SET status = CASE
      WHEN old_status = '1' THEN 'P'
      WHEN old_status = '0' THEN 'A'
      ELSE 'E'
    END
  `);

  pgm.dropColumn('attendance', 'old_status');
};

exports.down = async (pgm) => {
  pgm.addColumn('attendance', {
    old_status: { type: 'varchar(1)' }
  });

  await pgm.sql(`
    UPDATE attendance
    SET old_status = CASE
      WHEN status = 'P' THEN '1'
      WHEN status = 'A' THEN '0'
      ELSE NULL
    END
  `);
};
```

### Running Migrations

**Development:**
```bash
# Run all pending migrations
npm run migrate up

# Run specific number of migrations
npm run migrate up 2  # Run next 2 migrations

# Check status
npm run migrate status
```

**Production:**
```bash
# 1. Pull latest code
git pull origin main

# 2. Run migrations (with production DATABASE_URL)
export DATABASE_URL="${PRODUCTION_DB_URL}"
npm run migrate up

# 3. Restart application
pm2 restart wampums
```

### Rolling Back

```bash
# Rollback last migration
npm run migrate down

# Rollback specific number
npm run migrate down 2  # Rollback last 2 migrations

# DANGER: Rollback ALL migrations (reset database)
npm run migrate down --all
```

### Best Practices

1. **Always write down migrations** - If it can be rolled back, write the down function
2. **Test locally first** - Run up/down cycle before deploying
3. **One logical change per migration** - Don't combine unrelated changes
4. **Never edit applied migrations** - Create a new migration instead
5. **Backup before production migrations** - Always have a rollback plan
6. **Use transactions** - Migrations run in transactions by default (automatic rollback on error)

---

## Integration with Frontend

### Gradual Migration Strategy

**Phase 3 doesn't require immediate frontend changes.** Both APIs coexist:

**Option 1: Keep Legacy API (No Changes)**
```javascript
// Existing code continues to work
const participants = await ajax({
  url: '/api?action=getParticipants',
  method: 'GET'
});
```

**Option 2: Migrate to RESTful API (Recommended)**
```javascript
// New RESTful approach
const participants = await ajax({
  url: '/api/v1/participants',
  method: 'GET',
  headers: getAuthHeaders()
});
```

### Frontend Migration Checklist

When ready to migrate frontend:

**1. Update ajax-functions.js:**
```javascript
// Add auth header helper
export function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Update ajax function to include auth by default
export async function ajax(config) {
  const defaultHeaders = getAuthHeaders();
  config.headers = { ...defaultHeaders, ...config.headers };
  // ... rest of ajax function
}
```

**2. Update route modules to use v1 endpoints:**

**Before:**
```javascript
// spa/participants.js
async loadParticipants() {
  const data = await ajax({
    url: '/api?action=getParticipants',
    method: 'GET'
  });
  return data;
}
```

**After:**
```javascript
// spa/participants.js
async loadParticipants(page = 1, limit = 50) {
  const response = await ajax({
    url: `/api/v1/participants?page=${page}&limit=${limit}`,
    method: 'GET'
  });

  // Response is now standardized:
  // { success: true, data: [...], pagination: {...} }
  if (response.success) {
    this.participants = response.data;
    this.pagination = response.pagination;
  }
  return response;
}

async createParticipant(participantData) {
  const response = await ajax({
    url: '/api/v1/participants',
    method: 'POST',
    body: JSON.stringify(participantData)
  });

  if (response.success) {
    console.log('Created:', response.data);
  }
  return response;
}

async updateParticipant(id, updates) {
  return await ajax({
    url: `/api/v1/participants/${id}`,
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

async deleteParticipant(id) {
  return await ajax({
    url: `/api/v1/participants/${id}`,
    method: 'DELETE'
  });
}
```

**3. Handle pagination UI:**
```javascript
renderPagination() {
  const { page, totalPages, hasNext, hasPrev } = this.pagination;

  const html = `
    <div class="pagination">
      ${hasPrev ? `<button onclick="loadPage(${page - 1})">Previous</button>` : ''}
      <span>Page ${page} of ${totalPages}</span>
      ${hasNext ? `<button onclick="loadPage(${page + 1})">Next</button>` : ''}
    </div>
  `;

  document.querySelector('#pagination').innerHTML = html;
}
```

---

## Security Improvements

### 1. Authentication Consistency
- ✅ **All v1 endpoints require authentication**
- ✅ **JWT tokens validated on every request**
- ✅ **Expired tokens automatically rejected**
- ✅ **Organization isolation** (users can't access other orgs' data)

### 2. Authorization by Role
- ✅ **Admin-only operations** (DELETE participants, manage groups)
- ✅ **Staff operations** (attendance recording by admin/animation)
- ✅ **Role verification** before sensitive operations

### 3. SQL Injection Prevention
- ✅ **Parameterized queries** throughout
- ✅ **No string concatenation** in SQL
- ✅ **Input validation** (future: express-validator integration)

**Example:**
```javascript
// SECURE (parameterized)
const result = await pool.query(
  'SELECT * FROM participants WHERE id = $1 AND organization_id = $2',
  [id, organizationId]
);

// INSECURE (never do this!)
const result = await pool.query(
  `SELECT * FROM participants WHERE id = ${id}`  // SQL injection risk!
);
```

### 4. Error Message Sanitization
- ✅ **Generic error messages** to clients
- ✅ **Detailed logging** server-side only
- ✅ **No stack traces** in production responses

### 5. Rate Limiting (Future)
Phase 3 lays groundwork for:
- Per-endpoint rate limiting
- Token-based usage tracking
- Abuse prevention

---

## Performance Considerations

### 1. Database Query Optimization

**Pagination:**
```javascript
// Efficient: Only fetch requested page
SELECT * FROM participants
WHERE organization_id = $1
ORDER BY last_name, first_name
LIMIT 50 OFFSET 0;

// Count separately (can be cached)
SELECT COUNT(*) FROM participants
WHERE organization_id = $1;
```

**Indexing Recommendations:**
```sql
-- Speed up organization filtering
CREATE INDEX idx_participants_org ON participants(organization_id);
CREATE INDEX idx_attendance_org ON attendance(organization_id);
CREATE INDEX idx_groups_org ON groups(organization_id);

-- Speed up participant lookups
CREATE INDEX idx_participants_id_org ON participants(id, organization_id);

-- Speed up attendance queries
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_participant ON attendance(participant_id, date);
```

### 2. Connection Pooling

Already implemented in `api.js`:
```javascript
const pool = new Pool({
  max: 20,              // Maximum 20 connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

### 3. Response Compression

Already enabled in Phase 1:
```javascript
const compression = require('compression');
app.use(compression());
```

### 4. Caching Strategies (Future)

Phase 3 enables:
- **Redis integration** for session/token caching
- **ETag headers** for conditional requests
- **Query result caching** for expensive operations
- **CDN caching** for static API responses

---

## API Versioning Strategy

### Current: v1

**Endpoints:** `/api/v1/*`

**Stability:** Initial release, may have minor changes

**Support:** Active development

### Future: v2

When breaking changes are needed:
- Create `/api/v2/*` endpoints
- Keep v1 operational (6-12 month deprecation)
- Announce deprecation timeline
- Provide migration guide

### Deprecation Process

```javascript
// v1 endpoint (deprecated)
router.get('/api/v1/participants', (req, res) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Sunset', '2025-12-31');
  res.setHeader('X-API-Migration', 'Use /api/v2/participants');
  // ... handler
});
```

---

## Dependencies Added

### Production Dependencies

```json
{
  "node-pg-migrate": "^8.0.3",      // Database migrations
  "swagger-jsdoc": "^6.2.8",        // Swagger/OpenAPI doc generation
  "swagger-ui-express": "^5.0.1"    // Interactive API documentation
}
```

**Total new dependencies:** 3
**Total dependency size:** ~8MB

### Why These Dependencies?

**node-pg-migrate:**
- Industry-standard PostgreSQL migration tool
- Active maintenance (140k+ weekly downloads)
- Supports rollbacks, transactions, complex migrations
- Alternative to heavyweight ORMs

**swagger-jsdoc:**
- Generate OpenAPI spec from JSDoc comments
- Keep docs close to code
- Automatic validation of spec

**swagger-ui-express:**
- Beautiful interactive API documentation
- Try-it-out functionality
- Industry-standard UI (used by thousands of APIs)

---

## Next Steps (Phase 4 & Beyond)

### Phase 4: Testing Infrastructure (Recommended Next)

**Unit Tests:**
- Test middleware (auth, response helpers)
- Test route handlers in isolation
- Mock database queries

**Integration Tests:**
- Test full request/response cycles
- Test authentication flows
- Test error handling

**Tools:**
- Jest (already in package.json)
- Supertest (already installed)
- Coverage reporting (Istanbul/NYC)

**Example Test:**
```javascript
// __tests__/routes/participants.test.js
const request = require('supertest');
const app = require('../api');

describe('GET /api/v1/participants', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .get('/api/v1/participants');
    expect(res.status).toBe(401);
  });

  it('returns paginated participants', async () => {
    const res = await request(app)
      .get('/api/v1/participants')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
  });
});
```

### Additional Future Enhancements

**1. Input Validation:**
```bash
npm install express-validator
```
```javascript
const { body, validationResult } = require('express-validator');

router.post('/participants',
  authenticate,
  [
    body('email').isEmail().normalizeEmail(),
    body('first_name').trim().isLength({ min: 2 }),
    body('birthdate').isDate()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return error(res, 'Validation failed', 400, errors.array());
    }
    // ... create participant
  })
);
```

**2. More RESTful Routes:**
- `/api/v1/users` - User management
- `/api/v1/meetings` - Meeting management
- `/api/v1/points` - Point transactions
- `/api/v1/badges` - Badge awards
- `/api/v1/health-forms` - Health form submissions
- `/api/v1/reports` - Report generation

**3. Advanced Features:**
- **WebSockets** for real-time updates (Socket.io)
- **File uploads** for photos/documents (Multer)
- **PDF generation** for reports (PDFKit)
- **Email notifications** (Nodemailer)
- **Scheduled tasks** (node-cron)
- **GraphQL endpoint** (Apollo Server) as alternative to REST

**4. Monitoring & Logging:**
- Structured logging (winston already installed)
- Request ID tracking
- Performance monitoring (response times)
- Error aggregation (Sentry)

**5. DevOps:**
- Docker containerization
- CI/CD pipeline (GitHub Actions)
- Automated testing on PR
- Staging environment
- Blue/green deployments

---

## Troubleshooting

### Server Won't Start

**Issue:** Routes not mounting
```bash
# Check for syntax errors
npm start

# Look for errors like:
# "Cannot find module './routes/participants'"
# "Unexpected token"
```

**Solution:**
```bash
# Verify all files exist
ls -la middleware/
ls -la routes/
ls -la config/

# Check for typos in require() statements in api.js
```

### 401 Unauthorized Errors

**Issue:** Token not being sent
```javascript
// Check headers in browser DevTools > Network > Request Headers
// Should see:
// Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Solution:**
```javascript
// Ensure token is stored after login
localStorage.setItem('authToken', token);

// Ensure token is sent with requests
headers: {
  'Authorization': `Bearer ${localStorage.getItem('authToken')}`
}
```

**Issue:** Token invalid
```bash
# Check JWT_SECRET_KEY in .env matches what was used to create token
# If changed, all existing tokens are invalid - users must re-login
```

### 403 Forbidden Errors

**Issue:** User role insufficient
```javascript
// DELETE /api/v1/participants/123
// Response: { success: false, message: "Insufficient permissions. Required roles: admin" }
```

**Solution:**
- Verify user has correct role in JWT token
- Check authorize() middleware for correct roles
- Admins can perform any operation
- Animation staff can record attendance but not delete participants

### Database Errors

**Issue:** Migration fails
```bash
npm run migrate up
# Error: relation "participants" does not exist
```

**Solution:**
```bash
# Check migration order
npm run migrate status

# Ensure DATABASE_URL is correct
echo $DATABASE_URL

# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# If corrupted, rollback and retry
npm run migrate down
npm run migrate up
```

### Swagger UI Not Loading

**Issue:** /api-docs returns 404
```bash
curl http://localhost:3000/api-docs
# <h1>Cannot GET /api-docs</h1>
```

**Solution:**
```bash
# Check if swagger route is mounted in api.js
grep -n "swagger" api.js

# Should see:
# const swaggerUi = require('swagger-ui-express');
# app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

# Restart server
npm start
```

---

## Migration Guide (Legacy to RESTful)

### Mapping Legacy Endpoints to v1

| Legacy Endpoint | RESTful v1 Endpoint | Notes |
|----------------|-------------------|-------|
| `GET /api?action=getParticipants` | `GET /api/v1/participants` | Now paginated |
| `POST /api?action=addParticipant` | `POST /api/v1/participants` | Same payload |
| `POST /api?action=updateParticipant` | `PUT /api/v1/participants/:id` | Use PUT, id in URL |
| `POST /api?action=deleteParticipant` | `DELETE /api/v1/participants/:id` | Admin only |
| `GET /api?action=getAttendance` | `GET /api/v1/attendance` | Now paginated |
| `POST /api?action=recordAttendance` | `POST /api/v1/attendance` | Same payload |
| `GET /api?action=getGroups` | `GET /api/v1/groups` | Includes members |
| `POST /api?action=addGroup` | `POST /api/v1/groups` | Admin only |

### Response Format Changes

**Legacy:**
```json
{
  "participants": [...]
}
```

**RESTful v1:**
```json
{
  "success": true,
  "data": [...],
  "pagination": { ... },
  "timestamp": "..."
}
```

**Migration Code:**
```javascript
// Update response handling
const response = await ajax({ url: '/api/v1/participants' });

// Old way:
// const participants = response.participants;

// New way:
if (response.success) {
  const participants = response.data;
  const pagination = response.pagination;
} else {
  console.error(response.message);
}
```

---

## Success Metrics

### Technical Metrics ✅

- [x] RESTful routes implemented (participants, attendance, groups)
- [x] Authentication middleware created
- [x] Authorization (role-based) implemented
- [x] Standardized response format
- [x] Swagger/OpenAPI documentation
- [x] Database migration infrastructure
- [x] Backward compatibility maintained
- [x] Zero breaking changes to existing API

### Code Quality Metrics

- **New Lines of Code:** ~875 lines
- **New Files:** 9 files
- **Test Coverage:** 0% (Phase 4 goal: >80%)
- **Documentation:** Comprehensive (this file + README-MIGRATIONS.md + Swagger)

### Architecture Improvements

- ✅ **Separation of concerns** (routes, middleware, config)
- ✅ **Reusable middleware** (auth, response)
- ✅ **Consistent patterns** across all routes
- ✅ **API versioning** for future flexibility
- ✅ **Self-documenting** (Swagger UI)

---

## Credits

**Completion Date:** 2025-01-30
**Phase:** 3 of 4+
**Status:** ✅ Complete
**Next Phase:** Testing Infrastructure (Unit, Integration, E2E)

---

## Quick Reference

### Start Server
```bash
npm start
# Server: http://localhost:3000
# API Docs: http://localhost:3000/api-docs
```

### Test Endpoints (curl)
```bash
# Login
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user","password":"pass"}'

# Get token from response, then:
TOKEN="eyJhbGciOiJIUzI1NiIs..."

# List participants
curl http://localhost:3000/api/v1/participants \
  -H "Authorization: Bearer $TOKEN"

# Create participant
curl -X POST http://localhost:3000/api/v1/participants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Jean","last_name":"Dupont"}'
```

### Database Migrations
```bash
# Create migration
npm run migrate create migration-name

# Run migrations
npm run migrate up

# Rollback
npm run migrate down

# Check status
npm run migrate status
```

### Important Files
```
middleware/auth.js              # Authentication
middleware/response.js          # Response helpers
routes/participants.js          # Participant CRUD
routes/attendance.js            # Attendance tracking
routes/groups.js                # Group management
config/swagger.js               # API documentation
.migrations-config.json         # Migration config
README-MIGRATIONS.md            # Migration guide
```

### API Endpoints

**Participants:**
```
GET    /api/v1/participants       # List (paginated)
GET    /api/v1/participants/:id   # Get one
POST   /api/v1/participants       # Create
PUT    /api/v1/participants/:id   # Update
DELETE /api/v1/participants/:id   # Delete (admin)
```

**Attendance:**
```
GET  /api/v1/attendance           # List records
GET  /api/v1/attendance/dates     # Available dates
POST /api/v1/attendance           # Record attendance
```

**Groups:**
```
GET    /api/v1/groups             # List all
GET    /api/v1/groups/:id         # Get with members
POST   /api/v1/groups             # Create (admin)
PUT    /api/v1/groups/:id         # Update (admin)
DELETE /api/v1/groups/:id         # Delete (admin)
```

---

**🎉 Congratulations! Phase 3 is complete. Your application now has a modern, secure, documented RESTful API!**

**API Architecture:** Legacy → RESTful v1
**Documentation:** Available at /api-docs
**Migrations:** Ready for database version control
**Security:** JWT authentication + role-based authorization
