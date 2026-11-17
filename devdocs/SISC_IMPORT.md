# SISC import limits

`POST /api/v1/import/sisc` validates the complete CSV before acquiring its import database connection.
`SISC_IMPORT_LIMITS` in `config/constants.js` caps one synchronous import at 5 MiB of UTF-8,
1,000 nonblank data rows (plus the header), 128 columns, 64 Ki characters per physical line,
and 16 Ki characters per field. These bounds limit parsing memory and transaction work for a
unit-sized import. Split larger imports into batches. Non-string content, missing data rows
and unclosed quotes return 400; exceeded limits return 413 through the standard error helper.
The format remains semicolon-delimited, with quoted separators and blank lines supported.

SPA link navigation parses URLs before checking new-tab, download or modifier gestures.
Only HTTP, HTTPS, mailto, tel and blob links may reach browser navigation; other protocols are
cancelled. Only same-origin HTTP(S) links are routed inside the SPA.

## Health declarations (#1364)

The SISC CSV contains no health answers. `fiche_sante` is excluded from the forms written by an
import: an existing family's health declaration, timestamps and review metadata are preserved, and
no empty health submission is created for someone who has not filled one in. Registration and
supported authorization fields continue to import normally. Older empty placeholders are not
removed automatically: distinguishing them from a family's own declaration requires a separate
review. Tests: `test/sisc-import.test.js` and `test/sisc-health-preservation.integration.test.js`.

## One row at a time (#1459)

The whole import is one transaction, and each row runs inside its own savepoint
(`SAVEPOINT sisc_row`). A row the database refuses (a value longer than its column, say) is undone
alone and reported; the rows before and after it are saved. Without the savepoint, PostgreSQL aborts
the transaction at the first refused statement and the final `COMMIT` silently rolls everything back.
As a safety net, a `COMMIT` that PostgreSQL answers with `ROLLBACK` makes the import fail (500) rather
than report counts for rows that were not saved. A failed row also takes back its counters.

Birth dates are eight digits forming a real day (`20160503`). A blank one stays unknown; any other
value skips the row before anything is written.

The report lists `stats.errors` as `{ row, code }`: `row` is the line in the file, header included,
and `code` one of `SISC_IMPORT_ROW_ERRORS` (`config/constants.js`), a translation key the admin screen
shows as "Row 4: …". A database message never reaches the client; the server logs it with the row
number. Tests: `test/sisc-import.test.js` and `test/sisc-import-rows.integration.test.js`.

