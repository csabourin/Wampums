# API Endpoint Usage Audit (Frontend vs Backend)

Generated: 2026-02-12

## Method
- Parsed backend endpoints from `routes/*.js` (`router.METHOD(...)`) and `api.js` (`app.METHOD(...)`), then expanded route mount prefixes from `api.js` `app.use(...)`.
- Parsed frontend/mobile usage from string literals (`"/api..."`) and `makeApiRequest("v1/..."|"/api...")` in `spa/**/*.js` and `mobile/src/**/*.js`.
- Marked endpoint as **used** if any frontend path exactly matches or matches parameterized template (`{}` wildcard).
- Endpoints listed as unused are **statically unreferenced candidates**; dynamic URL composition or external consumers may still use them.

## Summary
- Backend candidate endpoints analyzed: **336**
- Frontend/mobile unique referenced API paths: **50**
- Statically unreferenced backend endpoint candidates: **283**
- Frontend/mobile paths with no backend match (possible stale calls): **6**

## Unused backend endpoint candidates by route module

### `api.js` (1)
| Method | Endpoint |
|---|---|
| GET | `/api-docs.json` |

### `routes/activities.js` (5)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/activities/upcoming-camps` |
| DELETE | `/api/v1/activities/{}` |
| GET | `/api/v1/activities/{}` |
| PUT | `/api/v1/activities/{}` |
| GET | `/api/v1/activities/{}/participants` |

### `routes/ai.js` (3)
| Method | Endpoint |
|---|---|
| GET | `/api/ai/budget` |
| POST | `/api/ai/receipt` |
| POST | `/api/ai/text` |

### `routes/announcements.js` (2)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/announcements` |
| POST | `/api/v1/announcements` |

### `routes/attendance.js` (11)
| Method | Endpoint |
|---|---|
| GET | `/api/attendance` |
| POST | `/api/attendance` |
| GET | `/api/attendance/attendance` |
| GET | `/api/attendance/attendance-dates` |
| POST | `/api/attendance/carry-forward` |
| GET | `/api/attendance/dates` |
| POST | `/api/attendance/update-attendance` |
| GET | `/api/v1/attendance/attendance` |
| GET | `/api/v1/attendance/attendance-dates` |
| POST | `/api/v1/attendance/carry-forward` |
| POST | `/api/v1/attendance/update-attendance` |

### `routes/auth.js` (3)
| Method | Endpoint |
|---|---|
| POST | `/public/login` |
| POST | `/public/register` |
| POST | `/public/verify-2fa` |

### `routes/badges.js` (2)
| Method | Endpoint |
|---|---|
| GET | `/api/badge-history` |
| PUT | `/api/badge-progress/{}` |

### `routes/budgets.js` (25)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/budget/categories` |
| POST | `/api/v1/budget/categories` |
| DELETE | `/api/v1/budget/categories/{}` |
| PUT | `/api/v1/budget/categories/{}` |
| GET | `/api/v1/budget/expenses` |
| POST | `/api/v1/budget/expenses` |
| DELETE | `/api/v1/budget/expenses/{}` |
| PUT | `/api/v1/budget/expenses/{}` |
| GET | `/api/v1/budget/items` |
| POST | `/api/v1/budget/items` |
| DELETE | `/api/v1/budget/items/{}` |
| PUT | `/api/v1/budget/items/{}` |
| GET | `/api/v1/budget/plans` |
| POST | `/api/v1/budget/plans` |
| DELETE | `/api/v1/budget/plans/{}` |
| PUT | `/api/v1/budget/plans/{}` |
| GET | `/api/v1/budget/reports/revenue-breakdown` |
| GET | `/api/v1/budget/reports/summary` |
| POST | `/api/v1/expenses/bulk` |
| GET | `/api/v1/expenses/monthly` |
| GET | `/api/v1/expenses/summary` |
| GET | `/api/v1/revenue/by-category` |
| GET | `/api/v1/revenue/by-source` |
| GET | `/api/v1/revenue/comparison` |
| GET | `/api/v1/revenue/dashboard` |

### `routes/calendars.js` (4)
| Method | Endpoint |
|---|---|
| GET | `/api/calendars` |
| PUT | `/api/calendars/{}` |
| PUT | `/api/calendars/{}/payment` |
| GET | `/api/participant-calendar` |

### `routes/carpools.js` (9)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/carpools/activity/{}` |
| GET | `/api/v1/carpools/activity/{}/unassigned` |
| POST | `/api/v1/carpools/assignments` |
| DELETE | `/api/v1/carpools/assignments/{}` |
| GET | `/api/v1/carpools/my-children-assignments` |
| GET | `/api/v1/carpools/my-offers` |
| POST | `/api/v1/carpools/offers` |
| DELETE | `/api/v1/carpools/offers/{}` |
| PUT | `/api/v1/carpools/offers/{}` |

### `routes/dashboards.js` (1)
| Method | Endpoint |
|---|---|
| GET | `/api/parent-dashboard` |

### `routes/external-revenue.js` (5)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/revenue/external` |
| POST | `/api/v1/revenue/external` |
| GET | `/api/v1/revenue/external/summary` |
| DELETE | `/api/v1/revenue/external/{}` |
| PUT | `/api/v1/revenue/external/{}` |

### `routes/finance.js` (16)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/finance/fee-definitions` |
| POST | `/api/v1/finance/fee-definitions` |
| DELETE | `/api/v1/finance/fee-definitions/{}` |
| PUT | `/api/v1/finance/fee-definitions/{}` |
| GET | `/api/v1/finance/participant-fees` |
| POST | `/api/v1/finance/participant-fees` |
| PUT | `/api/v1/finance/participant-fees/{}` |
| GET | `/api/v1/finance/participant-fees/{}/payment-plans` |
| POST | `/api/v1/finance/participant-fees/{}/payment-plans` |
| GET | `/api/v1/finance/participant-fees/{}/payments` |
| POST | `/api/v1/finance/participant-fees/{}/payments` |
| GET | `/api/v1/finance/participants/{}/statement` |
| DELETE | `/api/v1/finance/payment-plans/{}` |
| PUT | `/api/v1/finance/payment-plans/{}` |
| PUT | `/api/v1/finance/payments/{}` |
| GET | `/api/v1/finance/reports/summary` |

### `routes/formBuilder.js` (12)
| Method | Endpoint |
|---|---|
| GET | `/api/form-formats` |
| POST | `/api/form-formats` |
| DELETE | `/api/form-formats/{}` |
| GET | `/api/form-formats/{}` |
| PUT | `/api/form-formats/{}` |
| POST | `/api/form-formats/{}/archive` |
| GET | `/api/form-formats/{}/versions` |
| POST | `/api/form-formats/{}/versions` |
| POST | `/api/form-formats/{}/{}/copy` |
| POST | `/api/form-versions/{}/publish` |
| GET | `/api/translations/keys` |
| GET | `/api/user-organizations` |

### `routes/forms.js` (16)
| Method | Endpoint |
|---|---|
| PUT | `/api/form-display-context` |
| GET | `/api/form-permissions` |
| PUT | `/api/form-permissions` |
| GET | `/api/form-structure` |
| GET | `/api/form-submission` |
| GET | `/api/form-submission-history/{}` |
| PUT | `/api/form-submission-status` |
| GET | `/api/form-submissions` |
| GET | `/api/form-submissions-list` |
| GET | `/api/form-types` |
| GET | `/api/form-versions/{}` |
| POST | `/api/health-forms` |
| GET | `/api/organization-form-formats` |
| GET | `/api/risk-acceptance` |
| POST | `/api/risk-acceptance` |
| POST | `/api/save-form-submission` |

### `routes/fundraisers.js` (5)
| Method | Endpoint |
|---|---|
| GET | `/api/fundraisers` |
| POST | `/api/fundraisers` |
| GET | `/api/fundraisers/{}` |
| PUT | `/api/fundraisers/{}` |
| PUT | `/api/fundraisers/{}/archive` |

### `routes/google-chat.js` (7)
| Method | Endpoint |
|---|---|
| POST | `/api/google-chat/broadcast` |
| GET | `/api/google-chat/config` |
| POST | `/api/google-chat/config` |
| GET | `/api/google-chat/messages` |
| POST | `/api/google-chat/send-message` |
| GET | `/api/google-chat/spaces` |
| POST | `/api/google-chat/spaces` |

### `routes/groups.js` (6)
| Method | Endpoint |
|---|---|
| POST | `/api/v1/groups/groups` |
| DELETE | `/api/v1/groups/groups/{}` |
| PUT | `/api/v1/groups/groups/{}` |
| DELETE | `/api/v1/groups/{}` |
| GET | `/api/v1/groups/{}` |
| PUT | `/api/v1/groups/{}` |

### `routes/guardians.js` (3)
| Method | Endpoint |
|---|---|
| GET | `/api/guardians` |
| DELETE | `/api/remove-guardian` |
| POST | `/api/save-guardian` |

### `routes/honors.js` (8)
| Method | Endpoint |
|---|---|
| GET | `/api/honors-history` |
| GET | `/api/honors-report` |
| GET | `/api/recent-honors` |
| GET | `/api/v1/honors` |
| POST | `/api/v1/honors` |
| GET | `/api/v1/honors/history` |
| DELETE | `/api/v1/honors/{}` |
| PATCH | `/api/v1/honors/{}` |

### `routes/import.js` (1)
| Method | Endpoint |
|---|---|
| POST | `/api/import-sisc` |

### `routes/localGroups.js` (4)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/local-groups` |
| GET | `/api/v1/local-groups/memberships` |
| POST | `/api/v1/local-groups/memberships` |
| DELETE | `/api/v1/local-groups/memberships/{}` |

### `routes/medication.js` (12)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/medication/distributions` |
| POST | `/api/v1/medication/distributions` |
| PATCH | `/api/v1/medication/distributions/{}` |
| GET | `/api/v1/medication/fiche-medications` |
| GET | `/api/v1/medication/participant-medications` |
| GET | `/api/v1/medication/receptions` |
| POST | `/api/v1/medication/receptions` |
| DELETE | `/api/v1/medication/receptions/{}` |
| PATCH | `/api/v1/medication/receptions/{}` |
| GET | `/api/v1/medication/requirements` |
| POST | `/api/v1/medication/requirements` |
| PUT | `/api/v1/medication/requirements/{}` |

### `routes/meetings.js` (11)
| Method | Endpoint |
|---|---|
| GET | `/api/activites-rencontre` |
| GET | `/api/activity-templates` |
| GET | `/api/get_reminder` |
| GET | `/api/guests-by-date` |
| GET | `/api/next-meeting-info` |
| GET | `/api/reminder` |
| GET | `/api/reunion-dates` |
| POST | `/api/save-guest` |
| POST | `/api/save-reunion-preparation` |
| POST | `/api/save_reminder` |
| GET | `/api/unprocessed-achievements` |

### `routes/notifications.js` (2)
| Method | Endpoint |
|---|---|
| GET | `/api/push-subscribers` |
| POST | `/api/send-notification` |

### `routes/offline.js` (2)
| Method | Endpoint |
|---|---|
| POST | `/api/v1/offline/prepare-activity` |
| GET | `/api/v1/offline/status` |

### `routes/organizations.js` (12)
| Method | Endpoint |
|---|---|
| GET | `/api/get_organization_id` |
| PATCH | `/api/organization-settings/default-email-language` |
| POST | `/api/organizations` |
| POST | `/api/register-for-organization` |
| POST | `/api/switch-organization` |
| GET | `/public/get_organization_id` |
| GET | `/public/organization-jwt` |
| GET | `/public/organization-settings` |
| PATCH | `/public/organization-settings/default-email-language` |
| POST | `/public/organizations` |
| POST | `/public/register-for-organization` |
| POST | `/public/switch-organization` |

### `routes/participants.js` (32)
| Method | Endpoint |
|---|---|
| GET | `/api` |
| POST | `/api` |
| POST | `/api/associate-user-participant` |
| POST | `/api/link-parent-participant` |
| POST | `/api/link-participant-to-organization` |
| POST | `/api/link-user-participants` |
| GET | `/api/participant-ages` |
| GET | `/api/participant-calendar` |
| DELETE | `/api/participant-groups/{}` |
| GET | `/api/participants` |
| GET | `/api/participants-with-documents` |
| GET | `/api/participants-with-users` |
| POST | `/api/save-participant` |
| POST | `/api/update-participant-group` |
| POST | `/api/v1/participants/associate-user-participant` |
| POST | `/api/v1/participants/link-parent-participant` |
| POST | `/api/v1/participants/link-participant-to-organization` |
| POST | `/api/v1/participants/link-user-participants` |
| GET | `/api/v1/participants/participant-ages` |
| GET | `/api/v1/participants/participant-calendar` |
| GET | `/api/v1/participants/participant-details` |
| DELETE | `/api/v1/participants/participant-groups/{}` |
| GET | `/api/v1/participants/participants` |
| GET | `/api/v1/participants/participants-with-documents` |
| GET | `/api/v1/participants/participants-with-users` |
| POST | `/api/v1/participants/save-participant` |
| POST | `/api/v1/participants/update-participant-group` |
| DELETE | `/api/v1/participants/{}` |
| GET | `/api/v1/participants/{}` |
| PUT | `/api/v1/participants/{}` |
| PATCH | `/api/v1/participants/{}/group-membership` |
| PATCH | `/api/{}/group-membership` |

### `routes/points.js` (2)
| Method | Endpoint |
|---|---|
| GET | `/api/points-leaderboard` |
| GET | `/api/points-report` |

### `routes/public.js` (1)
| Method | Endpoint |
|---|---|
| POST | `/api/contact-demo` |

### `routes/reports.js` (13)
| Method | Endpoint |
|---|---|
| GET | `/api/allergies-report` |
| GET | `/api/attendance-report` |
| GET | `/api/health-contact-report` |
| GET | `/api/health-report` |
| GET | `/api/honors-report` |
| GET | `/api/leave-alone-report` |
| GET | `/api/media-authorization-report` |
| GET | `/api/medication-report` |
| GET | `/api/missing-documents-report` |
| GET | `/api/participant-progress` |
| GET | `/api/points-report` |
| GET | `/api/time-since-registration-report` |
| GET | `/api/vaccine-report` |

### `routes/resources.js` (21)
| Method | Endpoint |
|---|---|
| GET | `/api/v1/resources/equipment` |
| POST | `/api/v1/resources/equipment` |
| GET | `/api/v1/resources/equipment/reservations` |
| POST | `/api/v1/resources/equipment/reservations` |
| POST | `/api/v1/resources/equipment/reservations/bulk` |
| PATCH | `/api/v1/resources/equipment/reservations/{}` |
| DELETE | `/api/v1/resources/equipment/{}` |
| PUT | `/api/v1/resources/equipment/{}` |
| DELETE | `/api/v1/resources/equipment/{}/photo` |
| POST | `/api/v1/resources/equipment/{}/photo` |
| GET | `/api/v1/resources/permission-slips` |
| POST | `/api/v1/resources/permission-slips` |
| PATCH | `/api/v1/resources/permission-slips/s/{}` |
| POST | `/api/v1/resources/permission-slips/send-emails` |
| POST | `/api/v1/resources/permission-slips/send-reminders` |
| GET | `/api/v1/resources/permission-slips/v/{}` |
| DELETE | `/api/v1/resources/permission-slips/{}` |
| PATCH | `/api/v1/resources/permission-slips/{}/archive` |
| PATCH | `/api/v1/resources/permission-slips/{}/sign` |
| GET | `/api/v1/resources/permission-slips/{}/view` |
| GET | `/api/v1/resources/status/dashboard` |

### `routes/roles.js` (9)
| Method | Endpoint |
|---|---|
| GET | `/api/permissions` |
| GET | `/api/roles` |
| POST | `/api/roles` |
| DELETE | `/api/roles/{}` |
| GET | `/api/roles/{}/permissions` |
| POST | `/api/roles/{}/permissions` |
| DELETE | `/api/roles/{}/permissions/{}` |
| GET | `/api/users/{}/roles` |
| PUT | `/api/users/{}/roles` |

### `routes/stripe.js` (3)
| Method | Endpoint |
|---|---|
| POST | `/api/v1/stripe/create-payment-intent` |
| GET | `/api/v1/stripe/payment-status/{}` |
| POST | `/api/v1/stripe/webhook` |

### `routes/userProfile.js` (2)
| Method | Endpoint |
|---|---|
| PATCH | `/api/v1/users/me/language-preference` |
| PATCH | `/api/v1/users/me/whatsapp-phone` |

### `routes/users.js` (12)
| Method | Endpoint |
|---|---|
| GET | `/api/animateurs` |
| POST | `/api/approve-user` |
| POST | `/api/associate-user-participant` |
| POST | `/api/link-user-participants` |
| GET | `/api/parent-users` |
| GET | `/api/pending-users` |
| POST | `/api/permissions/check` |
| POST | `/api/update-user-role` |
| GET | `/api/user-children` |
| GET | `/api/users` |
| GET | `/api/v1/users/{}/roles` |
| PUT | `/api/v1/users/{}/roles` |

## Frontend/mobile referenced paths with no backend match

| Path |
|---|
| `/api/ai` |
| `/api/attendance-dates` |
| `/api/v1/badges/settings` |
| `/api/v1/badges/summary` |
| `/api/v1/health/report` |
| `/api/v1/push-subscription` |
