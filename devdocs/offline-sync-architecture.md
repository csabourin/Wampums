# Offline-First PWA Sync Architecture

**Status:** Implementation
**Last Updated:** 2026-02-11

---

## 1. Offline Storage Schema

All offline data is stored in a single Dexie (IndexedDB) database: `WampumsOfflineDB`.

### Entity Stores (mirror server tables)

| Store | Key | Indexes | Notes |
|-------|-----|---------|-------|
| `participants` | `id` (int) | `organization_id`, `group_id`, `[organization_id+group_id]` | Core entity |
| `groups` | `id` (int) | `organization_id` | Core entity |
| `activities` | `id` (int) | `organization_id`, `activity_date` | Core entity |
| `attendance` | `id` (int) | `participant_id`, `date`, `[participant_id+date]`, `organization_id` | Per-date records |
| `honors` | `id` (int) | `participant_id`, `organization_id`, `created_at` | Recognition |
| `points` | `id` (int) | `participant_id`, `honor_id` | Derived from honors |
| `badge_templates` | `id` (int) | `organization_id` | Read-only reference |
| `badge_progress` | `id` (int) | `participant_id`, `badge_template_id`, `status` | Offline-editable |
| `medication_requirements` | `id` (int) | `participant_id`, `organization_id` | Camp-critical |
| `medication_distributions` | `id` (int) | `medication_requirement_id`, `participant_id`, `scheduled_for` | Camp-critical |
| `carpool_offers` | `id` (int) | `activity_id`, `user_id` | Activity-scoped |
| `carpool_assignments` | `id` (int) | `carpool_offer_id`, `participant_id` | Activity-scoped |

### Sync Infrastructure Stores

| Store | Key | Indexes | Purpose |
|-------|-----|---------|---------|
| `_outbox` | `++localId` (auto) | `entityType`, `entityId`, `operation`, `timestamp`, `status`, `[status+timestamp]` | Change tracking queue |
| `_idMap` | `++id` (auto) | `entityType`, `tempId`, `serverId`, `[entityType+tempId]`, `[entityType+serverId]` | Temp-to-server ID mapping |
| `_syncMeta` | `key` | - | Last sync timestamps, version, sync state |
| `_conflicts` | `++id` (auto) | `entityType`, `entityId`, `resolvedAt` | Unresolved conflicts |

---

## 2. Entity Dependency Graph & Sync Ordering

```
organizations (root - never synced offline, read-only context)
  |
  +-- groups (depends on: organization)
  |     |
  +-- participants (depends on: organization)
  |     |
  |     +-- participant_groups (depends on: participant, group) [embedded in participant]
  |     |
  |     +-- attendance (depends on: participant)
  |     |
  |     +-- honors (depends on: participant)
  |     |     |
  |     |     +-- points (depends on: honor, participant) [auto-derived]
  |     |
  |     +-- badge_progress (depends on: participant, badge_template)
  |     |
  |     +-- medication_requirements (depends on: participant)
  |     |     |
  |     |     +-- medication_distributions (depends on: medication_requirement, participant)
  |     |
  |     +-- carpool_assignments (depends on: participant, carpool_offer)
  |
  +-- activities (depends on: organization)
  |     |
  |     +-- carpool_offers (depends on: activity)
  |
  +-- badge_templates (depends on: organization) [read-only offline]
```

### Sync Push Order (topological)

1. `groups` - No FK deps besides org
2. `participants` - No FK deps besides org (group is a soft ref)
3. `activities` - No FK deps besides org
4. `badge_templates` - Read-only, skip push
5. `attendance` - Depends on participants
6. `honors` - Depends on participants
7. `points` - Auto-derived server-side from honors, skip push
8. `badge_progress` - Depends on participants, badge_templates
9. `medication_requirements` - Depends on participants
10. `medication_distributions` - Depends on medication_requirements, participants
11. `carpool_offers` - Depends on activities
12. `carpool_assignments` - Depends on carpool_offers, participants

### Sync Pull Order

Pull in reverse dependency order (leaves first, roots last) to avoid FK violations during upsert, or pull all then upsert in dependency order.

---

## 3. Outbox Event Format

```javascript
{
  localId: 1,              // Auto-increment, unique per outbox entry
  correlationId: "uuid",   // UUID for deduplication and tracing
  entityType: "attendance", // Store name
  entityId: 42,            // Entity ID (server ID or temp ID)
  tempId: "temp_abc123",   // Temp ID if entity was created offline (null otherwise)
  operation: "create",     // "create" | "update" | "delete"
  timestamp: 1707600000,   // Unix ms when change was made
  payload: { ... },        // Full entity for create, patch for update, null for delete
  dependencies: [           // References to other outbox entries this depends on
    { entityType: "participants", tempId: "temp_xyz" }
  ],
  status: "pending",       // "pending" | "in_progress" | "synced" | "failed" | "conflict"
  retryCount: 0,
  lastError: null,
  serverResponse: null      // Stored after sync for debugging
}
```

---

## 4. ID Mapping Format

```javascript
{
  id: 1,                    // Auto-increment
  entityType: "participants",
  tempId: "temp_1707600000_abc",  // Local temp ID
  serverId: 42,             // Server-assigned ID after sync
  createdAt: 1707600000,    // When mapping was created
  syncedAt: 1707601000      // When server ID was received
}
```

### Temp ID Format

`temp_{timestamp}_{random6chars}` - e.g., `temp_1707600000_a1b2c3`

---

## 5. Conflict Resolution Strategy

| Entity | Strategy | Rationale |
|--------|----------|-----------|
| `participants` | Field-level merge | Multiple leaders may edit different fields |
| `groups` | Last-write-wins | Rarely edited concurrently |
| `activities` | Last-write-wins | Usually one organizer |
| `attendance` | Last-write-wins (per participant+date) | Atomic status per record |
| `honors` | Create-wins (no update conflicts) | Append-only creation |
| `points` | Server-authoritative | Derived from honors server-side |
| `badge_progress` | Last-write-wins with status escalation | `approved` > `pending` |
| `medication_requirements` | Queue for user resolution | Safety-critical |
| `medication_distributions` | Last-write-wins | Time-sensitive camp ops |
| `carpool_offers` | Last-write-wins | Single owner |
| `carpool_assignments` | Last-write-wins | Assignment is atomic |

### Conflict Detection

Each entity tracks `updated_at` timestamp. On push:
1. Send `updated_at` with the payload
2. Server compares with its `updated_at`
3. If server's is newer, return 409 with server version
4. Client stores conflict in `_conflicts` store for resolution

---

## 6. Failure Modes & Mitigations

| Failure Mode | Mitigation |
|---|---|
| App closes mid-sync | Outbox entries remain `pending` or `in_progress`; on next launch, `in_progress` items reset to `pending` and retry |
| Network drops during push | Individual entry marked failed with retry count; exponential backoff |
| Temp ID referenced before parent synced | Dependency graph ensures parent pushed first; if parent fails, children stay pending |
| Duplicate creation (idempotency) | `correlationId` sent with each push; server deduplicates |
| Cache key mismatch (existing bug) | Repository layer normalizes all cache keys through `buildApiCacheKey` |
| Split mutation queue (existing bug) | Single outbox store replaces both SW and SPA mutation queues |
| Stale data after long offline | Pull phase fetches delta since `lastSyncAt`; full refresh if gap > 14 days |
| IndexedDB quota exceeded | Warn user; purge expired cache entries; keep outbox intact |
| Schema migration needed | Dexie handles version upgrades with migration callbacks |
