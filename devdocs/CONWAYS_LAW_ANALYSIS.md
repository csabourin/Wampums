# Conway's Law Analysis — Wampums Codebase

**Date:** 2026-02-13
**Context:** Architectural analysis of the Wampums Scout Management System through the lens of Conway's Law.

> *"Any organization that designs a system will produce a design whose structure is a copy of the organization's communication structure."* — Melvin Conway, 1967

---

## Key Findings

### 1. Small, Full-Stack Team (Likely 1-3 People)

The most striking signal is the **monorepo with no service boundaries**. Backend, frontend SPA, and mobile app all live in one repository, built from a single `package.json`, and the API runs in a single Express process (`api.js`). There are no microservices, no API gateways, no separate deployment pipelines per component.

Conway's Law predicts this: microservices emerge when teams *can't* easily communicate and need independent deployment cycles. A monolith like this reflects a small team where everyone can talk to everyone, and the same person who writes the route file also writes the corresponding frontend module.

### 2. Feature Boundaries Over Layer Boundaries

The 38 route files map nearly 1:1 to the 50+ SPA page modules — each feature is a vertical slice:

```
Feature: Carpools
  Backend:   routes/carpools.js
  Frontend:  spa/carpool_dashboard.js
  API:       spa/api/api-carpools.js
  Styles:    css/carpool.css
```

This is what Conway's Law looks like when one person or a tight pair owns a feature end-to-end. If separate backend and frontend teams existed, you'd expect thicker API contracts, separate repos, and divergent organizational structures.

### 3. The Thin "Services" Layer

`services/` is almost entirely **external integrations** (WhatsApp, Google Chat, Mindee, OpenAI, Stripe), not internal business logic decomposition. Business logic lives directly in route handlers. This means there's been no organizational pressure to separate business rules ownership from HTTP layer ownership.

### 4. Web-to-Mobile Code Mirroring

The mobile app (`mobile/src/`) mirrors the web SPA's structure:

| Web | Mobile |
|-----|--------|
| `spa/api/api-core.js` | `mobile/src/api/api-core.js` |
| `spa/utils/DebugUtils.js` | `mobile/src/utils/DebugUtils.js` |
| `spa/utils/SecurityUtils.js` | `mobile/src/utils/SecurityUtils.js` |
| `spa/utils/DateUtils.js` | `mobile/src/utils/DateUtils.js` |

The existence of `devdocs/spa-to-mobile-porting-status.md` confirms a **porting effort, not parallel development**. If a separate mobile team existed, you'd see divergent abstractions, different naming conventions, and a shared package — not copy-paste mirroring.

### 5. Governance Through Documentation & Tooling, Not Process

`CLAUDE.md`, `scripts/modernization/` linting checks, and `.github/copilot-instructions.md` encode organizational norms into artifacts because there isn't a large team with formal review specialists. The automated checks enforce API versioning, SQL parameterization, and logging conventions — work that a larger org would distribute across specialized reviewers.

### 6. Bilingual-First = Canadian Scouting Context

French as the default language, bilingual architecture baked into middleware and the translation table, and the project name "Wampums" place this in a **bilingual Canadian scouting** context. This isn't an afterthought — it's a first-class organizational requirement directly encoded in architecture.

### 7. Multi-Tenant = Platform Serving Many Groups

Pervasive `organization_id` filtering on every query reflects an organization that serves multiple scout groups from a single deployment. The data isolation architecture directly mirrors the business model.

### 8. Offline-First = Users in the Field

The 5-phase sync engine, outbox manager, ID mapper, and camp mode with 15-day retention reflect end users who operate where connectivity is unreliable. The communication structure between the app and its users includes long disconnection periods — and the architecture encodes this reality.

---

## Summary Table

| Architectural Signal | Implied Organization |
|---|---|
| Monorepo, single process | Small team, high-bandwidth communication |
| Feature-slice organization | Full-stack ownership per developer |
| No internal service layer | No need for inter-team contracts |
| Web-to-mobile code mirroring | Same developer(s) built both |
| Automated linting as governance | Too few people for formal review |
| Bilingual by default | Canadian bilingual context |
| Multi-tenant data isolation | One team serving many scout groups |
| Offline-first architecture | Users disconnect for extended periods |

---

## Scaling Implications (Inverse Conway Maneuver)

If the team were to grow, Conway's Law predicts the architecture would need to evolve:

- **Adding a mobile team** → Push toward a shared utility package (npm workspace or monorepo tooling) instead of mirrored code.
- **Adding a platform/infra team** → Push business logic out of route handlers into a proper service layer with defined interfaces.
- **Adding a QA team** → Push toward more comprehensive test infrastructure (currently ~12 test files for a large codebase).
- **Adding a data team** → Push toward a dedicated data access layer rather than inline SQL in route handlers.

The current architecture is well-suited for its current organizational reality. Restructuring it ahead of team growth would be premature — but recognizing these pressure points helps plan for when that growth happens.
