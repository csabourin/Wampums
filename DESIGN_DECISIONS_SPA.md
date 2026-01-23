# SPA Design Decisions & Coding Guide

**Document Purpose:** Explain the architectural and design decisions in the Wampums Scout Management System's Single Page Application (SPA), why they were chosen, and guide agents on maintaining consistency and coherence.

**Target Audience:** Coding agents, developers, and future maintainers
**Last Updated:** January 23, 2026
**Scope:** Frontend SPA (Vanilla JavaScript ES6 modules + Vite)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Design Principles](#core-design-principles)
3. [Application State Management](#application-state-management)
4. [Routing & Navigation](#routing--navigation)
5. [Module System](#module-system)
6. [Security Architecture](#security-architecture)
7. [Visual Design System](#visual-design-system)
8. [Data Management & Caching](#data-management--caching)
9. [Offline-First Capability](#offline-first-capability)
10. [API Integration](#api-integration)
11. [Internationalization (i18n)](#internationalization-i18n)
12. [Performance Optimization](#performance-optimization)
13. [Code Organization & Patterns](#code-organization--patterns)
14. [Error Handling & Debugging](#error-handling--debugging)

---

## Architecture Overview

### Why Vanilla JavaScript + Vite?

**Decision:** Use Vanilla JavaScript (ES6 modules) with Vite as the build tool instead of React/Vue/Angular.

**Rationale:**

1. **No Framework Lock-In**: Vanilla JS keeps the codebase framework-agnostic. Scout organizations vary widely in tech literacy; keeping dependencies minimal reduces maintenance burden.

2. **Lightweight & Fast**: The app must work on low-bandwidth connections and older devices (scout leaders in rural areas, parents on budget plans). Vanilla JS bundles are significantly smaller than framework bundles:
   - React + dependencies: ~150KB gzipped
   - Vanilla ES modules: ~50KB gzipped
   - This matters for organizations with 500+ users sharing limited bandwidth

3. **Vite for Modern Tooling**: Vite provides:
   - Fast HMR (Hot Module Replacement) for development
   - Modern ES module bundling for production
   - Tree-shaking to eliminate dead code
   - Optimized chunk splitting for code-splitting opportunities
   - Better than Webpack/Parcel for this use case

4. **Server-Side Rendering Not Needed**: This is a closed-application SPA (requires login), so SSR offers no SEO benefit. Vanilla JS is sufficient.

5. **PWA-Friendly**: Vanilla JS integrates smoothly with service workers and offline APIs without framework abstractions that can obscure these features.

6. **Team Flexibility**: Scouts organizations may have rotating volunteers with varying skill levels. Vanilla JS is easier to onboard than framework-specific knowledge.

---

## Core Design Principles

### 1. **Single Language Per Page** (Bilingual Design)

**Decision:** Each page renders entirely in one language at a time, switching between English/French based on user selection.

**Why NOT Mix Languages?**

- **UX Coherence**: Mixed-language pages confuse users, especially scout parents with different language preferences in families.
- **Accessibility**: Screen readers and translation tools struggle with mixed-language content.
- **Legal Compliance**: Some regions (Quebec) have specific language display requirements; full-page language switching ensures compliance.
- **Reduced Cognitive Load**: Users don't context-switch between languages while filling forms or reading instructions.

**Implementation:**

```javascript
// app.js - Language is stored globally and used for all translations
export let currentLanguage = localStorage.getItem('language') || CONFIG.DEFAULT_LANG;

// All text uses getTranslation(key, currentLanguage)
export function getTranslation(key, lang = currentLanguage) {
  return translationData[lang]?.[key] || key;
}

// When user switches language, entire page re-renders
export function switchLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('language', lang);
  router.navigate(window.location.pathname); // Re-render current page
}
```

**Implementation Pattern:**
- Store translations in `lang/en.json`, `lang/fr.json`, etc.
- Use data-i18n attributes for static content
- Use `getTranslation()` for dynamic content
- Never display text without translation keys

---

### 2. **Mobile-First Design**

**Decision:** Design for 320px+ screens first; enhance for larger screens with media queries.

**Why Mobile-First?**

1. **Scout Context**: Scout activities happen outdoors—leaders check apps on mobile devices during camping trips and on the road.
2. **Scout Parents**: Many use older, budget phones. Mobile-first ensures the app works for everyone.
3. **Accessibility**: Smaller constraints force simpler, more accessible interfaces.
4. **Progressive Enhancement**: Larger screens get richer features without breaking small-screen functionality.

**Implementation:**

```css
/* Mobile-first: default styles target 320px+ */
.button {
  padding: var(--space-md) var(--space-lg); /* 16px 24px */
  font-size: var(--font-size-base); /* ~16px */
  min-height: var(--touch-target-min); /* 44px touch target */
  width: 100%;
}

/* Enhance for tablets/desktops */
@media (min-width: 768px) {
  .button {
    width: auto;
    padding: var(--space-sm) var(--space-lg);
  }
  
  .grid-layout {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-lg);
  }
}

@media (min-width: 1024px) {
  .grid-layout {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

**Touch Target Sizing:**
- Minimum 44x44px (iOS guideline) for all interactive elements
- Prevents accidental taps on mobile devices

**Fluid Typography:**
```css
/* Scales between breakpoints instead of jumping sizes */
--font-size-base: clamp(0.9375rem, 0.875rem + 0.3vw, 1.125rem);
/* Small screens: ~15px, Large screens: ~18px, fluid scaling between */
```

---

### 3. **No Hardcoded Values**

**Decision:** All configuration, constants, and settings are centralized in `config.js` and `lang/*.json`.

**Why?**

1. **Single Source of Truth**: If API URL changes, update one place (`CONFIG.API_BASE_URL`), not 50 files.
2. **Environment Flexibility**: Different URLs for dev/staging/production without code changes.
3. **Easy Debugging**: Search `CONFIG.` to see all configuration points.
4. **Onboarding**: New developers understand the app's configuration immediately.

**Bad Pattern (Avoid):**
```javascript
// ❌ BAD: Hardcoded everywhere
const response = await fetch('https://api.wampums.app/api/v1/participants');
const maxRetries = 3;
const timeout = 5000;
```

**Good Pattern:**
```javascript
// ✅ GOOD: Centralized in config.js
import { CONFIG } from './config.js';
const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/participants`);
const maxRetries = CONFIG.API.MAX_RETRIES;
const timeout = CONFIG.API.TIMEOUT;
```

**CONFIG Structure:**
```javascript
export const CONFIG = {
  API_BASE_URL: process.env.VITE_API_URL || window.location.origin,
  API: {
    MAX_RETRIES: 3,
    TIMEOUT: 5000,
    CACHE_DURATION: { SHORT: 5 * 60 * 1000, MEDIUM: 30 * 60 * 1000, LONG: 24 * 60 * 60 * 1000 }
  },
  STORAGE_KEYS: { JWT_TOKEN: 'jwtToken', LANGUAGE: 'language', ... },
  DEFAULT_LANG: 'fr',
  SUPPORTED_LANGS: ['en', 'fr', 'uk', 'it', 'id'],
  DEBUG: isDebugMode()
};
```

---

## Application State Management

### Why Minimal, Centralized State in `app.js`?

**Decision:** Use a single `app` object (exported from `app.js`) as the global application state instead of Redux/Vuex.

**Rationale:**

1. **Reduced Complexity**: Scout organizations don't have complex shared state between components. Most state is local to modules.
2. **Performance**: No state-watching overhead; modules manage their own re-renders.
3. **Debugging**: Global state is literal—`console.log(app)` shows everything, no middleware to trace.
4. **Bundle Size**: No state management library adds a few KB, crucial for offline/slow-network users.

**`app` Object Structure:**

```javascript
export const app = {
  // Authentication
  isLoggedIn: false,
  userRole: null,                    // Primary role (backward compat)
  userRoles: [],                     // All user roles
  userPermissions: [],               // All user permissions
  userFullName: null,
  userId: null,
  userEmail: null,
  
  // Organization context
  organizationId: null,
  currentOrganizationId: null,
  organizationName: null,
  organizationSettings: {},
  
  // UI state
  currentLanguage: 'fr',
  theme: 'light',
  
  // Cached data (pre-loaded for offline support)
  cachedParticipants: null,
  cachedActivities: null,
  cachedBudgets: null
};
```

**Why This Works:**

1. **Modules Read State Directly**: No context providers or props drilling.
   ```javascript
   // In any module
   import { app } from './app.js';
   
   if (app.isLoggedIn && app.userPermissions.includes('budget.manage')) {
     // Show budget UI
   }
   ```

2. **Modules Trigger Actions via Events**: State changes dispatch custom events that other modules listen for.
   ```javascript
   // In login module
   app.isLoggedIn = true;
   app.userPermissions = response.permissions;
   window.dispatchEvent(new CustomEvent('userLoggedIn', { detail: app }));
   
   // In budget module
   window.addEventListener('userLoggedIn', () => {
     if (app.userPermissions.includes('budget.manage')) {
       this.render();
     }
   });
   ```

3. **No Re-render Overhead**: Only modules that care about changes re-render. Saves CPU/battery on mobile.

**Limitations Accepted:**

- Not suitable for highly dynamic, real-time applications
- Large-scale apps need proper state management
- This is fine for Scout management (primarily CRUD operations)

---

## Routing & Navigation

### Single-Page Router Pattern

**Decision:** Implement custom client-side routing instead of using a framework router.

**Why?**

1. **File Size**: No router library needed (~10KB savings).
2. **Simplicity**: Routing logic is explicit and easy to understand in `router.js`.
3. **Performance**: No route matching library overhead; simple URL parsing.
4. **Control**: Can implement organization-specific routing logic easily.

**Routing Architecture:**

```javascript
// router.js
export class Router {
  constructor() {
    this.routes = new Map();
    this.currentModule = null;
  }

  register(path, moduleLoader, guards = []) {
    this.routes.set(path, { moduleLoader, guards });
  }

  async navigate(path) {
    // Find matching route
    const route = this.routes.get(path);
    if (!route) {
      this.navigate('/404');
      return;
    }

    // Check guards (permissions, authentication)
    for (const guard of route.guards) {
      if (!guard(app)) {
        this.navigate('/login');
        return;
      }
    }

    // Clean up previous module
    if (this.currentModule?.destroy) {
      this.currentModule.destroy();
    }

    // Load and initialize new module
    const ModuleClass = await route.moduleLoader();
    this.currentModule = new ModuleClass(app);
    await this.currentModule.init();
  }
}

// Initialize routes in app.js
router.register('/dashboard', () => import('./dashboard.js').then(m => m.Dashboard), [
  app => app.isLoggedIn  // Guard: must be logged in
]);

router.register('/admin', () => import('./admin.js').then(m => m.Admin), [
  app => app.isLoggedIn && app.userPermissions.includes('admin.access')  // Guard: must have permission
]);
```

**Lazy-Loading for Performance:**

```javascript
// Only load modules when user navigates to them
const lazyModules = {
  Dashboard: () => import('./dashboard.js').then(m => m.Dashboard),
  Admin: () => import('./admin.js').then(m => m.Admin),
  Finance: () => import('./finance.js').then(m => m.Finance)
};
```

**Benefits:**

- Initial page load: only 50-100KB (Dashboard + core utilities)
- Admin module: loaded only if user accesses `/admin`
- Significantly faster Time-to-Interactive (TTI) on mobile

**Browser History Management:**

```javascript
// Listen for browser back/forward buttons
window.addEventListener('popstate', (e) => {
  router.navigate(e.state?.path || '/');
});

// Update history when navigating
export function navigate(path) {
  window.history.pushState({ path }, '', path);
  router.navigate(path);
}
```

---

## Module System

### Why ES6 Modules + BaseModule Class?

**Decision:** Use ES6 `import/export` with a `BaseModule` parent class pattern for all feature modules.

**Why?**

1. **Native Browser Support**: No module bundler needed at runtime (Vite handles bundling for production).
2. **Automatic Cleanup**: `BaseModule` uses `AbortController` to clean up event listeners and prevent memory leaks.
3. **Consistent Pattern**: Every feature (Dashboard, Finance, Attendance) follows the same structure.

**Module Pattern:**

```javascript
// dashboard.js
import { BaseModule } from './utils/BaseModule.js';
import { debugLog } from './utils/DebugUtils.js';
import { makeApiRequest } from './api/api-core.js';

export class Dashboard extends BaseModule {
  constructor(app) {
    super(app);
    this.data = null;
  }

  async init() {
    debugLog('Dashboard: Initializing');
    
    // Fetch data
    this.data = await this.loadData();
    
    // Render UI
    this.render();
    
    // Attach event listeners with automatic cleanup
    document.getElementById('refresh-btn')
      .addEventListener('click', () => this.refresh(), { signal: this.signal });
  }

  async loadData() {
    try {
      const response = await makeApiRequest('v1/participants');
      return response.data;
    } catch (error) {
      debugError('Dashboard: Failed to load data', error);
      return null;
    }
  }

  render() {
    const container = document.getElementById('dashboard-content');
    container.innerHTML = `
      <h1>Dashboard</h1>
      <p>${this.data?.count || 0} participants</p>
    `;
  }

  async refresh() {
    this.data = await this.loadData();
    this.render();
  }

  // Called automatically by router when navigating away
  destroy() {
    super.destroy(); // IMPORTANT: Must call parent
    debugLog('Dashboard: Cleaned up');
  }
}
```

**BaseModule Benefits:**

1. **Automatic Event Listener Cleanup**: Prevents memory leaks when navigating.
   ```javascript
   // In BaseModule
   destroy() {
     this.abortController.abort(); // All listeners with this.signal are removed
   }
   ```

2. **Consistent Lifecycle**: Every module has `init()`, `render()`, and `destroy()`.

3. **Easier Testing**: Modules are decoupled from the router; can be instantiated and tested independently.

**Memory Leak Prevention:**

```javascript
// ✅ GOOD: Event listeners auto-clean with this.signal
export class MyModule extends BaseModule {
  init() {
    document.getElementById('btn')
      .addEventListener('click', handler, { signal: this.signal });
  }

  destroy() {
    super.destroy(); // Signal aborted, listener removed
  }
}

// ❌ BAD: Manual cleanup (forgot to remove listener)
export class OldModule {
  init() {
    this.listener = () => { /* handle click */ };
    document.getElementById('btn').addEventListener('click', this.listener);
  }

  destroy() {
    // Forgot to remove listener!
    // Memory leak: listener still attached, module can't be garbage collected
  }
}
```

**Module Caching:**

```javascript
// router.js
const moduleCache = {};

async function loadModule(path) {
  if (moduleCache[path]) {
    return moduleCache[path]; // Return cached module
  }
  
  const moduleClass = await import(path);
  moduleCache[path] = moduleClass;
  return moduleClass;
}
```

---

## Security Architecture

### Defense-in-Depth Approach

**Decision:** Multiple layers of security rather than relying on a single defense.

**Why?**

1. **Real-World Threat**: Scout apps handle sensitive data (parental info, health records, photos). Multiple defenses are necessary.
2. **User Trust**: Organizations trust us with personal information; we must take security seriously.
3. **Legal Compliance**: GDPR, COPPA (children's privacy), provincial privacy laws require documented security measures.

**Security Layers:**

#### Layer 1: **Input Sanitization** (Client-Side)

```javascript
// utils/SecurityUtils.js
import DOMPurify from 'dompurify';

export function sanitizeHTML(html, options = {}) {
  // DOMPurify removes script tags, event handlers, javascript: URLs
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['aria-label', 'data-*'], // Allow safe attributes
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'table', 'tr', 'td', ...]
  });
}

export function escapeHtml(text) {
  // Convert special characters to entities: < → &lt;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**Why DOMPurify?**
- Actively maintained (security patches released frequently)
- Comprehensive whitelist of safe HTML5 tags
- Removes XSS vectors like `onclick`, `onerror`, `<script>`
- Still allows rich content (tables, lists, links)

**Safe DOM Manipulation:**

```javascript
// ✅ GOOD: Use setContent() which auto-sanitizes
import { setContent } from './utils/DOMUtils.js';
setContent(element, userContent); // Safe!

// ❌ BAD: Directly using innerHTML
element.innerHTML = userContent; // XSS vulnerability!

// ✅ GOOD: Use setText() for plain text
import { setText } from './utils/DOMUtils.js';
setText(element, userText); // Safe! (textContent, no HTML)
```

#### Layer 2: **JWT Authentication** (API Authorization)

```javascript
// api/api-helpers.js
export function getAuthHeader() {
  const token = localStorage.getItem('jwtToken');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// Every API request includes JWT token
export async function makeApiRequest(endpoint, options = {}) {
  const response = await fetch(`${CONFIG.API_BASE_URL}/api/${endpoint}`, {
    ...options,
    headers: {
      ...getAuthHeader(),
      ...options.headers
    }
  });
  return handleResponse(response);
}
```

**JWT Benefits:**
- Token contains user ID, roles, permissions, organization ID
- Stateless (no session storage needed)
- Includes expiration to limit token lifetime
- Signed by server (can't be forged by client)

**Token Storage:**
```javascript
// Store in localStorage (vulnerable to XSS if sanitization fails)
// Risk accepted because: DOMPurify + CSP + no eval() makes XSS very hard
// Alternative: httpOnly cookies (requires backend changes, less flexible)
localStorage.setItem('jwtToken', token);
```

#### Layer 3: **Content Security Policy (CSP)** (Headers)

**Server-Side Header:**
```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self' https://api.wampums.app;
  frame-ancestors 'none';
```

**Effect:**
- Scripts can only load from same origin or whitelisted CDNs
- No inline eval, no dangerous functions
- Blocks many XSS attacks even if sanitization fails
- Blocks embedding in iframes (clickjacking defense)

#### Layer 4: **No Dangerous Functions**

```javascript
// ❌ NEVER use these
eval('...') // Can execute arbitrary code
Function('...')() // Can execute arbitrary code
element.innerHTML = userContent // XSS vector (use DOMUtils instead)
setTimeout(userContent, 100) // XSS vector
```

#### Layer 5: **Organization Isolation** (Backend)

```javascript
// api/api-core.js
// Every API request includes organization_id
function buildApiUrl(endpoint, params = {}) {
  const organizationId = getCurrentOrganizationId(); // From JWT
  params.organization_id = organizationId; // Always filter by org
  // ...
}

// Backend enforces:
// SELECT * FROM participants WHERE id = $1 AND organization_id = $2
// Can't access another organization's data even with valid JWT
```

---

## Visual Design System

### Why CSS Variables + BEM Naming + Mobile-First?

**Decision:** Centralized design tokens (CSS custom properties), BEM-inspired class naming, mobile-first responsive design.

**Why?**

1. **Consistency**: Single source of truth for colors, spacing, typography across the app.
2. **Maintainability**: Change `--color-primary` once, updates everywhere.
3. **Scalability**: Adding new screens/features uses the same design language.
4. **Accessibility**: Consistent spacing, contrast, font sizes improve accessibility.
5. **Performance**: CSS variables are native (no Sass compilation needed).

**Design Tokens (CSS Variables):**

```css
:root {
  /* Colors - Brand palette */
  --color-primary: #0f7a5a;           /* Scout green */
  --color-primary-light: #18b29a;     /* Lighter green for hover */
  --color-primary-dark: #0b5b43;      /* Darker green for active */
  --color-secondary: #e7f2ee;         /* Light background */
  
  /* Semantic colors */
  --color-success: #1a8f6b;           /* For success states */
  --color-error: #9a3f38;             /* For error states */
  --color-warning: #f1b746;           /* For warning states */
  --color-info: #178fce;              /* For info messages */
  
  /* Neutral colors */
  --color-text: #1d2f2a;              /* Primary text (high contrast) */
  --color-text-light: #47665d;        /* Secondary text */
  --color-text-muted: #6f8a81;        /* Tertiary text (captions) */
  --color-background: #f3f7f4;        /* Page background */
  --color-surface: #ffffff;           /* Card/surface background */
  --color-border: #d3e3dc;            /* Borders and dividers */
  
  /* Spacing scale (8px base) */
  --space-xs: 0.25rem;   /* 4px - tight spacing */
  --space-sm: 0.5rem;    /* 8px - small elements */
  --space-md: 1rem;      /* 16px - standard spacing */
  --space-lg: 1.5rem;    /* 24px - sections */
  --space-xl: 2rem;      /* 32px - major sections */
  --space-2xl: 3rem;     /* 48px - page sections */
  
  /* Typography - Fluid sizing scales between breakpoints */
  --font-size-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
  --font-size-base: clamp(0.9375rem, 0.875rem + 0.3vw, 1.125rem);
  --font-size-lg: clamp(1.125rem, 1rem + 0.5vw, 1.25rem);
  
  /* Border radius */
  --radius-sm: 0.4rem;   /* Subtle rounding */
  --radius-md: 0.75rem;  /* Standard components */
  --radius-lg: 1rem;     /* Cards, modals */
  --radius-full: 9999px; /* Fully rounded (pills) */
  
  /* Shadows - Elevation system */
  --shadow-sm: 0 1px 2px rgba(15, 122, 90, 0.08);    /* Subtle */
  --shadow-md: 0 8px 20px rgba(15, 122, 90, 0.1);    /* Standard card */
  --shadow-lg: 0 12px 30px rgba(15, 122, 90, 0.12);  /* Modal/overlay */
  
  /* Transitions */
  --transition-fast: 150ms ease;      /* Hover states */
  --transition-base: 250ms ease;      /* General animations */
  --transition-slow: 350ms ease;      /* Page transitions */
  
  /* Z-index scale */
  --z-base: 1;
  --z-dropdown: 100;
  --z-modal: 1000;
  --z-toast: 1100;
}
```

**Why These Specific Tokens?**

| Token | Reason |
|-------|--------|
| `--color-primary: #0f7a5a` | Scout green - trusted, professional for youth organization |
| `--space-*: 8px base` | 8px = standard web spacing unit; scales well |
| `clamp()` typography | Fluid: small screens ~15px, large ~18px, no jarring jumps |
| Semantic colors | `-success`, `-error`, `-warning` = clear meaning for all users |
| Shadow elevation | Different depths show UI hierarchy visually |

**BEM Naming (Block Element Modifier):**

```css
/* Block: Main component */
.badge-form { }

/* Element: Part of the block */
.badge-form__title { }
.badge-form__input { }
.badge-form__button { }

/* Modifier: Variation of the block/element */
.badge-form--loading { }
.badge-form__button--primary { }
.badge-form__button--danger { }
.badge-form__input--error { }

/* Pseudo-classes for states (not modifiers) */
.badge-form__button:hover { }
.badge-form__button:active { }
.badge-form__input:focus { }
.badge-form__input:disabled { }
```

**Benefits:**

1. **No Class Collisions**: `.button` can't conflict with another component's `.button`
2. **Semantic**: `.badge-form__title` clearly shows it belongs to the badge form
3. **States Clear**: `.badge-form--loading` vs `.badge-form__button--primary` are visually distinct

**Mobile-First Responsive Example:**

```css
/* Mobile: 320px+ (default) */
.participant-card {
  display: block;
  width: 100%;
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

.participant-card__name {
  font-size: var(--font-size-base);
}

.participant-card__details {
  display: none; /* Hidden on mobile */
}

/* Tablet: 768px+ */
@media (min-width: 768px) {
  .participant-card {
    display: grid;
    grid-template-columns: 1fr 2fr 1fr;
    gap: var(--space-lg);
  }

  .participant-card__details {
    display: block; /* Show details */
  }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .participant-card {
    grid-template-columns: 200px 3fr 1fr 150px;
    padding: var(--space-lg);
  }
}
```

**Touch Target Sizing:**

```css
/* All clickable elements: minimum 44x44px (iOS guideline) */
button, a[role="button"], input[type="checkbox"], input[type="radio"] {
  min-height: var(--touch-target-min); /* 44px */
  min-width: var(--touch-target-min);
  padding: var(--space-sm) var(--space-md);
}

/* Ensure text links in paragraphs are also 44px */
p a {
  padding: var(--space-xs) var(--space-sm);
  display: inline-block;
  min-height: var(--touch-target-min);
}
```

**Why 44px?**
- Average finger width: ~20-25mm
- 44px ≈ 11mm at 96 DPI
- Reduces accidental taps on mobile devices
- Required by Apple HIG and WCAG accessibility standards

---

## Data Management & Caching

### IndexedDB for Offline-First Capability

**Decision:** Use IndexedDB (client-side NoSQL database) for client-side caching and offline data storage.

**Why IndexedDB Instead of LocalStorage?**

| Feature | LocalStorage | IndexedDB |
|---------|--------------|-----------|
| Storage limit | 5-10MB | 50MB+ (per origin) |
| Data types | Strings only | Objects, Blobs, arrays |
| Querying | No (linear scan needed) | Indexes for fast lookup |
| Performance | Synchronous (blocks UI) | Asynchronous (non-blocking) |
| Transaction support | No | Yes (ACID) |

**For Scout App:**
- LocalStorage is too small (100+ participants + activities would exceed 5MB quickly)
- IndexedDB allows caching full datasets (~20MB) without blocking UI
- Queries are indexed, so searching 1000 participants is fast

**IndexedDB Usage:**

```javascript
// indexedDB.js
export async function setCachedData(key, data, expirationTime = 2 * 60 * 60 * 1000) {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offlineData', 'readwrite');
    const store = tx.objectStore('offlineData');

    const record = {
      key: key,
      data: data,
      type: 'cache',
      timestamp: Date.now(),
      expiration: Date.now() + expirationTime // 2 hours default
    };

    store.put(record);
    tx.oncomplete = () => resolve();
  });
}

export async function getCachedData(key, maxAge = null) {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('offlineData', 'readonly');
    const store = tx.objectStore('offlineData');
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result;
      
      if (!record) {
        resolve(null);
        return;
      }

      // Check if data is expired
      if (record.expiration && Date.now() > record.expiration) {
        store.delete(key); // Clean up expired data
        resolve(null);
        return;
      }

      resolve(record.data);
    };
  });
}
```

**Caching Strategy:**

```javascript
// api-core.js
export async function makeApiRequest(endpoint, options = {}) {
  const cacheKey = `api:${endpoint}`;
  const cacheDuration = CONFIG.CACHE_DURATION.MEDIUM; // 30 minutes default

  // Online: fetch from API and cache
  if (navigator.onLine) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      // Cache for offline use
      await setCachedData(cacheKey, data, cacheDuration);
      
      return data;
    } catch (error) {
      // Network error: try cache
      const cached = await getCachedData(cacheKey);
      if (cached) {
        debugWarn('Network error, using cached data:', cacheKey);
        return cached;
      }
      throw error;
    }
  } else {
    // Offline: use cached data or fail gracefully
    const cached = await getCachedData(cacheKey);
    if (cached) {
      return cached;
    }
    throw new Error('Offline and no cached data available');
  }
}
```

**Cache Invalidation:**

```javascript
// When data changes, clear related caches
export async function clearCacheByPrefix(prefix) {
  const db = await openDB();
  const allKeys = await db.getAllKeys('offlineData');
  
  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      await deleteData(key);
    }
  }
}

// Example: After creating a participant, clear participants cache
async function createParticipant(data) {
  const response = await makeApiRequest('v1/participants', {
    method: 'POST',
    body: JSON.stringify(data)
  });

  // Invalidate cache
  await clearCacheByPrefix('api:v1/participants');
  
  return response;
}
```

---

## Offline-First Capability

### Why Offline Support?

**Decision:** Design the app to work offline; sync data when connection returns.

**Why?**

1. **Scout Context**: Scout activities happen outdoors—connectivity is often poor or nonexistent.
2. **Reliability**: Parent wants to check attendance even at the cabin; not an optional feature.
3. **Better UX**: App responds instantly to local actions instead of waiting for network.

**Offline Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│ User interacts with app (add attendance, update notes)  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
           ┌─────────────────────┐
           │ Online?             │
           └────┬────────────┬───┘
                │            │
         YES    │            │    NO
                ↓            ↓
          ┌─────────┐   ┌──────────────┐
          │Send to  │   │Save to       │
          │API      │   │IndexedDB     │
          │         │   │(Offline store)
          └────┬────┘   └──────┬───────┘
               │                │
               └────┬───────────┘
                    ↓
          ┌──────────────────┐
          │Update local UI   │
          │(immediately)     │
          └──────┬───────────┘
                 │
                 ↓
        ┌────────────────────┐
        │ Connection returns │
        └────────┬───────────┘
                 │
                 ↓
      ┌──────────────────────┐
      │Sync pending changes  │
      │from IndexedDB        │
      │to API                │
      └────────┬─────────────┘
               │
               ↓
      ┌────────────────────┐
      │Show sync status    │
      │in OfflineIndicator │
      └────────────────────┘
```

**OfflineManager Module:**

```javascript
// modules/OfflineManager.js
export class OfflineManager {
  async init() {
    debugLog('OfflineManager: Initializing');
    
    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  async recordMutation(action, data) {
    // Save pending changes to IndexedDB
    await saveOfflineData(`pending:${Date.now()}`, {
      action: action,      // e.g., 'POST', 'PUT', 'DELETE'
      endpoint: data.endpoint,
      payload: data.payload,
      timestamp: Date.now()
    });

    debugLog('OfflineManager: Recorded pending mutation:', action);
  }

  async handleOnline() {
    debugLog('OfflineManager: Connection returned, syncing pending changes');

    const pending = await getOfflineData('pending');
    
    for (const mutation of pending) {
      try {
        await makeApiRequest(mutation.endpoint, {
          method: mutation.action,
          body: JSON.stringify(mutation.payload)
        });

        // Clear from pending after successful sync
        await clearOfflineData(`pending:${mutation.timestamp}`);
        
        debugLog('OfflineManager: Synced:', mutation.action);
      } catch (error) {
        debugError('OfflineManager: Sync failed, will retry:', error);
      }
    }

    window.dispatchEvent(new CustomEvent('syncComplete'));
  }

  handleOffline() {
    debugLog('OfflineManager: Connection lost, entering offline mode');
    window.dispatchEvent(new CustomEvent('goingOffline'));
  }
}
```

**OfflineIndicator Component:**

```javascript
// components/OfflineIndicator.js
export class OfflineIndicator {
  init() {
    this.indicator = document.createElement('div');
    this.indicator.className = 'offline-indicator';
    this.indicator.innerHTML = `
      <span class="offline-indicator__icon">📡</span>
      <span class="offline-indicator__text" data-i18n="offline.indicator">Working offline</span>
    `;

    // Listen for online/offline events
    window.addEventListener('online', () => this.show());
    window.addEventListener('offline', () => this.hide());
    window.addEventListener('syncComplete', () => this.showSyncSuccess());

    // Show if currently offline
    if (!navigator.onLine) {
      this.hide();
    }

    document.body.appendChild(this.indicator);
  }

  show() {
    this.indicator.style.display = 'none'; // Online - hide indicator
  }

  hide() {
    this.indicator.style.display = 'block'; // Offline - show indicator
  }

  showSyncSuccess() {
    this.indicator.textContent = '✓ Synced';
    this.indicator.style.backgroundColor = 'var(--color-success)';
    
    setTimeout(() => {
      this.indicator.textContent = 'Offline mode';
      this.indicator.style.backgroundColor = 'var(--color-warning)';
    }, 3000);
  }
}
```

**Optimistic Updates (Better UX):**

```javascript
// When user adds attendance offline, update UI immediately
async function recordAttendance(participantId) {
  // Optimistic: Update UI immediately
  updateAttendanceUI(participantId, 'present');

  // Save to offline store
  await recordMutation('POST', {
    endpoint: 'v1/attendance',
    payload: { participant_id: participantId, status: 'present' }
  });

  // When online, sync to API
  try {
    await makeApiRequest('v1/attendance', {
      method: 'POST',
      body: JSON.stringify({ participant_id: participantId, status: 'present' })
    });
    
    debugLog('Attendance synced to API');
  } catch (error) {
    debugError('Attendance sync failed:', error);
    // Revert UI on error
    updateAttendanceUI(participantId, 'unknown');
  }
}
```

---

## API Integration

### RESTful API with JWT Authentication

**Decision:** Use RESTful endpoints under `/api/v1/` with JWT bearer tokens.

**API Request Pattern:**

```javascript
// api-core.js
export async function makeApiRequest(endpoint, options = {}) {
  const url = buildApiUrl(endpoint, options.params);

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${getStorage('jwtToken')}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  return handleResponse(response);
}
```

**Why `/api/v1/`?**
- Clear versioning: future `/api/v2/` won't break clients using `/api/v1/`
- Server can deprecate old endpoints gracefully
- Allows parallel API evolution

**Why JWT Instead of Sessions?**

| Aspect | JWT | Sessions |
|--------|-----|----------|
| Server Storage | None (stateless) | Redis/Database needed |
| Scalability | Infinite (no session store) | Limited by DB performance |
| Mobile | Works via headers | Requires cookies |
| Logout | Token expiration only | Immediate revocation |
| Offline | Can validate locally | Always requires server |

**JWT Format:**
```javascript
// Token contains (after decoding)
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "roleIds": [1, 3],
  "roleNames": ["animation", "leader"],
  "permissions": ["attendance.manage", "badge.view", "finance.view"],
  "organizationId": "org-12345",
  "exp": 1234567890,
  "iat": 1234567800
}
```

**API Response Format (Standardized):**

```javascript
// Success response
{
  "success": true,
  "message": "Operation successful",
  "data": { /* actual response */ },
  "timestamp": "2025-01-23T15:30:00.000Z"
}

// Error response
{
  "success": false,
  "message": "Validation failed",
  "timestamp": "2025-01-23T15:30:00.000Z",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}

// Paginated response
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  },
  "timestamp": "2025-01-23T15:30:00.000Z"
}
```

**HTTP Status Codes:**

```javascript
// makeApiRequest throws on non-2xx status
// Caller handles errors

// 200 OK - GET/PUT/PATCH successful
// 201 Created - POST successful
// 204 No Content - DELETE successful

// 400 Bad Request - Validation error (check response.errors)
// 401 Unauthorized - Token missing/invalid (auto-redirect to login)
// 403 Forbidden - Permission denied (show error message)
// 404 Not Found - Resource doesn't exist
// 409 Conflict - Duplicate/constraint violation
// 500 Server Error - Unhandled exception (show error message)
```

**Error Handling in Modules:**

```javascript
async function loadParticipants() {
  try {
    const response = await makeApiRequest('v1/participants');
    this.participants = response.data;
    this.render();
  } catch (error) {
    if (error.status === 401) {
      // Token expired, user auto-redirected to login by makeApiRequest
      return;
    } else if (error.status === 403) {
      showToast('You do not have permission to view participants', 'error');
    } else if (error.status === 404) {
      showToast('Organization not found', 'error');
    } else {
      debugError('Failed to load participants:', error);
      showToast('Failed to load participants. Please try again.', 'error');
    }
  }
}
```

---

## Internationalization (i18n)

### One Language Per Page Design

**Translation Files Structure:**

```
lang/
├── en.json    (English)
├── fr.json    (French)
├── uk.json    (Ukrainian)
├── it.json    (Italian)
└── id.json    (Indonesian)
```

**Translation Keys (Hierarchical):**

```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "loading": "Loading...",
    "error": "An error occurred"
  },
  "dashboard": {
    "title": "Dashboard",
    "welcome": "Welcome, {name}",
    "participantCount": "You have {count} participants"
  },
  "attendance": {
    "title": "Attendance",
    "present": "Present",
    "absent": "Absent",
    "excused": "Excused"
  }
}
```

**Dynamic Translations with Variables:**

```javascript
// app.js
export function getTranslation(key, lang = currentLanguage, vars = {}) {
  let text = translationData[lang]?.[key] || key;

  // Replace variables: {name} → John, {count} → 5
  Object.entries(vars).forEach(([k, v]) => {
    text = text.replace(`{${k}}`, v);
  });

  return text;
}

// Usage
const welcome = getTranslation('dashboard.welcome', 'fr', { name: 'Jean' });
// Result: "Bienvenue, Jean"
```

**Language Switching:**

```javascript
// app.js
export function switchLanguage(lang) {
  if (!CONFIG.SUPPORTED_LANGS.includes(lang)) {
    debugError('Invalid language:', lang);
    return;
  }

  currentLanguage = lang;
  localStorage.setItem('language', lang);

  // Re-render entire page in new language
  window.location.reload(); // or router.navigate(current path)
}
```

**Rendering with i18n:**

```html
<!-- Static content: use data-i18n attribute -->
<h1 data-i18n="attendance.title">Attendance</h1>

<!-- Dynamic content: use getTranslation() -->
<p id="welcome-msg"></p>
<script>
  document.getElementById('welcome-msg').textContent = 
    getTranslation('dashboard.welcome', { name: app.userFullName });
</script>

<!-- Variables in HTML: Use template literals -->
<p>${getTranslation('dashboard.participantCount', { count: participants.length })}</p>
```

**Why Not React i18n / i18next?**
- React i18n requires framework
- i18next adds 15+KB to bundle
- This simple system: <2KB
- Scouts need lightweight; framework adds unnecessary complexity

---

## Performance Optimization

### Lazy Loading & Code Splitting

**Problem:** Initial bundle includes all routes (Dashboard, Admin, Finance, etc.); loading time increases with each feature added.

**Solution:** Load routes on-demand using dynamic imports.

```javascript
// router.js - Lazy-load modules only when user navigates
const lazyModules = {
  Dashboard: () => import('./dashboard.js').then(m => m.Dashboard),
  Admin: () => import('./admin.js').then(m => m.Admin),
  Finance: () => import('./finance.js').then(m => m.Finance),
  Attendance: () => import('./attendance.js').then(m => m.Attendance)
  // ... 50+ more modules
};

// Initial bundle: ~50-100KB (just core)
// Admin module: ~20KB (loaded only if accessed)
// Finance module: ~30KB (loaded only if accessed)
```

**Bundle Sizes (Estimated):**

```
✅ CURRENT (Optimized with lazy-loading):
- Initial: 50KB (core + dashboard)
- Admin page: +20KB (on demand)
- Finance page: +30KB (on demand)
- Total: ~100KB over time

❌ WITHOUT lazy-loading:
- Initial: 150KB (all modules bundled)
- Slow first load, especially on mobile
```

**Performance Metrics:**

| Metric | Target | Why |
|--------|--------|-----|
| First Contentful Paint (FCP) | <2s | Mobile user sees something immediately |
| Time to Interactive (TTI) | <3s | Mobile user can interact within 3 seconds |
| Largest Contentful Paint (LCP) | <2.5s | Main content loaded and visible |
| Cumulative Layout Shift (CLS) | <0.1 | No unexpected layout shifts (WCAG) |

**Caching Strategy:**

```javascript
// Service Worker caches assets aggressively
// Vite builds with content hashes: app.a1b2c3d4.js
// If app.js changes, hash changes, new version cached
// If app.js unchanged, browser uses cached version

// Versioned assets never expire in cache
// index.html checked on every load (not cached)
```

**How to Check Performance:**

```bash
# Run Lighthouse audit
npm run build
npm run preview # Serve production build locally
# Open DevTools > Lighthouse, run audit
```

---

## Code Organization & Patterns

### File Structure

```
spa/
├── app.js                    # Global state & initialization
├── router.js                 # Client-side routing
├── config.js                 # Configuration & constants
├── ajax-functions.js         # Deprecated (use api-core.js)
├── functions.js              # General utilities
├── indexedDB.js              # IndexedDB wrapper
├── login.js                  # Login module
├── offline-init.js           # Offline support initialization
│
├── api/
│   ├── api-core.js          # Core request handling
│   ├── api-helpers.js       # Auth headers, organization context
│   └── api-offline-wrapper.js # Offline-online switching
│
├── modules/                  # Feature modules (reusable)
│   ├── BaseModule.js        # Base class for all modules
│   ├── OfflineManager.js    # Offline support
│   ├── DateManager.js       # Date operations
│   ├── FormManager.js       # Form handling
│   └── account-info.js      # Account info module
│
├── utils/                    # Utility functions (cross-cutting)
│   ├── DebugUtils.js        # Logging
│   ├── PermissionUtils.js   # Permission checks
│   ├── SecurityUtils.js     # Input sanitization
│   ├── DOMUtils.js          # Safe DOM manipulation
│   ├── DateUtils.js         # Date formatting
│   ├── StorageUtils.js      # localStorage helpers
│   ├── ValidationUtils.js   # Form validation
│   ├── PerformanceUtils.js  # Performance monitoring
│   └── BaseModule.js        # Module base class
│
├── components/              # Reusable UI components
│   └── OfflineIndicator.js # Offline status indicator
│
├── [Feature Pages]          # Feature modules (one per page)
│   ├── dashboard.js
│   ├── attendance.js
│   ├── badge_tracker.js
│   ├── finance.js
│   └── ... (40+ features)
│
└── [CSS]                    # Styles (one per feature)
    ├── styles.css           # Global styles & design tokens
    ├── account-info.css
    ├── carpool.css
    └── ... (per-feature styles)
```

**Why This Structure?**

| Folder | Purpose | Why |
|--------|---------|-----|
| `api/` | API communication layer | All API logic in one place; easy to swap or test |
| `modules/` | Reusable logic | Shared by multiple pages (date handling, offline) |
| `utils/` | Cross-cutting utilities | Don't repeat sanitization, debugging, validation |
| `components/` | Reusable UI components | Can instantiate anywhere (OfflineIndicator) |
| Feature pages | Feature modules | One feature per file; easy to find and modify |

### Module Pattern Example

**Every feature module follows this pattern:**

```javascript
// badge_tracker.js
import { BaseModule } from './utils/BaseModule.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { makeApiRequest } from './api/api-core.js';
import { setContent } from './utils/DOMUtils.js';
import { getTranslation } from './app.js';

/**
 * Badge Tracker Module
 * Displays user's progress toward badges
 */
export class BadgeTracker extends BaseModule {
  constructor(app) {
    super(app);
    this.badges = [];
    this.container = null;
  }

  /**
   * Initialize the module
   * Called when user navigates to this page
   */
  async init() {
    debugLog('BadgeTracker: Initializing');

    // Get DOM container
    this.container = document.getElementById('content');
    if (!this.container) {
      debugError('BadgeTracker: #content container not found');
      return;
    }

    // Render loading state
    this.renderLoading();

    // Load data
    await this.loadBadges();

    // Render badges
    this.render();

    // Attach event listeners (with automatic cleanup)
    this.container
      .addEventListener('click', (e) => this.handleClick(e), { signal: this.signal });
  }

  /**
   * Load badges from API
   */
  async loadBadges() {
    try {
      const response = await makeApiRequest('v1/badges');
      this.badges = response.data;
      debugLog('BadgeTracker: Loaded', this.badges.length, 'badges');
    } catch (error) {
      debugError('BadgeTracker: Failed to load badges', error);
      this.badges = [];
    }
  }

  /**
   * Render loading state
   */
  renderLoading() {
    setContent(this.container, `
      <div class="badge-tracker badge-tracker--loading">
        <p>${getTranslation('common.loading')}</p>
      </div>
    `);
  }

  /**
   * Render badges
   */
  render() {
    const badgesHtml = this.badges
      .map(badge => `
        <div class="badge-tracker__item">
          <img src="${badge.image_url}" alt="${badge.name}" 
               class="badge-tracker__image">
          <h3 class="badge-tracker__name">${badge.name}</h3>
          <p class="badge-tracker__progress">
            ${badge.progress}/${badge.requirements} requirements
          </p>
        </div>
      `)
      .join('');

    setContent(this.container, `
      <div class="badge-tracker">
        <h1 data-i18n="badges.title">${getTranslation('badges.title')}</h1>
        <div class="badge-tracker__list">
          ${badgesHtml}
        </div>
      </div>
    `);
  }

  /**
   * Handle click events
   */
  handleClick(e) {
    const badgeItem = e.target.closest('.badge-tracker__item');
    if (badgeItem) {
      const badgeId = badgeItem.dataset.badgeId;
      this.viewBadgeDetails(badgeId);
    }
  }

  /**
   * View badge details
   */
  async viewBadgeDetails(badgeId) {
    // Navigate to badge details page
    window.location.hash = `/badges/${badgeId}`;
  }

  /**
   * Clean up resources
   * Called automatically by router when navigating away
   */
  destroy() {
    super.destroy(); // IMPORTANT: Must call parent for event listener cleanup
    debugLog('BadgeTracker: Cleaned up');
  }
}
```

### Common Code Patterns to Use

**Async/Await for Clarity:**

```javascript
// ✅ GOOD: Clear flow with async/await
async function updateParticipant(id, data) {
  try {
    const response = await makeApiRequest(`v1/participants/${id}`, {
      method: 'PUT',
      body: data
    });
    
    showToast('Participant updated', 'success');
    return response.data;
  } catch (error) {
    debugError('Failed to update participant:', error);
    showToast('Failed to update participant', 'error');
  }
}

// ❌ BAD: Promise chains (harder to read)
function updateParticipant(id, data) {
  return makeApiRequest(`v1/participants/${id}`, {...})
    .then(response => {
      showToast('Participant updated', 'success');
      return response.data;
    })
    .catch(error => {
      debugError('Failed:', error);
      showToast('Failed to update', 'error');
    });
}
```

**Early Returns for Cleaner Code:**

```javascript
// ✅ GOOD: Early return, reduces nesting
async function saveForm(data) {
  if (!data) {
    debugError('No form data');
    return null;
  }

  const errors = validateForm(data);
  if (errors.length > 0) {
    showErrors(errors);
    return null;
  }

  try {
    const response = await makeApiRequest('v1/forms', {
      method: 'POST',
      body: data
    });
    return response.data;
  } catch (error) {
    debugError('Save failed:', error);
    return null;
  }
}

// ❌ BAD: Deeply nested if statements
function saveForm(data) {
  if (data) {
    const errors = validateForm(data);
    if (errors.length === 0) {
      try {
        return makeApiRequest(...);
      } catch (error) {
        debugError(...);
      }
    }
  }
}
```

**Defensive Programming:**

```javascript
// ✅ GOOD: Check for null/undefined
export function getUserPermissions() {
  if (!app || !app.userPermissions || !Array.isArray(app.userPermissions)) {
    debugWarn('No permissions loaded');
    return [];
  }

  return app.userPermissions;
}

// ❌ BAD: Assumes properties exist
export function getUserPermissions() {
  return app.userPermissions; // Crash if app or permissions are null
}
```

**Configuration Over Magic Numbers:**

```javascript
// ✅ GOOD: All constants in CONFIG
import { CONFIG } from './config.js';
setTimeout(() => refresh(), CONFIG.API.TIMEOUT);
const maxAttempts = CONFIG.API.MAX_RETRIES;

// ❌ BAD: Magic numbers scattered everywhere
setTimeout(() => refresh(), 5000);
for (let i = 0; i < 3; i++) { /* retry */ }
```

---

## Error Handling & Debugging

### Centralized Debug Logging

**Decision:** Use `DebugUtils.js` for all logging instead of `console.*`.

**Why?**

1. **Production Safety**: Production builds disable debug logs automatically.
2. **Consistency**: All logs use same format `[DEBUG]`, `[ERROR]`, `[WARN]`.
3. **Filtering**: Search for `[ERROR]` in production logs to find issues.
4. **Performance**: Debug logs in production add bytes for nothing; DebugUtils removes them.

**Debug Utilities:**

```javascript
import { debugLog, debugError, debugWarn, debugInfo } from './utils/DebugUtils.js';

// Log debug message (only in dev, not in production)
debugLog('Module initialized');

// Log error (ALWAYS shown, even in production)
debugError('API request failed:', error);

// Log warning (only in dev)
debugWarn('Deprecated method used');

// Log info (only in dev)
debugInfo('Cache hit for participants');

// Log table (useful for displaying arrays)
debugTable(participants, ['id', 'name', 'email']);
```

**Debug Mode Detection:**

```javascript
// config.js
export const CONFIG = {
  debugMode: isDebugMode()
};

function isDebugMode() {
  const isProduction = window.location.hostname.endsWith('.app');
  
  // Debug mode enabled on:
  // - localhost
  // - Vite dev server
  // - Replit.dev
  // - Disabled on production (*.app domains)
  return (
    !isProduction && (
      import.meta.env?.VITE_DEBUG_MODE === 'true' ||
      import.meta.env?.DEV ||
      window.location.hostname === 'localhost' ||
      window.location.hostname.includes('replit.dev')
    )
  );
}
```

**Error Boundaries (Graceful Degradation):**

```javascript
// app.js
async function initApp() {
  try {
    // Initialize core
    await loadUserData();
    await loadOrganizationSettings();
    
    // Initialize modules
    initOfflineSupport();
    registerPushNotifications();
    
    // Start router
    router.initialize();
  } catch (error) {
    debugError('Failed to initialize app:', error);
    
    // Show error page instead of blank screen
    document.body.innerHTML = `
      <div class="error-screen">
        <h1>Error</h1>
        <p>The application failed to initialize. Please refresh the page.</p>
        <button onclick="location.reload()">Refresh</button>
      </div>
    `;
  }
}
```

**API Error Handling:**

```javascript
// api-core.js
export async function handleResponse(response) {
  if (response.ok) {
    return response.json();
  }

  // Handle specific error codes
  switch (response.status) {
    case 401:
      debugWarn('Token expired, redirecting to login');
      localStorage.removeItem('jwtToken');
      window.location.href = '/login';
      break;

    case 403:
      debugWarn('Permission denied');
      throw new Error('You do not have permission for this action');

    case 404:
      debugWarn('Resource not found');
      throw new Error('Resource not found');

    case 500:
      debugError('Server error');
      throw new Error('Server error. Please try again later.');

    default:
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}
```

---

## Summary: Design Principles in Practice

| Principle | Implementation | Benefit |
|-----------|-----------------|---------|
| Mobile-First | 44px touch targets, 320px baseline | Works for scout leaders on any device |
| Security | DOMPurify + CSP + parameterized APIs | Protects sensitive scout data |
| Performance | Lazy-loading modules, IndexedDB caching | Fast on low-bandwidth connections |
| Offline | Service worker + IndexedDB + optimistic updates | Works in cabins without connectivity |
| Debugging | Centralized DebugUtils logging | Production issues are traceable |
| I18n | One language per page | Respects regional language preferences |
| No Hacks | CONFIG centralization, no magic numbers | Code is maintainable and scalable |
| Testability | BaseModule pattern, DI of app state | Features can be tested independently |

---

## Quick Reference: Adding a New Feature

**When creating a new page/feature:**

1. **Create feature module** (`spa/feature-name.js`)
   ```javascript
   import { BaseModule } from './utils/BaseModule.js';
   export class FeatureName extends BaseModule { ... }
   ```

2. **Add route** (`spa/router.js`)
   ```javascript
   lazyModules.FeatureName = () => import('./feature-name.js').then(m => m.FeatureName);
   router.register('/feature', lazyModules.FeatureName, [guards]);
   ```

3. **Use utilities** (DebugUtils, SecurityUtils, DOMUtils, DateUtils, PermissionUtils)

4. **Add translations** (`lang/en.json`, `lang/fr.json`)
   ```json
   { "feature.title": "Feature Name", ... }
   ```

5. **Add styles** (use design tokens: `--color-primary`, `--space-md`, etc.)

6. **Handle offline** (use IndexedDB caching, optimistic updates)

7. **Test** (Lighthouse audit, mobile device testing)

---

**Document Version:** 1.0
**Created:** January 23, 2026
**Maintainer:** Development Team

