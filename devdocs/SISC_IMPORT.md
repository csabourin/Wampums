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
