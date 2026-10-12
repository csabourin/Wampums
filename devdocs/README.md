# Wampums Development Documentation

This directory contains durable material that is not better expressed by code, tests, or the primary engineering guide.

## Maintained documents

- [`../CLAUDE.md`](../CLAUDE.md) — engineering conventions, architecture rules, security requirements, and review checklist
- [`../AGENTS.md`](../AGENTS.md) — concise coding-agent instructions
- [`../readme.md`](../readme.md) — setup, commands, project map, and source-of-truth order
- [`../.claude/skills/run-wampums/SKILL.md`](../.claude/skills/run-wampums/SKILL.md) — run, seed and screenshot the app locally
- [`FAMILY_ACCESS.md`](./FAMILY_ACCESS.md) — invitations, parent onboarding, family links, and who can see which child
- [`EMAIL_SENDER.md`](./EMAIL_SENDER.md) — a unit's email sender name, From and Reply-To, and the DNS that keeps them from being marked as spoofed
- [`oas-catalog-pipeline.md`](./oas-catalog-pipeline.md) — versioned bilingual program catalog workflow
- [`UNIT_CUSTOMIZATION.md`](./UNIT_CUSTOMIZATION.md) — unit vocabulary (dens, sections…) and which dashboard tiles a unit shows
- [`REFONTE_TABLEAU_DE_BORD.md`](./REFONTE_TABLEAU_DE_BORD.md) — dashboard tile naming, grouping and tabbed-page rules, and what the mobile port can reuse (French)
- [`GESTION_ANNEE_SCOUTE.md`](./GESTION_ANNEE_SCOUTE.md) — scout-year rules: transition, archives, rollback, alumni, transfers, erasure (French)
- [`AI_PROMPT_SECURITY.md`](./AI_PROMPT_SECURITY.md) — trust boundary for data sent to the AI endpoints
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
