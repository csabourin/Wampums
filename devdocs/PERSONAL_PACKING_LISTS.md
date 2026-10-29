# Personal camp packing lists (#1249)

From a camp schedule choose **Prepare the personal packing list**. Management requires
`personal_equipment.manage` with organization scope. The list starts with editable seasonal
suggestions (summer, winter, spring/autumn), adjusted for day/indoor/tent stays and nights.
The team reviews the list before publishing; suggestions are not an approval for specific conditions.
An optional article reference reuses the unit's existing material catalogue.

The multiline field adds one editable item per nonblank line. Pasted list bullets are removed;
quantities written in the text remain there. A separate quantity control is available per row.
At least one of the French or English labels is needed; writing both is optional. Bulk additions
are checked against the same item/label limits before replacing the editor. Saving requires a
connection and never enters an offline outbox. Concurrent editors use expected versions.

Parents find published lists under **To do for your family**. The read endpoint returns only
currently linked, enrolled and eligible children for that camp and scout year. A cancelled,
unpublished or unrelated camp is unavailable. A staff account's parent view is also restricted
to its own children; the management view edits only common content.

## Checkmarks are local

There is no database table or API for packing progress. `packingStorage.js` stores stable item
keys in localStorage, scoped by account, unit, selected year, camp and child. Checking an item
makes no API request and works offline after the common list has been opened on the device.
Another device or browser has its own checkmarks. Clearing browser storage removes them.
A blocked/quota-exceeded write restores the previous visible state and explains the failure.
Changing labels, adding items or translating preserves keys already checked.

## Translation

The reader chooses the content language and presses **Translate my list**. The dedicated endpoint
accepts only a language code, loads the authorized published common list and sends only its item
keys/labels and instructions to the existing AI service. It sends no child identity or checkmarks.
A complete authored French/English version needs no AI call. Other translations share the existing
monthly AI budget and are cached by unit, camp, list version and language. A transaction lock
collapses concurrent same-language requests. Every returned item key must match exactly; missing,
extra or duplicate keys reject the whole answer. Provider errors leave the original text and checks.
The list remains printable in the displayed language with local checkmarks.

Migration `062_personal_camp_equipment.sql` is re-runnable and creates only common lists, their
items and shared translations. Default parent/demo-parent roles receive read access; a unit grants
the management permission explicitly. Read access is self-scoped in a linked role. Demo accounts
may read and use local checks, but cannot publish or spend the shared AI budget.

Tests use fictional families and mocked AI. The browser suite checks both family/editor layouts,
multiline entry, accessibility, persistence on reload and absence of packing-state requests.
