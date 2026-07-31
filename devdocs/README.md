# Wampums Development Documentation

This directory contains durable material that is not better expressed by code, tests, or the primary engineering guide.

## Maintained documents

- [`../CLAUDE.md`](../CLAUDE.md) — engineering conventions, architecture rules, security requirements, and review checklist
- [`../AGENTS.md`](../AGENTS.md) — concise coding-agent instructions
- [`../readme.md`](../readme.md) — setup, commands, project map, and source-of-truth order
- [`oas-catalog-pipeline.md`](./oas-catalog-pipeline.md) — versioned bilingual program catalog workflow
- [`go-to-market/pilot-playbook.md`](./go-to-market/pilot-playbook.md) — pilot operating guide
- [`go-to-market/positioning-en.md`](./go-to-market/positioning-en.md) — English positioning
- [`go-to-market/positioning-fr.md`](./go-to-market/positioning-fr.md) — French positioning

Mobile setup is maintained in [`../mobile/docs/README.md`](../mobile/docs/README.md). Published Markdown under `content/blog/` is application content, not engineering documentation.

## Documentation lifecycle

Keep a document only when it provides durable context that cannot be read reliably from executable artifacts. In particular:

- Tests are authoritative for verified behavior.
- Route modules and `routes/index.js` are authoritative for endpoints.
- Package manifests and configuration modules are authoritative for commands, dependencies, ports, and environment variables.
- Migration SQL is authoritative for repository-managed schema changes.
- Git history, issues, and pull requests are the record for completed fixes and point-in-time reviews.

Do not add test-run reports, session summaries, completed implementation plans, duplicated API inventories, or migration guides that can drift away from their SQL. Update a maintained entry-point document when a durable workflow changes.
