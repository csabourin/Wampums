# Wampums Codebase Architecture Review (Deep Dive)

**Last reviewed:** 2026-02-12  
**Repository:** `/workspace/Wampums`

---

## 1) Executive Summary

Wampums is a **single-repository, multi-client** system with one Node/Express backend serving two clients:

1. a web SPA (Vite + vanilla JS modules), and
2. a React Native mobile app (Expo).

The architecture is clearly in a **progressive modernization phase**:

- ✅ Newer patterns are present (versioned APIs, response wrappers, permission-based auth, client-side module utilities, offline syncing).
- ⚠️ Legacy compatibility remains heavily active (many `/api` mounts, flat SPA feature scripts, monolithic server bootstrap).

This approach likely reflects a deliberate product trade-off: **ship continuously without destabilizing legacy workflows**.

---

## 2) How this review was built

This review is based on direct inspection of:

- system entrypoints (`api.js`, `spa/app.js`, `mobile/App.js`),
- route registrations and middleware stack,
- API client layers (SPA and mobile),
- shared utilities (`middleware/*`, `utils/*`),
- build config (`vite.config.js`),
- project topology (`routes`, `spa`, `mobile/src`, `migrations`, `services`).

The goal is to document not only *what exists* but *why those decisions were likely made* and where architectural risks are emerging.

---

## 3) High-level system architecture

## 3.1 Runtime topology

```text
[ Browser SPA ] ----\
                     \  HTTPS/JSON (+JWT, org headers)
[ Mobile Expo ] ----- > [ Express API + Socket.IO ] ---> [ PostgreSQL ]
                      /                                  \
                     /                                    -> [3rd-party services]
```

### Key observations

- Backend is both API gateway and static file host.
- SPA and mobile clients use similar auth + API semantics.
- Socket.IO is integrated in the backend process for real-time event channels.
- External providers are wrapped in `services/` modules.

### Why this design was likely chosen

- **Operational simplicity**: one deployable service for API + sockets + static content.
- **Shared auth context**: easier JWT/session consistency across HTTP and realtime.
- **Incremental evolution**: backend can support old and new route conventions concurrently.

---

## 4) Repository architecture map

## 4.1 Backend-centric folders

- `api.js` — monolithic server bootstrap and route registration.
- `routes/` — domain route modules (36 files).
- `middleware/` — auth/response/validation cross-cutting middleware.
- `utils/` — API helpers, token helpers, validation, notification helpers.
- `services/` — external integration adapters (AI, OCR, messaging).
- `config/` — DB, roles, swagger, meeting section defaults.
- `migrations/` — SQL evolution scripts.

## 4.2 Web client folders

- `spa/` — main web codebase (123 files).
  - `spa/app.js`, `spa/router.js` — app bootstrap + route orchestration.
  - `spa/api/` — client API abstraction.
  - `spa/modules/`, `spa/components/`, `spa/utils/`, `spa/sync/`, `spa/data/` — modularized internals.
  - many top-level feature scripts retained for backward compatibility.

## 4.3 Mobile folders

- `mobile/` — Expo project.
- `mobile/src/screens` — feature screens (59 files).
- `mobile/src/components` — reusable UI components (20 files).
- `mobile/src/navigation` — root/auth/app/tab navigation structure.
- `mobile/src/api` — API client.
- `mobile/src/utils` — storage, permissions, security, formatting, caching.

### Why this structure exists

The project carries strong signs of **feature breadth first, architecture second** maturation: domain-based slicing was introduced as scale increased, rather than from day one.

---

## 5) API server deep architecture

## 5.1 Bootstrapping layers in `api.js`

The server bootstrap currently performs all of the following in a single file:

1. runtime/env setup,
2. middleware setup (helmet/cors/body parsing/rate limiting/static),
3. DB pool creation,
4. route module instantiation,
5. route mounting,
6. health/robots/index/catch-all endpoints,
7. global error handling,
8. Socket.IO auth + room wiring,
9. process lifecycle hooks (startup/restore/shutdown).

### Why this likely happened

- Fastest path to consistent deployment over many releases.
- Historical accumulation of infra concerns in one place.
- Reduced indirection while team knowledge remained centralized.

### Architectural downside

- **Very high blast radius** for edits.
- Harder isolated testing for middleware order and route wiring.
- Increased risk of duplicate mounts and policy drift.

## 5.2 Middleware chain and security posture

The middleware stack includes:

- `helmet` CSP and security headers,
- dynamic CORS policy with wildcard matching,
- body parsing limits,
- ETag policy,
- global rate limiter + memory store cleanup,
- static content cache headers,
- request-level organization extraction helpers.

### Security choices and rationale

- CSP is strict enough to prevent broad script injection while still supporting CDN assets.
- Dynamic CORS patterns are practical for multi-subdomain and dev environments.
- Request limits and rate limiting address abuse and accidental resource spikes.

### Gaps / risks

- CSP and CORS complexity concentrated in one file is brittle.
- Policy correctness depends on careful manual ordering.
- Logging around policy decisions is mixed (`console.*` and logger coexist).

## 5.3 Route composition model

Route modules are instantiated as factories, typically:

```js
const usersRoutes = require('./routes/users')(pool, logger);
```

and mounted with `app.use(...)`.

### Strengths

- Dependency injection is explicit.
- Route modules can stay domain-focused.
- Testing route files is easier than if they used implicit globals.

### Critical irregularities found

1. **Versioning drift**: legacy `/api` and versioned `/api/v1` coexist heavily.
2. **Duplicate registration**: `/api/ai` mounted twice.
3. **Hybrid attendance route policy**: both `/api/v1/attendance` and `/api/attendance` are mounted.
4. **Participants mounted both legacy and v1**.

### Why this pattern likely exists

- Backward compatibility for existing clients and links.
- Gradual migration strategy to avoid big-bang API cutover.

## 5.4 Multi-tenant organization context

The system supports multiple org-resolution inputs:

- JWT organization claim,
- `x-organization-id` header,
- query/body fallbacks,
- hostname/domain mapping,
- localhost fallback env var.

### Why this exists

- Supports authenticated app traffic, public routes, and multi-domain hosting.
- Allows local development without production domain mapping.

### Risk surface

- More fallback paths increase complexity and testing burden.
- Security relies on strict precedence rules and consistent route behavior.

## 5.5 AuthN/AuthZ model

- Authentication: JWT bearer token (`authenticate` middleware).
- Authorization:
  - deprecated role middleware still exists (`authorize`),
  - newer permission-centric design is encouraged.

### Why this model exists

- Represents migration from role-only to permission-based access control.
- Preserves older handlers while new work uses permission checks.

### Risk

- Mixed authorization paradigms can cause inconsistent enforcement unless audited.

## 5.6 Response contract

- `middleware/response.js` provides normalized `success`, `error`, and `paginated` outputs.

### Why this matters

- SPA and mobile can consume consistent envelope shape.
- Easier centralized error reporting and UX handling.

### Current maturity

- Pattern is established, but full compliance across all routes should be contract-tested.

## 5.7 Real-time architecture (Socket.IO)

- Socket auth uses JWT token from handshake.
- User/org extracted into socket context.
- Socket joins org-scoped room: `org-<organizationId>`.

### Why this design exists

- Org-level room targeting is a practical tenancy-aware realtime pattern.
- Fits notification/integration workflows without extra pub/sub layer.

### Risk

- As traffic grows, colocated HTTP + realtime in one process can become scaling bottleneck.

## 5.8 Persistence/migrations

- SQL scripts are present and focused by feature.
- No strongly enforced timestamped migration naming convention observed.

### Why this exists

- Lightweight migration process lowers contributor friction.

### Risk

- Ordering ambiguity in multi-contributor deploy pipelines.

---

## 6) SPA deep architecture

## 6.1 Bootstrapping and app lifecycle

`spa/app.js` manages:

- session restoration,
- language/translation setup,
- organization settings fetch,
- router initialization,
- service worker / push / offline startup.

### Why this design exists

- A single orchestrator simplifies startup sequencing for complex state.
- Avoids race conditions between auth state and first route render.

### Trade-off

- App bootstrap is large, and responsibilities are broad.

## 6.2 Routing architecture

`spa/router.js` is large and central, coordinating many feature pages.

### Why this design exists

- Historical page-by-page growth in a non-framework SPA.
- Direct control over dynamic imports and permission gating.

### Risk

- Route registry can become hard to reason about.
- Easy to introduce inconsistencies in page initialization behavior.

## 6.3 API client stack (`spa/api/*`)

Key patterns include:

- request construction and endpoint composition,
- auth header injection,
- error normalization,
- retry logic,
- optional caching and request deduplication,
- offline write queue delegation.

### Why this design exists

- Centralized API behavior prevents each feature module from reinventing networking concerns.
- Supports resilient UX under intermittent connectivity.

## 6.4 Offline-first subsystem

Main building blocks:

- IndexedDB abstraction,
- offline mutation queue,
- sync engine/outbox/id mapping modules,
- offline status utilities and components.

### Why this design exists

- Field usage patterns (meetings/events) likely include poor network conditions.
- Operational continuity is prioritized over strict online-only consistency.

### Risk

- Conflict resolution and replay edge cases become major QA burden.

## 6.5 UI module model

The SPA has two coexisting patterns:

1. Legacy top-level feature scripts (`spa/*.js`), and
2. New reusable modules (`spa/modules`, `spa/utils`, `spa/components`).

### Why this split exists

- Incremental migration to improve maintainability without freezing product work.

### Risk

- Contributors may choose inconsistent patterns unless explicitly guided.

## 6.6 Security model on web client

- Dedicated `SecurityUtils` and DOM utilities indicate deliberate XSS controls.
- Debug wrappers (`debugLog`, `debugError`) attempt to standardize runtime logs.

### Gaps

- Some legacy/edge code paths still rely on direct patterns needing cleanup.

---

## 7) Mobile deep architecture

## 7.1 Application shell

`mobile/App.js` handles:

- initialization (including i18n),
- root navigation render,
- global loading state,
- error boundary wrapper.

### Why this design exists

- Predictable mobile startup pipeline with fallback UX.

## 7.2 Navigation composition

`RootNavigator` provides:

- auth-state gate (Auth stack vs App stack),
- deep-link support for public and private routes,
- session checks via secure storage utilities.

### Why this design exists

- Deep links enable direct entry flows (permission slips, etc.).
- Auth gating centralizes access policy in one place.

## 7.3 Screen and component scaling

- High screen count indicates broad parity ambition with web features.
- Shared components/utilities reduce repeated styling and behavior.

### Risk

- Maintaining parity across two UI stacks can cause drift without shared specs.

## 7.4 Mobile API layer

`mobile/src/api/api-core.js` mirrors SPA concepts:

- JWT/org/device headers,
- centralized error handling,
- 401 session-expiration handling,
- cache utility integration.

### Why this design exists

- Cross-client consistency lowers backend integration entropy.
- Easier incident response when both clients share behavior assumptions.

### Gap

- Shared behavior is implemented twice (web and mobile), not from a shared package.

---

## 8) Cross-system flows (detailed)

## 8.1 Authentication flow

1. User logs in from SPA or mobile.
2. Backend issues JWT with user/org/permissions context.
3. Client stores token (local storage or secure storage).
4. API client auto-attaches token.
5. Backend middleware validates token and sets `req.user`.
6. Route handler applies role/permission checks and org filtering.

**Why this approach:** stateless auth scaling + simple client integration.

## 8.2 Organization resolution flow

1. If authenticated, org from token is authoritative.
2. Otherwise, header/query/body/domain fallbacks are evaluated.
3. Missing mapping can trigger organization fallback response/page.

**Why this approach:** supports both authenticated app routes and public multi-domain entrypoints.

## 8.3 Offline mutation flow (SPA)

1. User action creates write request.
2. If offline, mutation is queued locally instead of sent.
3. User gets immediate local success/queued feedback.
4. Sync engine replays outbox when online.
5. ID mapping utilities reconcile temporary IDs with server IDs.

**Why this approach:** preserves user productivity despite connectivity gaps.

## 8.4 Realtime flow

1. Client opens socket with JWT.
2. Backend validates token and assigns org room.
3. Events can target org-specific room members.

**Why this approach:** straightforward tenant-safe fanout for operational events.

---

## 9) Coding decisions and rationale (explicit)

## 9.1 Monorepo decision

**Likely decision:** keep backend + web + mobile in one repo.  
**Why:** synchronized feature delivery, shared domain understanding, easier cross-client changes.

## 9.2 Route factory injection

**Likely decision:** pass `pool`/`logger` to route modules.  
**Why:** lower hidden coupling, easier stubbing in tests.

## 9.3 Progressive API versioning

**Likely decision:** migrate to `/api/v1` while retaining legacy mounts.  
**Why:** avoid breaking existing consumers during transition.

## 9.4 Offline-first investment

**Likely decision:** implement queue/outbox sync on web.  
**Why:** operational need in low-connectivity scenarios likely outweighed complexity cost.

## 9.5 Permission migration from roles

**Likely decision:** support both role and permission checks while migrating.  
**Why:** transition without forced immediate refactor of all handlers.

## 9.6 Manual bundle chunking

**Likely decision:** explicit chunk groups in Vite config.  
**Why:** better control over initial load and cache behavior in large SPA.

---

## 10) Irregularities and best-practice gaps (expanded)

## 10.1 API governance / versioning

- Significant legacy `/api/*` surface remains.
- Versioning policy is not yet strongly enforced by reliable CI script.

**Impact:** uncertain migration endpoint for internal and external consumers.

## 10.2 Duplicate route registration

- `/api/ai` appears mounted twice.

**Impact:** maintainability and correctness risk; can produce duplicated middleware execution.

## 10.3 Server bootstrap monolith

- `api.js` (~1400 lines) combines infra, policy, routing, runtime adapters, and lifecycle.

**Impact:** difficult code review, high merge conflict probability, elevated regression risk.

## 10.4 Incomplete modernization boundary on SPA

- Legacy and modular code patterns coexist with no hard “new code must use X” gate.

**Impact:** architecture entropy increases over time.

## 10.5 Logging standard inconsistency

- Project encourages debug wrappers, but direct `console.*` still exists in some critical paths.

**Impact:** mixed observability quality and potential production noise.

## 10.6 Migration process standardization

- SQL migration naming/ordering convention appears partly ad hoc.

**Impact:** deployment reliability and auditability weaken as contributors scale.

## 10.7 Contract testing coverage risk

- Shared response envelope pattern exists but must be validated systematically.

**Impact:** web/mobile regressions when route responses diverge.

## 10.8 Multi-tenant enforcement verification risk

- Multi-tenant model is present, but systematic tenant isolation tests are essential.

**Impact:** potential cross-tenant data leak if any route omits org filter.

---

## 11) Separation of concerns scorecard

| Area | Current state | Maturity | Notes |
|---|---|---:|---|
| API route modularity | Good | 4/5 | Domain route files are well-established. |
| API bootstrap modularity | Weak | 2/5 | `api.js` is monolithic. |
| Auth middleware structure | Good | 4/5 | Centralized middleware exists. |
| API response standardization | Good | 4/5 | Helpers exist; needs broad contract tests. |
| SPA module architecture | Mixed | 3/5 | Modern modules + legacy flat files coexist. |
| SPA offline capabilities | Strong | 4/5 | Outbox/sync architecture is substantial. |
| Mobile architecture organization | Good | 4/5 | Clear screen/component/navigation separation. |
| Cross-client API parity | Good | 4/5 | Similar API client behavior; duplication remains. |
| Tenant isolation assurance | Mixed | 3/5 | Pattern exists; test enforcement should increase. |
| Deployment/migration discipline | Mixed | 3/5 | Functional, but process can be formalized further. |

---

## 12) Target architecture (recommended end-state)

## 12.1 Backend target

- `server/bootstrap/` (security, parsers, cors, rate limits)
- `server/routes/` (typed/declared route registry)
- `server/runtime/` (socket, shutdown hooks, health checks)
- `server/integrations/` (service adapters)
- `server/policies/` (authz, tenant guards)

## 12.2 API governance target

- `/api/v1` mandatory for all active endpoints.
- Legacy `/api` endpoints behind explicit compatibility adapter layer with deprecation date.

## 12.3 SPA target

- New features only in modular architecture folders.
- top-level legacy scripts become compatibility wrappers until retired.

## 12.4 Mobile target

- Maintain parity via shared API behavior specification + snapshot contract suite.

---

## 13) Appendix A — Route registration snapshot

The backend currently mounts both core and legacy-prefixed routes, including mixed prefixes (`/api`, `/api/v1/*`, `/public`, root mounts). This confirms transitional compatibility mode and highlights governance work needed to finish version migration.

Notable examples:

- Root-mounted auth and roles routes.
- Many `/api` domain mounts.
- Newer `/api/v1/*` mounts for attendance, groups, resources, activities, offline, carpools, participants.
- Duplicate `/api/ai` mount.

---

## 14) Appendix B — Inventory snapshot

- Backend routes: **36** files
- Middleware: **3** files
- Services: **7** files
- Backend utils: **10** files
- SPA files: **123**
- Mobile src files: **112**
- Migrations: **12**

This is a large, active product codebase with mature domain scope and a clear need for architecture governance to keep modernization coherent.
