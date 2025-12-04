import { translate } from "./app.js";
import {
  getBadgeSummary,
  getBadgeSystemSettings,
  getGroups,
  getParticipants,
  updateBadgeProgress
} from "./ajax-functions.js";
import { CONFIG } from "./config.js";
import { getCachedData, setCachedData } from "./indexedDB.js";
import { debugError } from "./utils/DebugUtils.js";

export class BadgeDashboard {
  constructor(app) {
    this.app = app;
    this.groups = [];
    this.participants = [];
    this.badgeEntries = [];
    this.badgeSettings = null;
    this.records = [];
    this.visibleCount = 25;
    this.batchSize = 25;
    this.sortKey = "group";
    this.sortDirection = "asc";
    this.modalContainerId = "badge-dashboard-modal";
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
    return ["admin", "animation", "leader"].includes(this.app.userRole);
  }

  async hydrateFromCache() {
    try {
      const [cachedGroups, cachedParticipants, cachedBadges, cachedSettings] = await Promise.all([
        getCachedData("badge_dashboard_groups"),
        getCachedData("badge_dashboard_participants"),
        getCachedData("badge_dashboard_badges"),
        getCachedData("badge_dashboard_settings")
      ]);

      if (cachedGroups) this.groups = cachedGroups;
      if (cachedParticipants) this.participants = cachedParticipants;
      if (cachedBadges) this.badgeEntries = cachedBadges;
      if (cachedSettings) this.badgeSettings = cachedSettings;
    } catch (error) {
      debugError("Error hydrating cache for badge dashboard", error);
    }
  }

  async refreshFromNetwork() {
    try {
      const [groupsResponse, participantsResponse, badgeSummaryResponse, badgeSettingsResponse] = await Promise.all([
        getGroups(),
        getParticipants(),
        getBadgeSummary(),
        getBadgeSystemSettings()
      ]);

      const groups = groupsResponse.data || groupsResponse.groups || [];
      const participants = participantsResponse.data || participantsResponse.participants || [];
      const badgeEntries = badgeSummaryResponse.data || [];
      const badgeSettings = badgeSettingsResponse?.data || null;

      if (Array.isArray(groups)) {
        this.groups = groups;
        await setCachedData("badge_dashboard_groups", groups, CONFIG.CACHE_DURATION.LONG);
      }

      if (Array.isArray(participants)) {
        this.participants = participants;
        await setCachedData("badge_dashboard_participants", participants, CONFIG.CACHE_DURATION.MEDIUM);
      }

      if (Array.isArray(badgeEntries)) {
        this.badgeEntries = badgeEntries;
        await setCachedData("badge_dashboard_badges", badgeEntries, CONFIG.CACHE_DURATION.SHORT);
      }

      if (badgeSettings) {
        this.badgeSettings = badgeSettings;
        await setCachedData("badge_dashboard_settings", badgeSettings, CONFIG.CACHE_DURATION.LONG);
      }

      this.buildRecords();
      this.resetVisibleCount();
      this.updateRows();
      this.updateStats();
    } catch (error) {
      debugError("Error refreshing badge dashboard data", error);
      this.renderError();
    }
  }

  buildRecords() {
    const groupMap = new Map(this.groups.map((group) => [group.id, group]));
    const participantMap = new Map(
      this.participants.map((participant) => [participant.id, {
        id: participant.id,
        firstName: participant.first_name,
        lastName: participant.last_name,
        groupId: participant.group_id,
        groupName: groupMap.get(participant.group_id)?.name || translate("no_group"),
        badges: new Map(),
        totalStars: 0
      }])
    );

    this.badgeEntries.forEach((entry) => {
      const participant = participantMap.get(entry.participant_id);
      if (!participant) return;

      const badgeName = entry.territoire_chasse || translate("badge_unknown_label");
      const stars = parseInt(entry.etoiles, 10) || 0;
      const badgeKey = badgeName.toLowerCase();

      if (!participant.badges.has(badgeKey)) {
        participant.badges.set(badgeKey, {
          name: badgeName,
          stars: 0,
          obtainable: this.getObtainableStars(badgeName, stars),
          statuses: new Set(),
          entries: []
        });
      }

      const badge = participant.badges.get(badgeKey);
      badge.stars += stars;
      badge.obtainable = Math.max(badge.obtainable, this.getObtainableStars(badgeName, stars));
      badge.statuses.add(entry.status || "pending");
      badge.entries.push(entry);
      participant.totalStars += stars;
    });

    this.records = Array.from(participantMap.values()).map((record) => ({
      ...record,
      badges: Array.from(record.badges.values())
    }));

    this.sortRecords();
  }

  getObtainableStars(badgeName, currentStars = 0) {
    if (!this.badgeSettings) return Math.max(5, currentStars);

    const territory = (this.badgeSettings.territoires || []).find(
      (territoire) => territoire.name?.toLowerCase() === badgeName.toLowerCase()
    );

    const maxFromTerritory = territory?.maxStars || territory?.max_etoiles;
    const globalMax = this.badgeSettings.maxStarsPerBadge || this.badgeSettings.maxStars || this.badgeSettings.max_etoiles || 5;

    return Math.max(maxFromTerritory || globalMax || 5, currentStars);
  }

  render() {
    const content = `
      <section class="badge-dashboard" aria-labelledby="badge-dashboard-title">
        <header class="badge-dashboard__header">
          <div>
            <p class="eyebrow">${translate("badge_dashboard_label")}</p>
            <h1 id="badge-dashboard-title">${translate("badge_dashboard_title")}</h1>
            <p class="subtitle">${translate("badge_dashboard_description")}</p>
          </div>
          <div class="badge-dashboard__actions">
            <button id="badge-refresh" class="ghost-button">${translate("refresh")}</button>
          </div>
        </header>
        ${this.renderStatsPanel()}
        ${this.renderControls()}
        <div class="badge-table" role="table" aria-label="${translate("badge_table_caption")}">
          ${this.renderTableHeader()}
          <div id="badge-table-body" role="rowgroup">
            ${this.renderRows()}
          </div>
          <div id="badge-table-sentinel" aria-hidden="true"></div>
        </div>
      </section>
      <div id="${this.modalContainerId}" class="badge-dashboard__modal" hidden></div>
    `;

    document.getElementById("app").innerHTML = content;
  }

  renderStatsPanel() {
    const totalParticipants = this.records.length;
    const totalBadges = this.badgeEntries.length;
    const totalStars = this.badgeEntries.reduce((sum, entry) => sum + (parseInt(entry.etoiles, 10) || 0), 0);

    return `
      <section class="badge-dashboard__stats" aria-label="${translate("badge_dashboard_stats_label")}">
        <div class="stat-card">
          <p class="stat-card__label">${translate("badge_stat_participants")}</p>
          <p class="stat-card__value">${totalParticipants}</p>
        </div>
        <div class="stat-card">
          <p class="stat-card__label">${translate("badge_stat_badges")}</p>
          <p class="stat-card__value">${totalBadges}</p>
        </div>
        <div class="stat-card">
          <p class="stat-card__label">${translate("badge_stat_stars")}</p>
          <p class="stat-card__value">${totalStars}</p>
        </div>
      </section>
    `;
  }

  renderControls() {
    return `
      <div class="badge-dashboard__controls">
        <label for="badge-sort" class="sr-only">${translate("badge_sort_label")}</label>
        <select id="badge-sort" aria-label="${translate("badge_sort_label")}">
          <option value="group">${translate("badge_sort_group")}</option>
          <option value="name">${translate("badge_sort_name")}</option>
          <option value="stars">${translate("badge_sort_stars")}</option>
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
        <span role="columnheader">${translate("badge_table_group")}</span>
        <span role="columnheader">${translate("badge_table_participant")}</span>
        <span role="columnheader">${translate("badge_table_badges")}</span>
        <span role="columnheader" class="numeric">${translate("badge_table_total_stars")}</span>
      </div>
    `;
  }

  renderRows() {
    return this.getVisibleRecords()
      .map((record) => this.renderRow(record))
      .join("");
  }

  renderRow(record) {
    const badges = record.badges.length
      ? record.badges.map((badge) => this.renderBadgeChip(record.id, badge)).join("")
      : `<span class="badge-chip badge-chip--muted">${translate("badge_no_entries")}</span>`;

    return `
      <article class="badge-table__row" role="row" data-participant-id="${record.id}">
        <div role="cell" class="badge-table__cell">${record.groupName}</div>
        <div role="cell" class="badge-table__cell">${record.firstName} ${record.lastName}</div>
        <div role="cell" class="badge-table__cell badge-table__cell--badges">${badges}</div>
        <div role="cell" class="badge-table__cell numeric">${record.totalStars}</div>
      </article>
    `;
  }

  renderBadgeChip(participantId, badge) {
    const percent = Math.min(100, Math.round((badge.stars / badge.obtainable) * 100));
    const statusLabel = Array.from(badge.statuses)
      .map((status) => `<span class="status-pill status-pill--${status}">${translate(`badge_status_${status}`) || status}</span>`)
      .join("");

    return `
      <div class="badge-chip" data-participant-id="${participantId}" data-badge-name="${badge.name}">
        <div class="badge-chip__top">
          <span class="badge-chip__name">${badge.name}</span>
          <span class="badge-chip__stars">${badge.stars} / ${badge.obtainable} ⭐</span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${badge.obtainable}" aria-valuenow="${badge.stars}">
          <div class="progress__bar" style="width: ${percent}%;"></div>
        </div>
        <div class="badge-chip__footer">
          <div class="status-group">${statusLabel}</div>
          <div class="badge-chip__actions">
            <button class="text-button" data-action="details" data-participant-id="${participantId}" data-badge-name="${badge.name}">
              ${translate("badge_view_details")}
            </button>
            <button class="text-button" data-action="edit" data-participant-id="${participantId}" data-badge-name="${badge.name}">
              ${translate("badge_edit_entry")}
            </button>
          </div>
        </div>
      </div>
    `;
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
      sortDirectionButton.textContent = this.sortDirection === "asc" ? "↑" : "↓";
      this.sortRecords();
      this.updateRows();
    });

    refreshButton?.addEventListener("click", () => this.refreshFromNetwork());

    document.getElementById("badge-table-body")?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("button[data-action]");
      if (!actionButton) return;

      const { action, participantId, badgeName } = actionButton.dataset;
      if (!participantId || !badgeName) return;

      if (action === "details") {
        this.openBadgeModal(parseInt(participantId, 10), badgeName, false);
      }

      if (action === "edit") {
        this.openBadgeModal(parseInt(participantId, 10), badgeName, true);
      }
    });

    this.setupInfiniteScroll();
  }

  setupInfiniteScroll() {
    const sentinel = document.getElementById("badge-table-sentinel");
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.visibleCount += this.batchSize;
          this.updateRows();
        }
      });
    }, { rootMargin: "200px" });

    observer.observe(sentinel);
  }

  sortRecords() {
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });

    this.records.sort((a, b) => {
      let comparison = 0;

      if (this.sortKey === "group") {
        comparison = collator.compare(a.groupName || "", b.groupName || "");
      } else if (this.sortKey === "name") {
        comparison = collator.compare(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`);
      } else if (this.sortKey === "stars") {
        comparison = (b.totalStars || 0) - (a.totalStars || 0);
      }

      return this.sortDirection === "asc" ? comparison : -comparison;
    });
  }

  getVisibleRecords() {
    return this.records.slice(0, this.visibleCount);
  }

  resetVisibleCount() {
    this.visibleCount = this.batchSize;
  }

  updateRows() {
    const body = document.getElementById("badge-table-body");
    if (!body) return;
    body.innerHTML = this.renderRows();
  }

  updateStats() {
    const statsSection = document.querySelector(".badge-dashboard__stats");
    if (!statsSection) return;
    statsSection.outerHTML = this.renderStatsPanel();
  }

  openBadgeModal(participantId, badgeName, focusEdit = false) {
    const modal = document.getElementById(this.modalContainerId);
    if (!modal) return;

    const record = this.records.find((participant) => participant.id === participantId);
    const badge = record?.badges.find((item) => item.name === badgeName);
    if (!record || !badge) return;

    const entries = badge.entries;
    const defaultEntry = entries[0];

    modal.innerHTML = `
      <div class="modal__backdrop" role="presentation"></div>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="badge-modal-title">
        <header class="modal__header">
          <div>
            <p class="eyebrow">${record.groupName}</p>
            <h2 id="badge-modal-title">${record.firstName} ${record.lastName} · ${badge.name}</h2>
          </div>
          <button class="ghost-button" id="close-badge-modal" aria-label="${translate("close")}">✕</button>
        </header>
        <section class="modal__content">
          <div class="modal__section">
            <h3>${translate("badge_entry_history")}</h3>
            <ol class="badge-history">
              ${entries
                .map(
                  (entry) => `
                    <li>
                      <div class="badge-history__row">
                        <div>
                          <p class="badge-history__title">${translate(`badge_status_${entry.status || "pending"}`) || entry.status || "pending"}</p>
                          <p class="badge-history__meta">${entry.date_obtention || translate("badge_date_missing")}</p>
                        </div>
                        <span class="badge-history__stars">${entry.etoiles}⭐</span>
                      </div>
                      <p class="badge-history__text">${entry.objectif || translate("badge_objective_missing")}</p>
                      <p class="badge-history__text muted">${entry.description || translate("badge_description_missing")}</p>
                    </li>
                  `
                )
                .join("")}
            </ol>
          </div>
          <div class="modal__section">
            <h3>${translate("badge_edit_entry")}</h3>
            <form id="badge-edit-form" data-participant-id="${participantId}" data-badge-name="${badge.name}">
              <label for="badge-entry-select">${translate("badge_select_entry")}</label>
              <select id="badge-entry-select" name="entry">
                ${entries
                  .map(
                    (entry) => `
                      <option value="${entry.id}">${entry.date_obtention || translate("badge_date_missing")} · ${entry.etoiles}⭐ · ${translate(`badge_status_${entry.status || "pending"}`) || entry.status || "pending"}</option>
                    `
                  )
                  .join("")}
              </select>

              <label for="badge-stars">${translate("badge_stars_label")}</label>
              <input id="badge-stars" name="etoiles" type="number" min="0" inputmode="numeric" required value="${defaultEntry?.etoiles || 0}" />

              <label for="badge-date">${translate("badge_date_label")}</label>
              <input id="badge-date" name="date_obtention" type="date" value="${defaultEntry?.date_obtention || ""}" />

              <label for="badge-objective">${translate("badge_objective_label")}</label>
              <textarea id="badge-objective" name="objectif" rows="2">${defaultEntry?.objectif || ""}</textarea>

              <label for="badge-description">${translate("badge_description_label")}</label>
              <textarea id="badge-description" name="description" rows="3">${defaultEntry?.description || ""}</textarea>

              <label for="badge-status">${translate("badge_status_label")}</label>
              <select id="badge-status" name="status">
                <option value="">${translate("badge_status_keep")}</option>
                <option value="approved">${translate("badge_status_approved")}</option>
                <option value="pending">${translate("badge_status_pending")}</option>
                <option value="rejected">${translate("badge_status_rejected")}</option>
              </select>

              <div class="form-actions">
                <button type="submit" class="primary-button">${translate("save")}</button>
              </div>
              <div id="badge-edit-feedback" role="status" aria-live="polite"></div>
            </form>
          </div>
        </section>
      </div>
    `;

    modal.hidden = false;

    const close = () => {
      modal.hidden = true;
      modal.innerHTML = "";
    };

    modal.querySelector("#close-badge-modal")?.addEventListener("click", close);
    modal.querySelector(".modal__backdrop")?.addEventListener("click", close);

    const entrySelect = modal.querySelector("#badge-entry-select");
    const starInput = modal.querySelector("#badge-stars");
    const dateInput = modal.querySelector("#badge-date");
    const objectiveInput = modal.querySelector("#badge-objective");
    const descriptionInput = modal.querySelector("#badge-description");

    entrySelect?.addEventListener("change", (event) => {
      const entryId = parseInt(event.target.value, 10);
      const selected = entries.find((item) => item.id === entryId) || defaultEntry;
      if (!selected) return;
      starInput.value = selected.etoiles || 0;
      dateInput.value = selected.date_obtention || "";
      objectiveInput.value = selected.objectif || "";
      descriptionInput.value = selected.description || "";
    });

    modal.querySelector("#badge-edit-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const entryId = parseInt(form.querySelector("#badge-entry-select").value, 10);
      const feedback = form.querySelector("#badge-edit-feedback");

      const payload = {
        etoiles: parseInt(form.querySelector("#badge-stars").value, 10) || 0,
        date_obtention: form.querySelector("#badge-date").value || null,
        objectif: form.querySelector("#badge-objective").value?.trim() || null,
        description: form.querySelector("#badge-description").value?.trim() || null
      };

      const newStatus = form.querySelector("#badge-status").value;
      if (newStatus) payload.status = newStatus;

      try {
        const result = await updateBadgeProgress(entryId, payload);
        if (!result?.success) throw new Error(result?.message || "Unknown error");

        this.replaceBadgeEntry(result.data);
        this.buildRecords();
        this.updateRows();
        this.updateStats();
        feedback.textContent = translate("badge_update_success");
      } catch (error) {
        debugError("Error updating badge entry", error);
        feedback.textContent = translate("badge_update_error");
      }
    });

    if (focusEdit) {
      modal.querySelector("#badge-edit-form")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  replaceBadgeEntry(updatedEntry) {
    const index = this.badgeEntries.findIndex((entry) => entry.id === updatedEntry.id);
    if (index >= 0) {
      this.badgeEntries[index] = updatedEntry;
    } else {
      this.badgeEntries.push(updatedEntry);
    }
  }

  renderNotAuthorized() {
    document.getElementById("app").innerHTML = `
      <section class="badge-dashboard">
        <h1>${translate("not_authorized")}</h1>
        <p>${translate("badge_dashboard_no_access")}</p>
        <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      </section>
    `;
  }

  renderError() {
    document.getElementById("app").innerHTML = `
      <section class="badge-dashboard">
        <h1>${translate("error")}</h1>
        <p>${translate("badge_dashboard_error")}</p>
        <p><button class="ghost-button" id="badge-refresh">${translate("retry")}</button></p>
      </section>
    `;

    document.getElementById("badge-refresh")?.addEventListener("click", () => this.refreshFromNetwork());
  }
}
