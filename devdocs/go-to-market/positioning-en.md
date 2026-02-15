# Wampums Positioning Document (EN)

## Positioning thesis
Wampums is not "just another app." It is an operational platform connecting **registration/forms**, **health & medication follow-up**, **family finance**, and **field logistics** in one workflow.

Positioning for regional decision-makers:

> **Move from fragmented administration (spreadsheets, messages, disconnected tools) to measurable, traceable youth operations execution.**

---

## 3 measurable promises

## 1) Reduce administrative coordination time
**Promise:** reduce weekly administrative workload by **30%** per local team within 90 days.

**KPIs:**
- Administrative hours per week (before vs after).
- Average processing lead time per participant file (registration + finance + logistics).
- Number of manual follow-up messages sent by staff.

**Measurement approach:**
- 4-week baseline before rollout.
- Monthly measurement per unit/region.
- Target: -30% by month 3.

## 2) Increase on-time completion of critical forms
**Promise:** reach **90%** on-time completion for critical forms (or +20 points vs baseline within one cycle).

**KPIs:**
- Completion rate for critical forms.
- Median submission delay.
- % of incomplete files at T-7 before an activity.

**Measurement approach:**
- Baseline from previous cycle.
- Measurement by form type and by activity.
- Target: 90% on-time completion.

## 3) Decrease preventable health follow-up incidents
**Promise:** reduce missed/untracked medication doses by **50%** over two quarters.

**KPIs:**
- `missed` doses rate / scheduled doses.
- % of doses without explicit status (`given`, `missed`, `cancelled`).
- Number of health incidents linked to incomplete follow-up.

**Measurement approach:**
- Quarterly baseline.
- Weekly tracking during camps/activities.
- Target: -50% missed or untracked doses.

---

## Promise-to-module mapping (existing code)

| Promise | Backend modules (`routes/*.js`) | SPA modules (`spa/*`) | Operational value |
|---|---|---|---|
| Admin time reduction | `routes/forms.js`, `routes/finance.js`, `routes/carpools.js` | `spa/form_permissions.js`, `spa/finance.js`, `spa/carpool_dashboard.js` | Centralizes recurring work (submissions, payment tracking, carpool assignment) with actionable status data. |
| Higher form completion rate | `routes/forms.js` | `spa/formulaire_inscription.js`, `spa/form_permissions.js`, `spa/formBuilder.js` | Structures forms, permissions, and standardized submission flow to reduce incomplete files. |
| Fewer health follow-up incidents | `routes/medication.js`, `routes/forms.js` (health forms) | `spa/medication_management.js`, `spa/fiche_sante.js`, `spa/medication_reception.js` | Plans, records, and updates medication events with auditable statuses and operational alerts. |

### Detailed alignment by promise

#### Promise 1 — Admin time
- **Forms:** creation/submission/approval workflows and status filtering in `routes/forms.js`.
- **Finance:** fee definitions and participant fee generation in `routes/finance.js`, operated via `spa/finance.js`.
- **Carpools:** offers + assignments + seat capacity in `routes/carpools.js`, coordinated through `spa/carpool_dashboard.js`.

#### Promise 2 — Form completion
- `routes/forms.js` supports lifecycle states (draft/submitted/approved depending on form type).
- `spa/form_permissions.js` controls who can view/submit/edit/approve.
- `spa/formulaire_inscription.js` + `spa/formBuilder.js` support structured field data capture.

#### Promise 3 — Health follow-up
- `routes/medication.js` covers requirements, dose scheduling, and status updates (`scheduled`, `given`, `missed`, `cancelled`).
- `spa/medication_management.js` provides mobile-first execution with offline cache, alerts, and dispensing flow.
- Health form data (`fiche_sante`) feeds medication preparation and follow-up.

---

## Demo-ready “Before / After Wampums” table

| Dimension | Before (fragmented tools) | After Wampums |
|---|---|---|
| Coordination time | Manual reminders, duplicate data entry, low visibility. | Unified flows, normalized statuses, real-time module tracking. |
| Form file quality | Missing data discovered too late. | Status-driven tracking and role-based permissions improve completion. |
| Medication follow-up | Dispersed notes and incomplete traceability. | One flow for planning + dispensing + timestamped status updates. |
| Fees and collections | Manual consolidation, reconciliation risk. | Defined fees, participant-level balances and payment tracking. |
| Transportation logistics | Messaging-based coordination, uncertain seat capacity. | Offer, availability, and assignment visibility in one dashboard. |
| Regional oversight | Non-standard metrics across units. | Shared KPI model (admin time, completion, prevented incidents). |

---

## 1-page version — “Why change if we already have an app?”

## Core message (regional leadership)
Having an app is not the goal. The goal is reliable execution of critical operations with trustworthy data and comparable KPIs across units.

## What usually fails with a "generic app"
- Data remains siloed (forms, health, finance, transport not connected).
- Teams still rely on messages, spreadsheets, and manual reminders.
- Operational risks stay high (incomplete files, medication follow-up gaps, weak regional visibility).

## What changes with Wampums
- **End-to-end chain:** registration → permissions/forms → health follow-up → finance → logistics.
- **Actionable traceability:** each step produces measurable status data.
- **Regional view:** one KPI model across all units to prioritize action.

## 90-day pilot outcomes to target
- -30% weekly admin time.
- 90% on-time completion for critical forms.
- -50% missed/untracked doses in activity contexts.

## Recommended implementation plan
1. Pilot in 2-3 units (6 to 8 weeks).
2. Define baseline + KPI targets before launch.
3. Run monthly performance reviews.
4. Expand region-wide with standardized operating practices.

## Decision required
Do not replace one app with another. **Adopt a regional execution system** focused on measurable outcomes, safety, and consistency.
