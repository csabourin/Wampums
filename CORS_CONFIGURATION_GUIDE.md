# CORS Configuration Guide

## Overview
The Wampums app supports:
- **Multiple domains** (dynamically created subdomains)
- **React Native mobile app**
- **Web browsers** from various subdomains
- **Development environments** (Replit, Vite, CodeSandbox, etc.)

The CORS configuration is designed to be **flexible yet secure**.

---

## Automatic Development Support

**In development mode** (`NODE_ENV !== "production"`), the following are **automatically allowed**:

### ✅ Auto-Allowed in Development:
- **Localhost with ANY port** (Vite can use random ports)
  - `http://localhost:5173`, `http://localhost:3000`, `http://localhost:8080`, etc.
  - `http://127.0.0.1:*`

- **Replit dynamic domains**
  - `https://projectname-username.replit.dev`
  - `https://*.repl.co`

- **Other dev environments**
  - `https://*.codesandbox.io`
  - `https://*.stackblitz.io`
  - `https://*.gitpod.io`

- **Local .test domains**
  - `http://wampums-1.test` (from your config.js)
  - `http://*.test:*`

**No configuration needed for development!** 🎉

---

## Production Configuration

### Environment Variable: `ALLOWED_ORIGINS`

Set this environment variable with comma-separated patterns:

```bash
# Production example (supports all subdomains)
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app,https://*.custom-domain.com

# Development example
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5000,http://*.localhost:*
```

### Pattern Syntax

#### 1. **Exact Match**
```bash
https://wampums.app
```
- ✅ Matches: `https://wampums.app`
- ❌ Doesn't match: `https://subdomain.wampums.app`

#### 2. **Wildcard Subdomains**
```bash
https://*.wampums.app
```
- ✅ Matches: `https://org1.wampums.app`
- ✅ Matches: `https://district5.wampums.app`
- ✅ Matches: `https://any-subdomain.wampums.app`
- ❌ Doesn't match: `https://wampums.app` (no subdomain)
- ❌ Doesn't match: `https://different.com`

#### 3. **Multiple Patterns**
```bash
https://wampums.app,https://*.wampums.app,https://*.custom.org
```
- Allows main domain + all wampums.app subdomains + all custom.org subdomains

#### 4. **React Native / Mobile Apps**
**No configuration needed!** Requests with no `Origin` header are automatically allowed.
- ✅ React Native apps (don't send Origin header)
- ✅ Mobile apps
- ✅ Postman / API testing tools

---

## Default Configurations

### Production (if ALLOWED_ORIGINS not set)
```javascript
['https://wampums.app', 'https://*.wampums.app']
```
- Main domain + all subdomains

### Development (if ALLOWED_ORIGINS not set)
```javascript
['http://localhost:5173', 'http://localhost:5000', 'http://localhost:3000', 'http://*.localhost:*']
```
- Common dev ports + wildcard localhost ports

---

## Examples

### Example 1: Single Organization with Custom Domain
```bash
ALLOWED_ORIGINS=https://scouts-unit42.wampums.app
```

### Example 2: Multiple Organizations
```bash
ALLOWED_ORIGINS=https://*.wampums.app
```

### Example 3: Custom Domains
```bash
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app,https://scouts.mycustomdomain.org,https://*.mycustomdomain.org
```

### Example 4: Development + Staging + Production
```bash
# Development
ALLOWED_ORIGINS=http://localhost:5173,http://*.localhost:*

# Staging
ALLOWED_ORIGINS=https://*.staging.wampums.app

# Production
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app
```

---

## Security Features

### ✅ What's Allowed
- Configured domain patterns (exact or wildcard)
- Requests with no Origin header (React Native, mobile apps)
- Subdomains matching wildcard patterns

### ❌ What's Blocked
- Origins not matching any pattern
- Suspicious origins (logged for security monitoring)
- Cross-origin requests from unauthorized domains

### 🔒 Security Monitoring
All blocked requests are logged:
```javascript
logger.warn('[CORS] Request blocked from origin:', origin, '| Allowed patterns:', allowedPatterns);
```

Monitor these logs to:
- Detect unauthorized access attempts
- Identify misconfigured clients
- Add legitimate domains you forgot

---

## Testing

### Test React Native App
React Native apps don't send an Origin header, so they should work automatically:
```javascript
// In your React Native app
fetch('https://api.wampums.app/api/v1/participants', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
})
```
✅ Should work without any CORS configuration

### Test Web App from Subdomain
```javascript
// From https://org1.wampums.app
fetch('https://api.wampums.app/api/v1/participants', {
  credentials: 'include',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
})
```
✅ Should work if `*.wampums.app` is in ALLOWED_ORIGINS

### Test Browser Console
1. Open browser console on your app
2. Check network tab for OPTIONS (preflight) requests
3. Look for `Access-Control-Allow-Origin` header in response
4. Should match your origin

---

## Troubleshooting

### Issue: "Not allowed by CORS"

**Symptoms:**
- Browser console error: `blocked by CORS policy`
- OPTIONS preflight request fails

**Solutions:**
1. Check server logs for blocked origin:
   ```
   [CORS] Request blocked from origin: https://new-subdomain.wampums.app
   ```

2. Add pattern to ALLOWED_ORIGINS:
   ```bash
   # Before
   ALLOWED_ORIGINS=https://wampums.app

   # After (supports subdomains)
   ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app
   ```

3. Restart server to apply changes

### Issue: React Native app blocked

**Check:**
- Is the request coming with NO origin header?
- If request HAS an origin (unusual), add it to ALLOWED_ORIGINS

**Debug:**
```javascript
// In server logs, you should see:
[CORS] Request with no origin (likely React Native or mobile app) - ALLOWED
```

### Issue: Subdomain not working

**Check pattern syntax:**
```bash
# ❌ Wrong - doesn't match subdomains
ALLOWED_ORIGINS=https://wampums.app

# ✅ Correct - matches all subdomains
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app
```

### Issue: Too permissive in production

**Secure production config:**
```bash
# ❌ Too open - allows any HTTPS domain
ALLOWED_ORIGINS=https://*

# ✅ Secure - only your domains
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app
```

---

## Advanced: Organization-Specific Domains

If you allow organizations to use custom domains (e.g., `scouts-unit42.org`):

### Option 1: Wildcard All Custom Domains
```bash
ALLOWED_ORIGINS=https://*.wampums.app,https://*
```
⚠️ **Not recommended** - too permissive

### Option 2: Database-Driven Validation
Enhance the CORS function to check database for registered domains:

```javascript
// In api.js, modify CORS validation:
const result = await pool.query(
  'SELECT domain FROM organization_domains WHERE domain = $1',
  [origin]
);

if (result.rows.length > 0) {
  return callback(null, true);
}
```

### Option 3: Add Domains Manually
```bash
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app,https://scouts-unit42.org,https://troop123.scouts.org
```

---

## Production Checklist

Before deploying:
- [ ] Set `ALLOWED_ORIGINS` environment variable
- [ ] Test React Native app connection
- [ ] Test web app from main domain
- [ ] Test web app from subdomain
- [ ] Monitor server logs for blocked requests
- [ ] Verify credentials (cookies, auth headers) work
- [ ] Test OPTIONS preflight requests

---

## Summary

**For most use cases:**
```bash
# Production
ALLOWED_ORIGINS=https://wampums.app,https://*.wampums.app

# Development
ALLOWED_ORIGINS=http://localhost:5173,http://*.localhost:*
```

**Key Points:**
- ✅ React Native apps work automatically (no Origin header)
- ✅ Wildcard subdomains supported (`*.wampums.app`)
- ✅ Multiple patterns supported (comma-separated)
- ✅ All blocked requests logged for security
- ✅ Flexible enough for dynamic subdomain creation
- ✅ Secure enough to prevent unauthorized access
