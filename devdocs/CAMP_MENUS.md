# Camp menus and cooks

Issue #1260 (menus and grocery list), part of the camp plan (#1316). The camp permit asks for a
**detailed menu and snacks**. Units already keep, in a Word document, the cooks' contacts, a grid
of who cooks which meal through the week, and the menu of every meal in large print so it can be
read at a glance in the kitchen.

This page says how to record that in Wampums **today**, with what already exists, what the starter
menu is, and what #1260 will add. No menu screen exists yet.

## Recording it today

### 1. The cooks and their schedule: volunteer shifts

The grid "cook × meal" is a set of **volunteer shifts of type _cook_**, one per meal, on the camp's
activity (`/volunteers`, `volunteers.manage` to create shifts; see `devdocs/VOLUNTEERS.md`).

| In the document | In Wampums |
|---|---|
| A meal column (e.g. Sunday, supper) | A shift: type *Cook*, title *Souper*, the meal's date, a start and end time (suggested times are in `config/camp_menu_starter.json` `COOK_SHIFT_TIMES`) |
| How many cooks a meal needs | The shift's number of places |
| A cook's green cells | That person taking a place on each of those shifts |
| A cook who comes for half the week | Places taken only on that half's shifts |

- **Each cook needs an account in the unit.** The built-in *Volunteer* role gives the volunteer screen
  and their tasks, and no youth, family or health record. Invite them from `/invitations` with that
  role.
- **Every cook needs a background check** (valid three years). A place stays *to verify* until a
  manager records it on `/volunteers` › *Background checks*.
- **Who sees whom:** managers see every cook's name on each shift; a cook sees the shifts and their
  own place, not the other cooks' names.
- **Contacts:** Wampums keeps each cook's email with their account. It keeps **no phone number**, and
  shows managers names only. Until #1260 adds a contact sheet, keep phone numbers where the unit
  already does, and never in a shift's notes: those are shown to every volunteer.

### 2. The menu of each meal: the cook shift's notes

Write the meal's menu in its cook shift's **notes** (up to 1,000 characters), so the cooks find it
with their shift, on their phone:

```
Menu : Spaghetti sauce à la viande · Pain et beurre à l’ail · Salade romaine et vinaigrette · Brownies
Collation : Biscuits · Lait et eau
```

Put a snack on the shift of the meal before it (afternoon snack with lunch, evening snack with
supper), and quantities beside the item ("Patates rissolées — environ 20 lb pour le groupe").

The camp schedule can also carry a line per meal (*Souper*, at its time, with the cooks' names as
*responsible*), so meals appear in the day's programme. Don't repeat the whole menu there: one place
to correct is enough.

### Limits until #1260

- No large-print view to post in the kitchen or read at a glance: the volunteer screen shows the
  menu as ordinary text.
- No allergen check against the camp's allergy list (#1319); the team still compares by hand.
- No quantities scaled to the number of people, and no grocery list.
- The camp plan (#1320) cannot print the menu yet: attach the document as before.

## The starter menu

`config/camp_menu_starter.json` holds a **reviewed, bilingual week** of camp meals (7 nights,
summer, arrival for supper, departure after lunch), drawn from a real unit's menu with everything
personal removed: no names, contacts or brands, and **no allergen claims**. Allergens depend on the
products each unit buys, and must be declared by the unit (#1260).

- **Shape:** `templates[]` → `meals[]` with `day_offset` (0 is arrival day), `meal` (`breakfast`,
  `lunch`, `supper`, `snack`), an optional `context` (`afternoon`, `hike`) and `items[]` with
  `label_fr`, `label_en` and optional `note_fr`/`note_en` (quantities, serving hints).
- **Checked by** `test/camp-menu-starter.test.js`: both languages, meals inside the camp's nights
  and in day order, no email, phone number or brand name.
- **Demo:** `seed.mjs` (the `run-wampums` skill) gives the fictional unit's winter camp one cook
  shift per meal, with the first days of this menu in their notes, built as described above.
- **Live units:** nothing is copied into a unit until #1260 exists. The menu screen will offer this
  file the way the planner offers starter activities: a unit chooses to start from it, then edits
  its own copy. Corrections to the file reach only units that have not yet started from it.

## What #1260 will add

See the issue for the full scope. In short:
- A menu per meal, attached to the camp's meal shifts.
- A large-print kitchen view: one meal per screen or page, readable from a distance, offline during
  the camp.
- Cooks' contacts for the camp lead, with each cook's consent.
- Declared allergens checked against the camp's allergy list.
- Quantities and a grocery list.
- The menu in the camp plan.
