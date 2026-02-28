# Wampums Development Documentation

This directory contains technical documentation for the Wampums Scout Management System.

## Core Documentation

### Essential Reading
- **[CLAUDE.md](../CLAUDE.md)** - Primary development guidelines covering:
  - Architecture patterns (RESTful API, authentication, database conventions)
  - Code quality standards (security, testing, error handling)
  - Frontend best practices (SPA patterns, mobile-first design)
  - Code review checklist

- **[AGENTS.md](../AGENTS.md)** - Quick reference guide for AI development agents

- **[readme.md](../readme.md)** - Project overview and feature list

### Architecture & Planning
- **[oas-catalog-pipeline.md](./oas-catalog-pipeline.md)** - Versioned OAS catalog data pipeline, bilingual checks, and evolution process
- **[CODEBASE_ARCHITECTURE_REVIEW.md](./CODEBASE_ARCHITECTURE_REVIEW.md)** - Comprehensive architecture analysis
- **[CODEBASE_ARCHITECTURE_TODO.md](./CODEBASE_ARCHITECTURE_TODO.md)** - Migration roadmap and modernization tasks
- **[API_ENDPOINT_USAGE_AUDIT.md](./API_ENDPOINT_USAGE_AUDIT.md)** - API endpoint inventory and usage tracking

### Security & Risk
- **[scoping-risk-assessment.md](./scoping-risk-assessment.md)** - Security risk assessment and mitigation strategies

### Offline-First & Performance
- **[offline-sync-architecture.md](./offline-sync-architecture.md)** - Offline-first architecture design
- **[offline-first-audit.md](./offline-first-audit.md)** - Offline functionality audit and issues

## Archived Documentation

Historical documents and completed code reviews are in the [archive/](./archive/) directory.

## Document Lifecycle

- **Active**: Documents that reflect current architecture and inform ongoing development
- **Archived**: Historical documents, completed code reviews, or superseded documentation
- Documents should be moved to archive/ when:
  - They describe features that have been removed or completely refactored
  - They are point-in-time reviews that have been addressed
  - Their content has been fully integrated into CLAUDE.md or other active docs

## Contributing to Documentation

When updating documentation:
1. Keep CLAUDE.md as the single source of truth for coding standards
2. Use devdocs/ for architecture decisions, audits, and planning
3. Archive outdated content rather than deleting it (for historical reference)
4. Cross-reference related documents to maintain traceability
5. Update this README when adding or archiving significant documents
