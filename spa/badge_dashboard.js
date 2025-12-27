import { translate } from "./app.js";
import {
  getBadgeSummary,
  getBadgeSystemSettings,
  getGroups,
  getParticipants,
  saveBadgeProgress,
  updateBadgeProgress,
} from "./ajax-functions.js";
import { CONFIG } from "./config.js";
import {
  getCachedData,
  setCachedData,
  clearBadgeRelatedCaches,
} from "./indexedDB.js";
import { debugError, debugLog } from "./utils/DebugUtils.js";
import {
  canApproveBadges,
  canManageBadges,
  canViewBadges,
} from "./utils/PermissionUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import {
  OptimisticUpdateManager,
  generateOptimisticId,
} from "./utils/OptimisticUpdateManager.js";

export class BadgeDashboard {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.participants = [];
    this.badgeEntries = [];
    this.badgeSettings = null;
    this.templates = [];
    this.records = [];
    this.sortedRecords = [];
    this.visibleCount = 25;
    this.batchSize = 25;
    this.sortKey = "group";
    this.sortDirection = "asc";
    this.modalContainerId = "badge-dashboard-modal";
    this.optimisticManager = new OptimisticUpdateManager();
  }

  async init() {
    if (!this.canAccess()) {
      this.renderNotAuthorized();
      return;
    }

    await this.hydrateFromCache();
    this.buildRecords();
    this.render();
    this.attachEventListeners();
    await this.refreshFromNetwork();
  }

  canAccess() {
    return canViewBadges() || canApproveBadges() || canManageBadges();
  }

  async hydrateFromCache() {
    try {
      const [cachedGroups, cachedParticipants, cachedBadges, cachedSettings] =
        await Promise.all([
          getCachedData("badge_dashboard_groups"),
          getCachedData("badge_dashboard_participants"),
          getCachedData("badge_dashboard_badges"),
          getCachedData("badge_dashboard_settings"),
        ]);

      if (cachedGroups) this.groups = cachedGroups;
      if (cachedParticipants) this.participants = cachedParticipants;
      if (cachedBadges) this.badgeEntries = cachedBadges;
      if (cachedSettings) {
        this.badgeSettings = cachedSettings;
        this.templates = cachedSettings.templates || [];
      }
    } catch (error) {
      debugError("Error hydrating cache for badge dashboard", error);
    }
  }

  async refreshFromNetwork() {
    try {
      const [
        groupsResponse,
        participantsResponse,
        badgeSummaryResponse,
        badgeSettingsResponse,
      ] = await Promise.all([
        getGroups(),
        getParticipants(),
        getBadgeSummary(),
        getBadgeSystemSettings(),
      ]);

      const groups = groupsResponse.data || groupsResponse.groups || [];
      const participants =
        participantsResponse.data || participantsResponse.participants || [];
      const badgeEntries = badgeSummaryResponse.data || [];
      const badgeSettings = badgeSettingsResponse?.data || null;

      if (Array.isArray(groups)) {
        this.groups = groups;
        await setCachedData(
          "badge_dashboard_groups",
          groups,
          CONFIG.CACHE_DURATION.LONG,
        );
      }

      if (Array.isArray(participants)) {
        this.participants = participants;
        await setCachedData(
          "badge_dashboard_participants",
          participants,
          CONFIG.CACHE_DURATION.MEDIUM,
        );
      }

      if (Array.isArray(badgeEntries)) {
        this.badgeEntries = badgeEntries;
        await setCachedData(
          "badge_dashboard_badges",
          badgeEntries,
          CONFIG.CACHE_DURATION.SHORT,
        );
      }

      if (badgeSettings) {
        this.badgeSettings = badgeSettings;
        this.templates = badgeSettings.templates || [];
        await setCachedData(
          "badge_dashboard_settings",
          badgeSettings,
          CONFIG.CACHE_DURATION.LONG,
        );
      } else {
        this.templates = [];
      }

      this.buildRecords();
      this.resetVisibleCount();
      this.updateRows();
    } catch (error) {
      debugError("Error refreshing badge dashboard data", error);
      this.renderError();
    }
  }

  buildRecords() {
    const groupMap = new Map(this.groups.map((group) => [group.id, group]));
    const participantMap = new Map(
      this.participants.map((participant) => {
        const group = groupMap.get(participant.group_id);
        const section =
          participant.group_section || group?.section || "general";
        return [
          participant.id,
          {
            id: participant.id,
            firstName: participant.first_name,
            lastName: participant.last_name,
            groupId: participant.group_id,
            groupName: group?.name || translate("no_group"),
            section,
            badges: new Map(),
            totalStars: 0,
          },
        ];
      }),
    );

    this.badgeEntries.forEach((entry) => {
      const participant = participantMap.get(entry.participant_id);
      if (!participant) return;

      const template = this.getTemplateById(entry.badge_template_id);
      const badgeName = this.getBadgeLabel(template, entry);
      const templateLevels = template?.levels || entry.template_levels || [];
      const levelCount =
        template?.level_count ||
        (Array.isArray(templateLevels) ? templateLevels.length : 0) ||
        entry.level_count ||
        this.getObtainableStars(badgeName, 0, entry.badge_template_id);
      const badgeKey = entry.badge_template_id
        ? `template-${entry.badge_template_id}`
        : (badgeName || "").toLowerCase();

      if (!participant.badges.has(badgeKey)) {
        participant.badges.set(badgeKey, {
          id: entry.badge_template_id,
          name: badgeName,
          translationKey: template?.translation_key || entry.translation_key,
          section:
            template?.section || entry.badge_section || participant.section,
          levelCount,
          levels: Array.isArray(templateLevels) ? templateLevels : [],
          image: template?.image || entry.image,
          statuses: new Set(),
          entries: [],
        });
      }

      const badge = participant.badges.get(badgeKey);
      badge.statuses.add(entry.status || "pending");
      badge.entries.push({
        ...entry,
        badge_name: badgeName,
        badge_template_id: entry.badge_template_id,
        badge_section: badge.section,
      });
    });

    this.records = Array.from(participantMap.values()).map((record) => {
      const badges = Array.from(record.badges.values()).map((badge) => {
        const entries = this.sortBadgeEntries(badge.entries);
        const completedLevels = this.countCompletedLevels(
          entries,
          badge.levelCount,
        );
        return {
          ...badge,
          stars: completedLevels,
          obtainable:
            badge.levelCount ||
            this.getObtainableStars(badge.name, completedLevels, badge.id),
          entries,
          starMap: this.buildStarMap(entries, badge.levelCount),
        };
      });

      const totalStars = badges.reduce(
        (sum, badge) => sum + (badge.stars || 0),
        0,
      );

      return {
        ...record,
        badges,
        totalStars,
      };
    });

    this.sortRecords();
  }

  getTemplateById(templateId) {
    const normalizedId = Number.isFinite(Number(templateId))
      ? Number(templateId)
      : templateId;
    return this.templates.find((template) => template.id === normalizedId);
  }

  getTemplatesForSection(section) {
    const normalizedSection = section || "general";
    return this.templates.filter(
      (template) =>
        template.section === normalizedSection ||
        template.section === "general",
    );
  }

  getBadgeLabel(template, entry = {}) {
    if (!template) {
      return (
        translate(entry.translation_key) ||
        entry.badge_name ||
        entry.territoire_chasse ||
        translate("badge_unknown_label")
      );
    }
    return (
      translate(template.translation_key) ||
      template.name ||
      translate("badge_unknown_label")
    );
  }

  getObtainableStars(badgeName, currentStars = 0, templateId = null) {
    const template = templateId ? this.getTemplateById(templateId) : null;
    if (template) {
      const levelCount = template.level_count || template.levels?.length || 0;
      return Math.max(levelCount || 0, currentStars, 3);
    }

    if (!this.badgeSettings) return Math.max(3, currentStars);

    const starFieldMax = this.badgeSettings?.badge_structure?.fields?.find(
      (field) => field.name === "etoiles",
    )?.max;
    const explicitMax = parseInt(starFieldMax, 10);

    const territory = (this.badgeSettings.territoires || []).find(
      (territoire) =>
        territoire.name?.toLowerCase() === badgeName.toLowerCase(),
    );

    const maxFromTerritory = territory?.maxStars || territory?.max_etoiles;
    const globalMax =
      explicitMax ||
      this.badgeSettings.maxStarsPerBadge ||
      this.badgeSettings.maxStars ||
      this.badgeSettings.max_etoiles ||
      3;

    return Math.max(maxFromTerritory || 0, globalMax || 0, currentStars, 3);
  }

  render() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <section class="badge-dashboard" aria-labelledby="badge-dashboard-title">
        <header class="badge-dashboard__header">
          <div>
            <h1 id="badge-dashboard-title">${translate("badge_dashboard_title")}</h1>
            <p class="subtitle">${translate("badge_dashboard_description")}</p>
          </div>
        </header>
        ${this.renderControls()}
        <div class="badge-table" role="table" aria-label="${translate("badge_table_caption")}">
          ${this.renderTableHeader()}
          <div id="badge-table-body" role="rowgroup">
            ${this.renderRows()}
          </div>
          <div id="badge-table-sentinel" aria-hidden="true"></div>
        </div>
      </section>
      <div id="${this.modalContainerId}" class="badge-dashboard__modal hidden"></div>
    `;

    setContent(document.getElementById("app"), content);
  }

  renderControls() {
    return `
      <div class="badge-dashboard__controls">
        <label for="badge-sort" class="sr-only">${translate("badge_sort_label")}</label>
        <select id="badge-sort" aria-label="${translate("badge_sort_label")}">
          <option value="group" ${this.sortKey === "group" ? "selected" : ""}>${translate("badge_sort_group")}</option>
          <option value="name" ${this.sortKey === "name" ? "selected" : ""}>${translate("badge_sort_name")}</option>
          <option value="stars" ${this.sortKey === "stars" ? "selected" : ""}>${translate("badge_sort_stars")}</option>
        </select>
        <button id="badge-sort-direction" class="ghost-button" aria-label="${translate("badge_sort_direction")}">
          ${this.sortDirection === "asc" ? "↑" : "↓"}
        </button>
      </div>
    `;
  }

  renderTableHeader() {
    return `
      <div class="badge-table__header" role="row">
        <span role="columnheader">${translate("badge_table_participant")}</span>
        <span role="columnheader">${translate("badge_table_badges")}</span>
        <span role="columnheader" class="numeric">${translate("badge_table_total_stars")}</span>
      </div>
    `;
  }

  renderRows() {
    const rows = [];
    let currentGroup = null;

    const visible = this.getVisibleRecords();

    if (this.sortKey === "group") {
      visible.forEach((record) => {
        if (record.groupName !== currentGroup) {
          currentGroup = record.groupName;
          rows.push(`
            <div class="badge-table__group" role="rowgroup">
              <div class="badge-table__group-title" role="rowheader">${record.groupName}</div>
            </div>
          `);
        }

        rows.push(this.renderRow(record));
      });
    } else {
      visible.forEach((record) =>
        rows.push(this.renderRow(record, { showGroupTag: true })),
      );
    }

    return rows.join("");
  }

  renderRow(record, options = {}) {
    const { showGroupTag = false } = options;
    const badges = record.badges.length
      ? record.badges
          .map((badge) => this.renderBadgeChip(record.id, badge))
          .join("")
      : `<span class="badge-chip badge-chip--muted">${translate("badge_no_entries")}</span>`;

    const addBadgeAction = record.badges.length ? "" : ``;

    return `
      <article class="badge-table__row" role="row" data-participant-id="${record.id}">
        <div role="cell" class="badge-table__cell badge-table__cell--header">
          <div class="participant-header">
            <div class="participant-info">
              <span class="participant-name">${record.firstName} ${record.lastName}</span>
              ${showGroupTag ? `<span class="badge-table__group-tag">${record.groupName}</span>` : ""}
            </div>
            <div class="participant-actions">
              <span class="star-count" title="${translate("badge_total_stars") || "Total stars"}">${record.totalStars}⭐</span>
              <button class="icon-button" data-action="edit-participant" data-participant-id="${record.id}" title="${translate("badge_edit_participant")}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11.5 2.5l2 2L6 12H4v-2l7.5-7.5z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div role="cell" class="badge-table__cell badge-table__cell--badges">
          ${badges}
          ${addBadgeAction}
        </div>
      </article>
    `;
  }

  renderBadgeChip(participantId, badge) {
    const totalLevels = Math.max(1, badge.obtainable);
    const percent = Math.min(
      100,
      Math.round((badge.stars / totalLevels) * 100),
    );
    const statusLabel = Array.from(badge.statuses)
      .map(
        (status) =>
          `<span class="status-pill status-pill--${status}">${translate(`badge_status_${status}`)}</span>`,
      )
      .join("");

    const stars = this.renderBadgeStars(participantId, badge);
    const badgeImage = this.getBadgeImage(badge.name, badge);

    return `
      <div class="badge-chip-compact" data-participant-id="${participantId}" data-badge-name="${badge.name}" data-template-id="${badge.id || ""}">
        ${badgeImage ? `<img src="${badgeImage}" alt="${badge.name}" class="badge-chip__image">` : ""}
        <div class="badge-chip__content">
          <div class="badge-chip__name">${badge.name}</div>
          <div class="badge-chip__stars-compact" role="group" aria-label="${translate("badge_stars_label")}">${stars}</div>
          <div class="badge-chip__status">${statusLabel}</div>
          <div class="progress-compact" role="progressbar" aria-valuemin="0" aria-valuemax="${badge.obtainable}" aria-valuenow="${badge.stars}">
            <div class="progress__bar" style="width: ${percent}%;"></div>
          </div>
        </div>
      </div>
    `;
  }

  renderBadgeStars(participantId, badge) {
    const starTotal = badge.obtainable || badge.levelCount || 3;
    const levelLabel =
      translate("badge_level_label") || translate("badge_star_label");
    return Array.from({ length: starTotal }, (_, index) => {
      const starIndex = index + 1;
      const starMapping = badge.starMap?.find(
        (item) => item.starIndex === starIndex,
      );
      const isEarned = Boolean(starMapping);
      const entryId = starMapping?.entryId;
      const ariaLabel = `${levelLabel} ${starIndex}${isEarned ? "" : ` ${translate("badge_star_locked")}`}`;

      return `
        <button
          class="badge-star-button ${isEarned ? "is-earned" : "is-locked"}"
          data-action="star-details"
          data-participant-id="${participantId}"
          data-badge-name="${badge.name}"
          data-template-id="${badge.id || ""}"
          data-star-index="${starIndex}"
          ${isEarned ? "" : "disabled"}
          aria-label="${ariaLabel}"
          data-entry-id="${entryId || ""}"
        >
          ${isEarned ? "★" : "☆"}
        </button>
      `;
    }).join("");
  }

  attachEventListeners() {
    const sortSelect = document.getElementById("badge-sort");
    const sortDirectionButton = document.getElementById("badge-sort-direction");
    const refreshButton = document.getElementById("badge-refresh");

    sortSelect?.addEventListener("change", (event) => {
      this.sortKey = event.target.value;
      this.sortRecords();
      this.resetVisibleCount();
      this.updateRows();
    });

    sortDirectionButton?.addEventListener("click", () => {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
      sortDirectionButton.textContent =
        this.sortDirection === "asc" ? "↑" : "↓";
      this.sortRecords();
      this.resetVisibleCount();
      this.updateRows();
    });

    refreshButton?.addEventListener("click", () => this.refreshFromNetwork());

    document
      .getElementById("badge-table-body")
      ?.addEventListener("click", (event) => {
        const actionButton = event.target.closest("button[data-action]");
        if (!actionButton) return;

        const { action, participantId, badgeName, starIndex, templateId } =
          actionButton.dataset;
        if (!participantId) return;

        if (action === "star-details") {
          this.openBadgeModal(
            parseInt(participantId, 10),
            templateId ? parseInt(templateId, 10) : badgeName,
            false,
            parseInt(starIndex, 10),
          );
        }

        if (action === "edit-participant") {
          this.openBadgeModal(
            parseInt(participantId, 10),
            templateId ? parseInt(templateId, 10) : badgeName || null,
            true,
          );
        }

        if (action === "add-badge") {
          this.openAddBadgeModal(parseInt(participantId, 10));
        }
      });

    this.setupInfiniteScroll();
  }

  setupInfiniteScroll() {
    const sentinel = document.getElementById("badge-table-sentinel");
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.visibleCount += this.batchSize;
            this.updateRows();
          }
        });
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
  }

  sortRecords() {
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const direction = this.sortDirection === "asc" ? 1 : -1;

    const participantComparator = (a, b) => {
      if (this.sortKey === "stars") {
        const starComparison =
          direction * ((b.totalStars || 0) - (a.totalStars || 0));
        if (starComparison !== 0) return starComparison;
      }

      const nameComparison = collator.compare(
        `${a.firstName} ${a.lastName}`,
        `${b.firstName} ${b.lastName}`,
      );

      if (this.sortKey === "name") {
        return direction * nameComparison;
      }

      if (this.sortKey === "group") {
        return (
          direction * collator.compare(a.groupName, b.groupName) ||
          nameComparison
        );
      }

      return nameComparison;
    };

    if (this.sortKey === "group") {
      const groupMap = new Map();

      this.records.forEach((record) => {
        const groupName = record.groupName || translate("no_group");
        if (!groupMap.has(groupName)) groupMap.set(groupName, []);
        groupMap.get(groupName).push(record);
      });

      const sortedGroupNames = Array.from(groupMap.keys()).sort(
        (a, b) => direction * collator.compare(a, b),
      );

      this.sortedRecords = [];
      sortedGroupNames.forEach((groupName) => {
        const participants = groupMap.get(groupName) || [];
        participants.sort(participantComparator);
        this.sortedRecords.push(
          ...participants.map((participant) => ({ ...participant, groupName })),
        );
      });
      return;
    }

    this.sortedRecords = [...this.records].sort(participantComparator);
  }

  getVisibleRecords() {
    return (
      this.sortedRecords.length ? this.sortedRecords : this.records
    ).slice(0, this.visibleCount);
  }

  resetVisibleCount() {
    this.visibleCount = this.batchSize;
  }

  updateRows() {
    const body = document.getElementById("badge-table-body");
    if (!body) return;
    setContent(body, this.renderRows());
  }

  openBadgeModal(
    participantId,
    badgeTemplateId = null,
    focusEdit = false,
    targetStar = null,
    showAddForm = false,
  ) {
    const modal = document.getElementById(this.modalContainerId);
    if (!modal) return;

    const record = this.records.find(
      (participant) => participant.id === participantId,
    );
    if (!record) return;

    const hasExistingBadges = record.badges.length > 0;
    const badge = hasExistingBadges
      ? this.selectBadge(record.badges, badgeTemplateId)
      : null;
    const availableTemplates = this.getTemplatesForSection(record.section);
    const templateSelectDisabled = availableTemplates.length === 0;

    // If no existing badges and no add form requested, show add form
    if (!hasExistingBadges && !showAddForm) {
      showAddForm = true;
    }

    const entries = badge ? this.sortBadgeEntries(badge.entries) : [];
    const defaultEntry = badge
      ? this.getEntryForStar(targetStar, badge) || entries[0]
      : null;
    const formattedDefaultDate = this.formatDateInput(
      defaultEntry?.date_obtention,
    );
    const levelLabel =
      translate("badge_level_label") ||
      translate("badge_star_label") ||
      "Level";

    const badgeOptions = record.badges
      .map(
        (item) =>
          `<option value="${item.id || item.name}" ${item.id === (badge?.id || badgeTemplateId) ? "selected" : ""}>${item.name}</option>`,
      )
      .join("");

    const templateOptions = availableTemplates
      .map(
        (template) =>
          `<option value="${template.id}" ${template.id === (badge?.id || badgeTemplateId) ? "selected" : ""}>${this.getBadgeLabel(template)}</option>`,
      )
      .join("");

    setContent(modal, `
      <div class="modal__backdrop" role="presentation"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="badge-modal-title">
        <header class="modal__header">
          <div>
            <p class="eyebrow">${record.groupName}</p>
            <h2 id="badge-modal-title">${record.firstName} ${record.lastName}</h2>
          </div>
          <button class="ghost-button" id="close-badge-modal" aria-label="${translate("close")}">✕</button>
        </header>

        ${
          hasExistingBadges
            ? `
        <nav class="modal__tabs">
          <button type="button" class="tab-button ${!showAddForm ? "active" : ""}" data-tab="edit">
            ${translate("badge_edit_tab") || "Edit"}
          </button>

          <button type="button" class="tab-button ${showAddForm ? "active" : ""}" data-tab="add">
            ${translate("badge_add_tab") || "New Star"}
          </button>
        </nav>
        `
            : ""
        }

        <section class="modal__content">
          ${
            hasExistingBadges
              ? `
          <div class="tab-content ${!showAddForm ? "active" : ""}" data-content="edit">
            <div class="form-group-compact">
              <label for="badge-select">${translate("badge")}</label>
              <select id="badge-select" name="badge">${badgeOptions}</select>
            </div>

            ${
              entries.length > 0
                ? `
            <details class="badge-history-toggle" ${entries.length <= 2 ? "open" : ""}>
              <summary>${translate("badge_entry_history") || "History"} (${entries.length})</summary>
              <ol class="badge-history-compact">
                ${entries
                  .map(
                    (entry) => `
                  <li>
                    <span class="badge-hist-status">${translate(`badge_status_${entry.status || "pending"}`).substring(0, 3)}</span>
                    <span class="badge-hist-date">${this.formatReadableDate(entry.date_obtention)}</span>
                    <span class="badge-hist-stars">${levelLabel} ${entry.etoiles}</span>
                    ${entry.objectif ? `<p class="badge-hist-text">${entry.objectif}</p>` : ""}
                  </li>
                `,
                  )
                  .join("")}
              </ol>
            </details>
            `
                : ""
            }

            <form id="badge-edit-form" data-participant-id="${participantId}" data-badge-name="${badge?.name || ""}">
              <div class="form-group-compact">
                <label for="badge-entry-select">${translate("badge_select_entry") || "Entry"} (${levelLabel} #${defaultEntry?.etoiles || ""})</label>
                <select id="badge-entry-select" name="entry">
                  ${entries
                    .map(
                      (entry) => `
                    <option value="${entry.id}">⭐${entry.etoiles} · ${this.formatReadableDate(entry.date_obtention)}</option>
                  `,
                    )
                    .join("")}
                </select>
              </div>

              <div class="form-group-compact">
                <label for="badge-date">${translate("badge_date_label") || "Date"}</label>
                <input id="badge-date" name="date_obtention" type="date" value="${formattedDefaultDate}" />
              </div>

              <div class="form-group-compact">
                <label for="badge-objective">${translate("badge_objective_label") || "Objective"}</label>
                <textarea id="badge-objective" name="objectif" rows="2">${defaultEntry?.objectif || ""}</textarea>
              </div>

              <div class="form-group-compact">
                <label for="badge-description">${translate("badge_description_label") || "Description"}</label>
                <textarea id="badge-description" name="description" rows="2">${defaultEntry?.description || ""}</textarea>
              </div>

              <div class="form-group-compact">
                <label for="badge-status">${translate("badge_status_label") || "Status"}</label>
                <select id="badge-status" name="status">
                  <option value="">${translate("badge_status_keep") || "Keep current"}</option>
                  <option value="approved">${translate("badge_status_approved") || "Approved"}</option>
                  <option value="pending">${translate("badge_status_pending") || "Pending"}</option>
                  <option value="rejected">${translate("badge_status_rejected") || "Rejected"}</option>
                </select>
              </div>

              <div class="form-actions">
                <button type="submit" class="primary-button">${translate("save") || "Save"}</button>
              </div>
              <div id="badge-edit-feedback" role="status" aria-live="polite"></div>
            </form>
          </div>
          `
              : ""
          }

          <div class="tab-content ${showAddForm || !hasExistingBadges ? "active" : ""}" data-content="add">
            <form id="badge-add-form" data-participant-id="${participantId}">
              <div class="form-group-compact">
                <label for="badge-template">${translate("badge_select_badge") || "Badge"}</label>
                <select id="badge-template" name="badge_template_id" required ${templateSelectDisabled ? "disabled" : ""}>
                  <option value="">${translate("badge_select_prompt") || "Select a badge..."}</option>
                  ${templateOptions}
                </select>
                ${templateSelectDisabled ? `<p class="muted">${translate("no_badge_templates_for_section") || ""}</p>` : ""}
              </div>

              <div class="form-group-compact">
                <label for="badge-date-new">${translate("badge_date_label") || "Date"}</label>
                <input id="badge-date-new" name="date_obtention" type="date" />
              </div>

              <div class="form-group-compact">
                <label for="badge-objective-new">${translate("badge_objective_label") || "Objective"}</label>
                <textarea id="badge-objective-new" name="objectif" rows="2"></textarea>
              </div>

              <div class="form-group-compact">
                <label for="badge-description-new">${translate("badge_description_label") || "Description"}</label>
                <textarea id="badge-description-new" name="description" rows="2"></textarea>
              </div>

              <div class="form-actions">
                <button type="submit" class="primary-button">${translate("badge_add_button") || "New Star"}</button>
              </div>
              <div id="badge-add-feedback" role="status" aria-live="polite"></div>
            </form>
          </div>
        </section>
      </div>
    `);
    modal.classList.remove("hidden");

    const close = () => {
      modal.classList.add("hidden");
      setContent(modal, "");
    };

    modal.querySelector("#close-badge-modal")?.addEventListener("click", close);
    modal.querySelector(".modal__backdrop")?.addEventListener("click", close);

    // Tab switching
    modal.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        const tabName = button.getAttribute("data-tab");
        modal
          .querySelectorAll(".tab-button")
          .forEach((btn) => btn.classList.remove("active"));
        modal
          .querySelectorAll(".tab-content")
          .forEach((content) => content.classList.remove("active"));
        button.classList.add("active");
        modal
          .querySelector(`[data-content="${tabName}"]`)
          ?.classList.add("active");
      });
    });

    // Edit form handlers
    const entrySelect = modal.querySelector("#badge-entry-select");
    const dateInput = modal.querySelector("#badge-date");
    const objectiveInput = modal.querySelector("#badge-objective");
    const descriptionInput = modal.querySelector("#badge-description");
    const badgeSelect = modal.querySelector("#badge-select");

    badgeSelect?.addEventListener("change", (event) => {
      const nextBadgeId =
        parseInt(event.target.value, 10) || event.target.value;
      const currentTab = modal
        .querySelector(".tab-button.active")
        ?.getAttribute("data-tab");
      this.openBadgeModal(
        participantId,
        nextBadgeId,
        focusEdit,
        targetStar,
        currentTab === "add",
      );
    });

    entrySelect?.addEventListener("change", (event) => {
      const entryId = parseInt(event.target.value, 10);
      const selected =
        entries.find((item) => item.id === entryId) || defaultEntry;
      if (!selected) return;
      dateInput.value = this.formatDateInput(selected.date_obtention);
      objectiveInput.value = selected.objectif || "";
      descriptionInput.value = selected.description || "";

      // Update the label to show which star is being edited
      const label = modal.querySelector('label[for="badge-entry-select"]');
      if (label) {
        label.textContent = `${translate("badge_select_entry") || "Entry"} (${levelLabel} #${selected.etoiles})`;
      }
    });

    modal
      .querySelector("#badge-edit-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.target;
        const entryId = parseInt(
          form.querySelector("#badge-entry-select").value,
          10,
        );
        const feedback = form.querySelector("#badge-edit-feedback");

        const payload = {
          date_obtention: form.querySelector("#badge-date").value || null,
          objectif:
            form.querySelector("#badge-objective").value?.trim() || null,
          description:
            form.querySelector("#badge-description").value?.trim() || null,
        };

        const newStatus = form.querySelector("#badge-status").value;
        if (newStatus) payload.status = newStatus;

        // Use OptimisticUpdateManager for instant feedback
        await this.optimisticManager.execute(`edit-badge-${entryId}`, {
          optimisticFn: () => {
            // Save original state for rollback
            const rollbackState = {
              badgeEntries: JSON.parse(JSON.stringify(this.badgeEntries)),
              records: JSON.parse(JSON.stringify(this.records)),
            };

            // Find and update the entry optimistically
            const entryIndex = this.badgeEntries.findIndex(
              (entry) => entry.id === entryId,
            );
            if (entryIndex >= 0) {
              this.badgeEntries[entryIndex] = {
                ...this.badgeEntries[entryIndex],
                ...payload,
                _optimistic: true,
              };
            }

            // Rebuild and update UI
            this.buildRecords();
            this.updateRows();

            // Show optimistic success
            feedback.textContent = translate("badge_update_success");
            feedback.className = "feedback-success";

            return rollbackState;
          },

          apiFn: async () => {
            const result = await updateBadgeProgress(entryId, payload);
            if (!result?.success)
              throw new Error(result?.message || "Unknown error");

            // Clear IndexedDB cache to ensure fresh data on next load
            await clearBadgeRelatedCaches();

            return result;
          },

          successFn: (result) => {
            // Replace optimistic data with real server data
            this.replaceBadgeEntry(result.data);
            this.buildRecords();
            this.updateRows();

            debugLog("Badge entry updated successfully:", result.data);
          },

          rollbackFn: (rollbackState, error) => {
            // Revert to original state
            this.badgeEntries = rollbackState.badgeEntries;
            this.records = rollbackState.records;

            // Re-render to show original data
            this.buildRecords();
            this.updateRows();

            // Show error message
            feedback.textContent = translate("badge_update_error");
            feedback.className = "feedback-error";
          },

          onError: (error) => {
            debugError("Error updating badge entry", error);
          },
        });
      });

    // Add form handler
    modal
      .querySelector("#badge-add-form")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.target;
        const feedback = form.querySelector("#badge-add-feedback");
        const templateId = parseInt(form.badge_template_id.value, 10);
        if (!Number.isInteger(templateId)) {
          feedback.textContent = translate("badge_select_prompt");
          feedback.className = "feedback-error";
          return;
        }

        const payload = {
          participant_id: participantId,
          badge_template_id: templateId,
          date_obtention: form.date_obtention.value || null,
          objectif: form.objectif.value?.trim() || null,
          description: form.description.value?.trim() || null,
        };

        // Use OptimisticUpdateManager for instant feedback
        await this.optimisticManager.execute(
          `add-badge-${participantId}-${templateId}`,
          {
            optimisticFn: () => {
              // Save original state for rollback
              const rollbackState = {
                badgeEntries: JSON.parse(JSON.stringify(this.badgeEntries)),
                records: JSON.parse(JSON.stringify(this.records)),
              };

              // Create optimistic entry
              const optimisticEntry = {
                id: generateOptimisticId("badge"),
                ...payload,
                status: "pending",
                etoiles: 1, // Default to level 1 for new entries
                _optimistic: true,
              };

              // Add optimistic entry
              this.badgeEntries.push(optimisticEntry);
              this.buildRecords();
              this.resetVisibleCount();
              this.updateRows();

              // Show optimistic success
              feedback.textContent = translate("badge_add_success");
              feedback.className = "feedback-success";

              return rollbackState;
            },

            apiFn: async () => {
              const result = await saveBadgeProgress(payload);
              if (!result?.success)
                throw new Error(result?.message || "Unknown error");

              await clearBadgeRelatedCaches();

              return result;
            },

            successFn: (result) => {
              // Remove optimistic entry and add real data
              this.badgeEntries = this.badgeEntries.filter(
                (entry) => !entry._optimistic,
              );

              if (result.data) {
                this.badgeEntries.push(result.data);
                this.buildRecords();
                this.resetVisibleCount();
                this.updateRows();
              }

              debugLog("Badge entry created successfully:", result.data);

              // Reopen modal in edit mode with the newly added badge
              setTimeout(() => {
                const addedBadgeTemplateId = payload.badge_template_id;
                this.openBadgeModal(
                  participantId,
                  addedBadgeTemplateId,
                  false,
                  null,
                  false,
                );
              }, 500);
            },

            rollbackFn: (rollbackState, error) => {
              // Revert to original state
              this.badgeEntries = rollbackState.badgeEntries;
              this.records = rollbackState.records;

              // Re-render to remove optimistic entry
              this.buildRecords();
              this.resetVisibleCount();
              this.updateRows();

              // Show error message
              feedback.textContent = translate("badge_add_error");
              feedback.className = "feedback-error";
            },

            onError: (error) => {
              debugError("Error creating badge entry", error);
            },
          },
        );
      });

    if (defaultEntry?.id && entrySelect) {
      entrySelect.value = defaultEntry.id;
      entrySelect.dispatchEvent(new Event("change"));
    }
  }

  openAddBadgeModal(participantId) {
    // Redirect to the unified modal with add form active
    this.openBadgeModal(participantId, null, false, null, true);
  }

  getBadgeImage(badgeName, badge = null) {
    // First try to get image from the badge template (new system)
    if (badge?.image) {
      return `/assets/images/${badge.image}`;
    }

    // Fallback to old system (territoires in badgeSettings)
    if (this.badgeSettings?.territoires) {
      const territoire = this.badgeSettings.territoires.find(
        (t) => t.name.toLowerCase() === badgeName.toLowerCase(),
      );

      if (territoire && territoire.image) {
        return `/assets/images/${territoire.image}`;
      }
    }

    return null;
  }

  selectBadge(badges, badgeIdentifier) {
    if (!badgeIdentifier) return badges[0];
    const normalizedId = Number.isFinite(Number(badgeIdentifier))
      ? Number(badgeIdentifier)
      : badgeIdentifier;
    return (
      badges.find((item) => item.id === normalizedId) ||
      badges.find((item) => item.name === badgeIdentifier) ||
      badges[0]
    );
  }

  sortBadgeEntries(entries = []) {
    return [...entries].sort((a, b) => {
      const aDate = new Date(a.date_obtention || 0);
      const bDate = new Date(b.date_obtention || 0);
      return bDate - aDate;
    });
  }

  getEntryForStar(starIndex, badge) {
    if (!starIndex || !badge?.starMap?.length) return null;
    const mapping = badge.starMap.find((item) => item.starIndex === starIndex);
    if (!mapping) return null;
    return badge.entries.find((entry) => entry.id === mapping.entryId) || null;
  }

  countCompletedLevels(entries = [], levelCount = 0) {
    const levelSet = new Set();
    entries.forEach((entry) => {
      const level = parseInt(entry.etoiles, 10) || 0;
      if (level > 0 && (!levelCount || level <= levelCount)) {
        levelSet.add(level);
      }
    });
    return levelSet.size;
  }

  buildStarMap(entries = [], levelCount = 0) {
    const map = [];

    const orderedEntries = [...entries].sort((a, b) => {
      const aLevel = parseInt(a.etoiles, 10) || 0;
      const bLevel = parseInt(b.etoiles, 10) || 0;
      if (aLevel === bLevel) {
        const aDate = new Date(a.date_obtention || 0);
        const bDate = new Date(b.date_obtention || 0);
        return aDate - bDate;
      }
      return aLevel - bLevel;
    });

    orderedEntries.forEach((entry) => {
      const level = parseInt(entry.etoiles, 10) || 0;
      if (level > 0 && (!levelCount || level <= levelCount)) {
        map.push({ starIndex: level, entryId: entry.id });
      }
    });

    return map;
  }

  formatDateInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  formatReadableDate(value) {
    if (!value) return translate("badge_date_missing");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return translate("badge_date_missing");
    return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
      date,
    );
  }

  replaceBadgeEntry(updatedEntry) {
    const index = this.badgeEntries.findIndex(
      (entry) => entry.id === updatedEntry.id,
    );
    if (index >= 0) {
      this.badgeEntries[index] = updatedEntry;
    } else {
      this.badgeEntries.push(updatedEntry);
    }
  }

  renderNotAuthorized() {
    setContent(document.getElementById("app"), `
      <section class="badge-dashboard">
        <h1>${translate("not_authorized")}</h1>
        <p>${translate("badge_dashboard_no_access")}</p>
        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      </section>
    `);
  }

  renderError() {
    setContent(document.getElementById("app"), `
      <section class="badge-dashboard">
        <h1>${translate("error")}</h1>
        <p>${translate("badge_dashboard_error")}</p>
        <p><button class="ghost-button" id="badge-refresh">${translate("retry")}</button></p>
      </section>
    `);
    document
      .getElementById("badge-refresh")
      ?.addEventListener("click", () => this.refreshFromNetwork());
  }
}
