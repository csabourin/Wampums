# Quick Start: Performance & Security Optimizations

**Date:** December 28, 2025
**Status:** ✅ Critical fixes implemented

---

## What Was Fixed

This guide documents the **immediate critical optimizations** that have been implemented. See `PERFORMANCE_DIAGNOSTIC_REPORT.md` for the full analysis.

### ✅ Implemented Fixes (Ready to Deploy)

#### 1. 🔒 Security: Fixed 2FA Randomness (CRITICAL)
**File:** `utils/twoFactor.js:24-28`

**Before:**
```javascript
const code = Math.floor(100000 + Math.random() * 900000).toString();
```

**After:**
```javascript
const code = crypto.randomInt(100000, 1000000).toString();
```

**Impact:** Prevents 2FA bypass attacks by using cryptographically secure random number generation.

---

#### 2. 🔒 Security: Restricted CORS to Specific Origins (CRITICAL)
**File:** `api.js:126-152`

**Before:**
```javascript
app.use(cors()); // Allows ALL origins ❌
```

**After:**
```javascript
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : isProduction
        ? ['https://wampums.app', 'https://www.wampums.app']
        : ['http://localhost:5173', 'http://localhost:5000', 'http://localhost:3000'];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS request blocked from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));
```

**Impact:** Prevents unauthorized cross-origin requests. Reduces CSRF attack surface.

**Configuration:** Set `ALLOWED_ORIGINS` environment variable in production:
```bash
ALLOWED_ORIGINS=https://wampums.app,https://www.wampums.app
```

---

#### 3. ⚡ Performance: Optimized Database Connection Pool
**File:** `api.js:268-287`

**Before:**
```javascript
const poolConfig = {
  connectionString: process.env.SB_URL || process.env.DATABASE_URL,
};
```

**After:**
```javascript
const poolConfig = {
  connectionString: process.env.SB_URL || process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: parseInt(process.env.DB_POOL_MIN || '5', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000', 10),
  allowExitOnIdle: false,
};
```

**Impact:** Better connection management, reduced connection overhead, faster query responses.

**Optional Configuration:**
```bash
DB_POOL_MAX=20           # Maximum connections (default: 20)
DB_POOL_MIN=5            # Minimum idle connections (default: 5)
DB_IDLE_TIMEOUT=30000    # Close idle after 30s (default: 30000)
DB_CONNECTION_TIMEOUT=2000  # Connection timeout 2s (default: 2000)
```

---

#### 4. ⚡ Performance: Database Indexes Migration
**File:** `migrations/20251228_add_performance_indexes.sql`

**Created 10 critical indexes:**
1. `idx_attendance_participant_org_date` - Speeds up attendance queries
2. `idx_points_participant_org` - Speeds up points aggregation
3. `idx_form_submissions_participant_org_type` - Speeds up form checks
4. `idx_participant_groups_participant_org` - Speeds up group lookups
5. `idx_participant_groups_group_org` - Speeds up reverse group lookups
6. `idx_points_group_org_partial` - Speeds up group points queries
7. `idx_badge_progress_participant_template` - Speeds up badge queries
8. `idx_honors_participant_org` - Speeds up honors queries
9. `idx_user_organizations_user_org` - Speeds up auth checks
10. `idx_organization_domains_domain` - Speeds up domain mapping

**Expected Impact:**
- 50-70% faster database queries
- 80-90% reduction in query count (when combined with N+1 fixes)
- Minimal storage overhead (~2-5% per index)

---

## Deployment Instructions

### Step 1: Apply Database Migration

```bash
# Production
psql $DATABASE_URL -f migrations/20251228_add_performance_indexes.sql

# Development
psql $DATABASE_URL -f migrations/20251228_add_performance_indexes.sql
```

**Verify indexes were created:**
```sql
SELECT indexname, tablename
FROM pg_indexes
WHERE indexname LIKE 'idx_%participant%' OR indexname LIKE 'idx_%points%'
ORDER BY tablename, indexname;
```

### Step 2: Set Environment Variables (Production Only)

Add to your `.env` or hosting platform:

```bash
# CORS Security (REQUIRED in production)
ALLOWED_ORIGINS=https://wampums.app,https://www.wampums.app

# Database Pool (Optional - these are sensible defaults)
DB_POOL_MAX=20
DB_POOL_MIN=5
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
```

### Step 3: Deploy Code Changes

```bash
# Review changes
git status
git diff

# Commit
git add utils/twoFactor.js api.js migrations/20251228_add_performance_indexes.sql
git commit -m "perf: optimize database performance and fix critical security issues

- Fix 2FA randomness using crypto.randomInt() (security critical)
- Restrict CORS to specific origins (security critical)
- Optimize database connection pool configuration
- Add 10 critical performance indexes for common queries

Expected impact:
- Prevents 2FA bypass attacks
- Reduces CSRF attack surface
- 50-70% faster database queries
- Better connection pool management"

# Push to your branch
git push
```

### Step 4: Test in Staging (Recommended)

Before deploying to production:

1. **Test CORS changes:**
   - Verify app works from allowed origins
   - Verify requests from other origins are blocked

2. **Test 2FA:**
   - Generate new 2FA codes
   - Verify codes are 6 digits and random

3. **Test Database Performance:**
   - Monitor query execution times
   - Use `EXPLAIN ANALYZE` to verify indexes are used

4. **Monitor Connection Pool:**
   - Check pool utilization in logs
   - Verify no connection timeout errors

---

## Verification & Monitoring

### Check Index Usage

```sql
-- Verify indexes are being used
EXPLAIN ANALYZE
SELECT p.*,
  COALESCE(SUM(pts.value), 0) as total_points
FROM participants p
LEFT JOIN points pts ON pts.participant_id = p.id AND pts.organization_id = 1
WHERE p.organization_id = 1
GROUP BY p.id;

-- Should show "Index Scan using idx_points_participant_org" or similar
```

### Monitor CORS Blocks

Check logs for:
```
WARN: CORS request blocked from origin: https://suspicious-site.com
```

### Monitor Database Pool

Add logging to check pool health:
```javascript
setInterval(() => {
  logger.info('Database pool stats:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
}, 60000); // Every minute
```

---

## Next Steps (Priority Recommendations)

See `PERFORMANCE_DIAGNOSTIC_REPORT.md` for the full list. Top priorities:

### P1 - Next Week
1. **Fix N+1 queries** in participants route (80-90% query reduction)
2. **Fix N+1 queries** in points/attendance routes (75% query reduction)
3. **Bundle DOMPurify locally** (50-100ms faster, more reliable)

### P2 - This Month
4. **Implement memory leak fixes** (AbortController pattern)
5. **Self-host FontAwesome** (500-800ms faster initial load)
6. **Implement CSS purging** (60-90 KB savings)
7. **Split large modules** (api-endpoints.js, inventory.js, budgets.js)

---

## Rollback Instructions

If you need to rollback these changes:

### Database Indexes
```bash
psql $DATABASE_URL << 'EOF'
DROP INDEX IF EXISTS idx_attendance_participant_org_date;
DROP INDEX IF EXISTS idx_points_participant_org;
DROP INDEX IF EXISTS idx_form_submissions_participant_org_type;
DROP INDEX IF EXISTS idx_participant_groups_participant_org;
DROP INDEX IF EXISTS idx_participant_groups_group_org;
DROP INDEX IF EXISTS idx_points_group_org_partial;
DROP INDEX IF EXISTS idx_badge_progress_participant_template;
DROP INDEX IF EXISTS idx_honors_participant_org;
DROP INDEX IF EXISTS idx_user_organizations_user_org;
DROP INDEX IF EXISTS idx_organization_domains_domain;
EOF
```

### Code Changes
```bash
git revert <commit-hash>
git push
```

### CORS Configuration
Remove `ALLOWED_ORIGINS` from environment and restore:
```javascript
app.use(cors());
```

---

## Questions or Issues?

1. **CORS blocking legitimate requests?**
   - Add the origin to `ALLOWED_ORIGINS` environment variable
   - Example: `ALLOWED_ORIGINS=https://wampums.app,https://admin.wampums.app`

2. **Database connection errors?**
   - Check pool configuration values
   - Reduce `DB_POOL_MAX` if hitting connection limits
   - Increase `DB_CONNECTION_TIMEOUT` for slow connections

3. **Indexes not improving performance?**
   - Run `EXPLAIN ANALYZE` to verify indexes are being used
   - Check if queries are still using sequential scans
   - May need to run `VACUUM ANALYZE` to update statistics

---

**Implemented by:** Claude Code
**Date:** December 28, 2025
**Related Files:**
- `PERFORMANCE_DIAGNOSTIC_REPORT.md` - Full diagnostic report
- `migrations/20251228_add_performance_indexes.sql` - Database indexes
- `utils/twoFactor.js` - 2FA fix
- `api.js` - CORS and pool configuration
