# Creating a unit

`POST /api/v1/organizations` (`org.create`, district-only) takes the unit's information, its branch
(`program_section`), its subdomain and its administrator's email. In one transaction it records the
domain in `organization_domains` (unique without case, migration 056; rules in
`config/unit_subdomains.json`, read by the server and the SPA), sets the branch before installing
starter activities, makes the creator a district member, and creates a pending invitation into the
unit's `unitadmin` role (`resolveUnitRoleId`, `checkRolesGrantable`). The email goes after COMMIT; a
failed send leaves the invitation to resend. `/units` (`org.create`) lists the person's units and
switches with `POST /api/v1/organizations/switch`, which requires an active membership.

A unit's branch and addresses are changed under Unit settings › General. `PATCH
/api/v1/organizations/settings/branch` (`org.edit`) sets the branch; its vocabulary follows unless
the unit wrote its own (`custom`). Saving the vocabulary sets the branch only while it is still
`general`. A branch without terms or a meeting layout of its own (scouts, pioneers, rovers) uses the
generic ones, ahead of a stale legacy meeting section once vocabulary is saved; an unknown branch
still falls back to its legacy section. OVH routes the unit base domain's wildcard to the app
(`deploy/ovh/README.md`); wildcard DNS and TLS must be configured before using new addresses.
`middleware/unit-host.js` redirects unassigned unit subdomains to the fixed public home URL before
static files and routes, using exact case-insensitive domain assignments (no header or wildcard
fallback). Its 302 is not cached, drops path/query, and reflects address changes immediately;
database failures stay errors. Apex/`www`, local development and other domain suffixes keep their
existing routing.
The storage hostname is reserved for infrastructure, including the OVH `STORAGE_DOMAIN` override.
Saving vocabulary synchronizes both the app and the branch selector with the returned branch.
Addresses are listed with `org.view`; adding one, choosing the
primary one (`organization_domains.is_primary`, migration 057, used by `resolveOrganizationBaseUrl`)
and removing one take `org.create`. A unit keeps its primary and at least one exact address. Adding
an address never replaces one, so links already sent keep working.
