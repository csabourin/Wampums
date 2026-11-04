# Equipment catalogue and unit material

`/equipment-catalog` (`equipment_catalog.manage`, migrations 054 and 055) names a unit's articles once:
name, category (`config/equipment_categories.json`), unit of measure (`config/equipment_units.json`)
and, optionally, an inventory item the unit may use (`services/equipmentAccess.js`). Articles are
archived, never deleted; one active name per unit.

A schedule line (`year_plan_meeting_activities`: a regular meeting's activity or a camp line) lists
the unit's material with quantities in `meeting_activity_equipment`, beside its free-text
`material`, which stays as it was. Each entry names a catalogue article of the unit or an inventory
item it has or may borrow, never both. `GET /api/v1/equipment-catalog/options` (`meetings.manage`
or `equipment_catalog.manage`) lists the choices: active articles, then accessible inventory that no
active article stands for, by name and category only. Meeting preparation and the planner's line
routes accept and return `material_items` (`services/equipmentCatalog.js`): sent, it replaces the
line's list in the line's transaction; omitted, the list is kept. Something archived or no longer
shared stays on a line that lists it but cannot be added; copying a camp schedule copies only what
is still active. Composite foreign keys keep a line and its articles in the same unit.

The AI meeting plan and outing plan choose material only from that list: `routes/ai.js` reads it
for the unit of the token (a client cannot supply it) and sends names and categories with short
references (`a3`, `e7`); the answer keeps only references it was offered and never free-text
material. A unit with no catalogue and no inventory keeps the free-text answer. Catalogue writes
need a connection.

A camp's collective material list (`/camp-material/:id`, from the camp schedule;
`GET /api/v1/yearly-planner/meetings/:id/material-list`, `meetings.view`) is built by
`services/campMaterialList.js`: each article once, its quantity the sum of every line naming it; an
inventory item listed directly joins the article that stands for it. Free-text material is listed
apart, line by line, never added up. With `inventory.view` only, each inventory entry is compared over
the camp's dates as a reservation of those dates is counted: reserved for this camp (by its meeting or
its outing, covering all its days), still free (loans included), missing, or no longer accessible; reservations for the camp
that no line lists are returned too. Print and CSV export carry the same content. Two articles standing for one item are compared with their combined need. Each inventory
entry carries `to_reserve` (whole units the camp still lacks, at most what is free); "Reserve what is
missing" sends exactly those to `POST /api/v1/resources/equipment/reservations/camps/:meetingId`
(`meetings.view`, `inventory.view`, `inventory.reserve`; online only). The server locks the items,
recounts, and refuses with 409 `camp_material_reservation_stale` anything beyond what is still
lacking or free, all or none; reservations name the camp's meeting and outing, and one already made
for the camp over exactly its dates grows rather than doubling (any other booking is never altered).
Each free-text line offers "Convert to catalogue articles" (`meetings.manage`; creating a missing
article there also takes `equipment_catalog.manage`): the line's articles and the text they leave are
saved in one `PATCH /api/v1/yearly-planner/meeting-activities/:id`, so the list never counts them twice.
A line's articles and missing articles also offer "Assign to someone" (`tasks.manage`), which opens
the task form filled for the camp with its material reminder.

Meeting preparation sends a change to the server once the date (and the youth of honour, where
the unit requires one) is filled; the leader in charge and the place are optional, as on the
server. Until then the change stays on the device and the status names what is missing.
