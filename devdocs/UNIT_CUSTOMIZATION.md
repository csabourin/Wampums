# Unit customization

Unit customization keeps program vocabulary and dashboard policy separate from
roles and permissions. Roles determine what a user may do; the dashboard
configuration determines which supported functions the unit chooses to use.

## Storage

Both settings use the existing tenant-scoped `organization_settings` table:

- `unit_vocabulary` stores `version`, `profile`, and complete `en`/`fr` locale
  dictionaries.
- `dashboard_configuration` stores `hidden_tile_keys`. Feature keys are stable
  semantic identifiers defined in `config/unit_customization.json` rather than
  page URLs or translated labels.

The organization's `program_section` is updated when a built-in vocabulary
profile is selected. This lets new groups and meeting preparation use the same
section defaults. A custom profile retains the current program section.

Organizations that have never saved vocabulary keep the historical Cubs
experience. Saving the generic profile makes the neutral vocabulary explicit.
For the same compatibility reason, an explicit legacy
`organization_info.meeting_section` takes precedence over the database's
unsaved `program_section` default. Once vocabulary is saved, its synchronized
program section becomes authoritative.

## API

Authenticated users with `org.edit` can update the settings through:

- `PATCH /api/v1/organizations/settings/vocabulary`
- `PATCH /api/v1/organizations/settings/dashboard`

Protected writes also block demo roles. The server validates every supported
term and dashboard feature key before performing tenant-scoped upserts. The
`account_info` feature is required and cannot be hidden.

## User interface

Unit Settings has General, Vocabulary, and Dashboard tabs. Vocabulary provides
Cubs, Beavers, Generic, and fully custom profiles with separate English and
French values. Dashboard switches hide functions on both web and mobile without
changing permissions. Unit Settings itself remains reachable, so a unit cannot
hide its way out of configuration.

Mobile loads organization customization in the authenticated root navigator
before choosing a leader or parent dashboard. Logout and organization changes
clear the process-wide vocabulary first, preventing terminology from one unit
from leaking into another unit's session.

The General tab also links authorized form managers to `/form-builder`; forms
remain governed by the existing form-management permissions.

## Adding vocabulary-aware text

Keep user-facing sentence structure in `lang/en.json` and `lang/fr.json`. Add a
template key there, map the legacy translation key in
`spa/utils/UnitVocabularyUtils.js`, and use placeholders named after terms in
`config/unit_customization.json`. Mirror mobile-visible templates in
`mobile/assets/lang/en.json` and `mobile/assets/lang/fr.json` and map them in the
mobile vocabulary utility.

Do not use a vocabulary value as a translation key. Vocabulary values are
organization data and are interpolated into translated sentences only after
server validation.
