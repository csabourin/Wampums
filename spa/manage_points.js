import {
  getParticipants,
  getGroups,
  getAttendance,
  updatePoints,
  getAuthHeader,
  getCurrentOrganizationId,
  getApiUrl,
  CONFIG,
  API,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { debugLog, debugError, debugWarn } from "./utils/DebugUtils.js";
import {
  setCachedData,
  getCachedData,
  getCachedDataIgnoreExpiration,
} from "./indexedDB.js";
import { canViewPoints } from "./utils/PermissionUtils.js";
import { normalizeParticipantList } from "./utils/ParticipantRoleUtils.js";
import { setContent } from "./utils/DOMUtils.js";
import { getTodayISO } from "./utils/DateUtils.js";
import { PointsStore } from "./modules/points/PointsStore.js";

const POINTS_CACHE_KEY = "manage_points_data";

export class ManagePoints {
  constructor(app) {
    this.app = app;
    // Current selection as data, never as a DOM element reference
    // (re-renders would otherwise leave a detached node selected)
    this.selected = null; // { type: 'group'|'individual', id }
    this.currentSort = { key: "group", order: "asc" };
    this.currentFilter = "";

    // Single source of truth for totals; DOM only displays store values
    this.store = new PointsStore();
    this.unsubscribeStore = null;

    // One batch in flight at a time so absolute server totals can never
    // arrive out of order; clicks made meanwhile accumulate in the queue
    this.updateQueue = []; // [{ payload, txn }]
    this.batchInFlight = false;

    this.participants = [];
    this.groups = [];
    this.groupedParticipants = {};
    this.unassignedParticipants = [];

    // Today's attendance map (participant_id -> status), used to mirror the
    // server rule "group points only go to present/late participants"
    this.todayAttendance = {};
  }

  async init() {
    // Check permission
    if (!canViewPoints()) {
      this.app.router.navigate("/dashboard");
      return;
    }

    try {
      await this.preloadManagePointsData();
      this.render();
      this.attachEventListeners();
      this.unsubscribeStore = this.store.subscribe((changedIds) => this.onStoreChange(changedIds));
      debugLog("ManagePoints initialized");
      if (navigator.onLine) {
        await Promise.all([
          this.refreshPointsData(),
          this.loadTodayAttendance(),
        ]);
      }
    } catch (error) {
      debugError("Error initializing manage points:", error);
      this.renderError();
    }
  }

  async preloadManagePointsData() {
    try {
      const cachedData = await getCachedData(POINTS_CACHE_KEY);
      if (cachedData) {
        this.applyPointsData(this.normalizePointsData(cachedData));

        // Try to get fresh points data, but if offline, gracefully
        // use the cached data that was already loaded above.
        try {
          const freshData = await getParticipants();
          if (freshData.success) {
            this.participants = normalizeParticipantList(
              freshData.data || freshData.participants || []
            );
            debugLog("Fresh participants loaded:", this.participants.length, "records");
            this.store.load(this.participants, this.groups);
            this.organizeParticipants();
          }
        } catch (fetchError) {
          debugWarn(
            "Could not fetch fresh participants (possibly offline), using cached data:",
            fetchError.message,
          );
        }
      } else {
        await this.fetchData();
      }
    } catch (error) {
      debugError("Error preloading manage points data:", error);
      this.participants = [];
      this.groups = [];
      this.groupedParticipants = {};
      this.unassignedParticipants = [];
      throw error;
    }
  }

  /**
   * Accept any historical shape stored under the points cache key (or the raw
   * GET /v1/points response) and return the canonical {participants, groups}.
   * Older builds cached the raw API response here, which broke readers that
   * expected the page's own structure.
   */
  normalizePointsData(data) {
    const source = data?.data && !data.participants ? data.data : (data || {});
    const participants = normalizeParticipantList(
      source.participants || source.names || []
    );
    const groups = (source.groups || []).map((group) => ({
      ...group,
      total_points: Number(group.total_points) || 0,
    }));
    return { participants, groups };
  }

  applyPointsData({ participants, groups }) {
    this.participants = participants;
    this.groups = groups;
    this.store.load(this.participants, this.groups);
    this.organizeParticipants();
  }

  async fetchData() {
    try {
      this.participants = [];
      this.groups = [];
      this.groupedParticipants = {};
      this.unassignedParticipants = [];

      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (groupsResponse.success && Array.isArray(groupsResponse.data)) {
        this.groups = groupsResponse.data;
      } else if (groupsResponse.success && Array.isArray(groupsResponse.groups)) {
        // Backward compatibility
        this.groups = groupsResponse.groups;
      } else {
        debugError("Unexpected groups data structure:", groupsResponse);
        this.groups = [];
      }

      const participantsList =
        participantsResponse.data || participantsResponse.participants;
      if (participantsResponse.success && Array.isArray(participantsList)) {
        this.participants = normalizeParticipantList(participantsList);
      } else {
        debugError("Unexpected participants data structure:", participantsResponse);
        this.participants = [];
      }

      this.store.load(this.participants, this.groups);
      this.organizeParticipants();
      await this.updateCache();
    } catch (error) {
      debugError("Error fetching manage points data:", error);
      throw error;
    }
  }

  /**
   * Load today's attendance so group awards can skip absent/excused members
   * locally, matching what the server will do. Non-fatal: without it the
   * server response still corrects the totals.
   */
  async loadTodayAttendance() {
    try {
      const response = await getAttendance(getTodayISO());
      const records = Array.isArray(response?.data) ? response.data : [];
      this.todayAttendance = {};
      records.forEach((record) => {
        const status = record.status || record.attendance_status;
        if (record.participant_id && status) {
          this.todayAttendance[record.participant_id] = status;
        }
      });
      debugLog("Loaded today's attendance:", Object.keys(this.todayAttendance).length, "records");
    } catch (error) {
      debugWarn("Could not load today's attendance:", error.message);
      this.todayAttendance = {};
    }
  }

  render() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <h1>${translate("manage_points")}</h1>
      <div class="controls-container">
        <div class="sort-options">
          <button class="sort-btn" data-sort="name" title="${translate("sort_by_name")}">👤</button>
          <button class="sort-btn active" data-sort="group" title="${translate("sort_by_group")}">👥</button>
          <button class="sort-btn" data-sort="points" title="${translate("sort_by_points")}">🏆</button>
          <button class="filter-toggle-btn" id="filter-toggle" data-archive-safe title="${translate("filter_by_group")}">🔍</button>
        </div>
        <div class="filter-options hidden" id="filter-container">
          <label for="group-filter">${translate("filter_by_group")}:</label>
          <select id="group-filter" data-archive-safe>
            <option value="">${translate("all_groups")}</option>
            ${this.groups
        .map(
          (group) => `<option value="${group.id}">${group.name}</option>`,
        )
        .join("")}
          </select>
        </div>
      </div>
      <div id="points-list"></div>
      <div class="fixed-bottom">
        <button class="point-btn add" data-points="1">+1</button>
        <button class="point-btn add" data-points="3">+3</button>
        <button class="point-btn add" data-points="5">+5</button>
        <button class="point-btn remove" data-points="-1">-1</button>
        <button class="point-btn remove" data-points="-3">-3</button>
        <button class="point-btn remove" data-points="-5">-5</button>
      </div>
    `;
    setContent(document.getElementById("app"), content);
    this.renderList();
  }

  /**
   * Render the list according to the current sort, entirely from state.
   * Never reshuffles existing DOM (the old outerHTML approach dropped group
   * headers and selections).
   */
  renderList() {
    const pointsList = document.getElementById("points-list");
    if (!pointsList) {
      return;
    }

    if (this.currentSort.key === "group") {
      setContent(pointsList, this.renderGroupedList() + this.renderUnassignedParticipants());
    } else {
      setContent(pointsList, this.renderFlatList());
    }

    this.applyFilter();
    this.applySelection();
  }

  renderGroupedList() {
    return this.groups
      .map(
        (group) => `
        <div class="group-header" data-group-id="${group.id}" data-type="group">
          <span class="group-header__name">${group.name}</span>
          <span class="group-header__points">${translate("group_points")}: ${this.store.getGroupTotal(group.id)}</span>
        </div>
        <div class="group-content">
          ${this.renderParticipantsForGroup(group.id)}
          <div class="group-points" id="group-points-${group.id}">
            ${translate("total_points")}: ${this.getGroupIndividualTotal(group.id)}
          </div>
        </div>
      `,
      )
      .join("");
  }

  renderFlatList() {
    const sorted = [...this.participants].sort((a, b) => {
      let comparison = 0;
      if (this.currentSort.key === "name") {
        comparison = a.first_name.localeCompare(b.first_name);
      } else {
        comparison = this.store.getParticipantTotal(a.id) - this.store.getParticipantTotal(b.id);
      }
      return this.currentSort.order === "asc" ? comparison : -comparison;
    });

    return `
      <div class="group-content">
        ${sorted.map((participant) => this.renderParticipantItem(participant)).join("")}
      </div>
    `;
  }

  renderUnassignedParticipants() {
    if (this.unassignedParticipants.length === 0) {
      return `<h2>${translate("unassigned_participants")}</h2><p>${translate(
        "no_unassigned_participants",
      )}</p>`;
    }

    return `
      <h2>${translate("unassigned_participants")}</h2>
      <div class="group-content">
        ${this.unassignedParticipants
        .map((participant) => this.renderParticipantItem(participant))
        .join("")}
      </div>
    `;
  }

  renderParticipantsForGroup(groupId) {
    const groupParticipants = this.participants.filter(
      (p) => String(p.group_id) === String(groupId),
    );
    if (groupParticipants.length === 0) {
      return `<p>${translate("no_participants_in_group")}</p>`;
    }

    return groupParticipants
      .map((participant) => this.renderParticipantItem(participant))
      .join("");
  }

  renderParticipantItem(participant) {
    return `
      <div class="list-item" data-participant-id="${participant.id}" data-type="individual"
        data-group-id="${participant.group_id ?? "null"}">
        <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
        <span class="participant-points" id="name-points-${participant.id}">${this.store.getParticipantTotal(participant.id)}</span>
      </div>
    `;
  }

  getGroupIndividualTotal(groupId) {
    const memberIds = this.participants
      .filter((participant) => String(participant.group_id) === String(groupId))
      .map((participant) => participant.id);
    return this.store.getMembersTotal(memberIds);
  }

  // Event delegation for attaching listeners to dynamically added elements
  attachEventListeners() {
    const sortContainer = document.querySelector(".sort-options");
    const pointsList = document.getElementById("points-list");
    const filterDropdown = document.getElementById("group-filter");
    const filterToggle = document.getElementById("filter-toggle");
    const fixedBottom = document.querySelector(".fixed-bottom");

    if (sortContainer) {
      sortContainer.addEventListener("click", (event) => {
        const target = event.target;
        if (target.tagName === "BUTTON" && target.dataset.sort) {
          this.sortItems(target.dataset.sort);
        }
      });
    }

    if (pointsList) {
      pointsList.addEventListener("click", (event) => {
        const item = event.target.closest(".list-item, .group-header");
        if (item) {
          this.handleItemClick(item);
        }
      });
    }

    if (filterDropdown) {
      filterDropdown.addEventListener("change", (event) => {
        this.currentFilter = event.target.value;
        this.applyFilter();
      });
    }

    if (filterToggle) {
      filterToggle.addEventListener("click", () => {
        this.toggleFilter();
      });
    }

    if (fixedBottom) {
      fixedBottom.addEventListener("click", (event) => {
        const target = event.target;
        if (target.classList.contains("point-btn")) {
          this.applyPointAction(parseInt(target.dataset.points));
        }
      });
    }
  }

  handleItemClick(item) {
    const type = item.dataset.type;
    const id = type === "group" ? item.dataset.groupId : item.dataset.participantId;

    if (this.selected && this.selected.type === type && this.selected.id === id) {
      this.selected = null; // toggle off
    } else {
      this.selected = { type, id };
    }
    this.applySelection();
  }

  /**
   * Reflect this.selected in the DOM. Safe to call after any re-render.
   */
  applySelection() {
    document.querySelectorAll(".list-item.selected, .group-header.selected").forEach((el) => {
      el.classList.remove("selected");
    });
    if (!this.selected) {
      return;
    }
    const selector = this.selected.type === "group"
      ? `.group-header[data-group-id="${this.selected.id}"]`
      : `.list-item[data-participant-id="${this.selected.id}"]`;
    document.querySelector(selector)?.classList.add("selected");
  }

  /**
   * Member ids eligible for a group award, mirroring the server rule:
   * if attendance was taken today, only present/late members get points;
   * if no attendance exists at all, everyone does.
   */
  getEligibleGroupMemberIds(groupId) {
    const memberIds = this.participants
      .filter((p) => String(p.group_id) === String(groupId))
      .map((p) => p.id);

    const attendanceTaken = Object.keys(this.todayAttendance).length > 0;
    if (!attendanceTaken) {
      return { eligible: memberIds, skipped: [] };
    }

    const eligible = [];
    const skipped = [];
    memberIds.forEach((id) => {
      const status = this.todayAttendance[id];
      if (status === "present" || status === "late") {
        eligible.push(id);
      } else {
        skipped.push(id);
      }
    });
    return { eligible, skipped };
  }

  /**
   * Handle a +N / -N button press for the current selection
   */
  async applyPointAction(points) {
    if (!this.selected) {
      this.app.showMessage(
        translate("please_select_group_or_individual"),
        "error",
      );
      return;
    }

    const { type, id } = this.selected;

    if (type === "no-group") {
      this.app.showMessage(
        translate("cannot_assign_points_to_no_group"),
        "error",
      );
      return;
    }

    const today = getTodayISO();
    let txn;

    if (type === "group") {
      const { eligible, skipped } = this.getEligibleGroupMemberIds(id);
      if (skipped.length > 0) {
        this.app.showMessage(
          translate("points_skipped_absent_participants").replace("{{count}}", skipped.length),
          "info"
        );
      }
      txn = {
        participantDeltas: Object.fromEntries(eligible.map((memberId) => [memberId, points])),
        groupDeltas: { [id]: points },
      };
    } else {
      txn = {
        participantDeltas: { [id]: points },
        groupDeltas: {},
      };
    }

    this.store.applyOptimistic(txn);
    this.showPointChangeAnimation(this.selectedElement(), points);

    this.updateQueue.push({
      payload: {
        type,
        id,
        points,
        timestamp: new Date().toISOString(),
        // Backend filters group awards by attendance for this date
        date: type === "group" ? today : undefined,
      },
      txn,
    });

    await this.flushQueue();
  }

  selectedElement() {
    if (!this.selected) {
      return null;
    }
    const selector = this.selected.type === "group"
      ? `.group-header[data-group-id="${this.selected.id}"]`
      : `.list-item[data-participant-id="${this.selected.id}"]`;
    return document.querySelector(selector);
  }

  /**
   * Send queued updates as one batch, one batch in flight at a time.
   * Responses carry absolute totals, so serializing batches guarantees the
   * store's base totals only ever move forward.
   */
  async flushQueue() {
    if (this.batchInFlight || this.updateQueue.length === 0) {
      return;
    }

    const batch = this.updateQueue.splice(0);
    const payloads = batch.map((entry) => entry.payload);
    const txns = batch.map((entry) => entry.txn);
    this.batchInFlight = true;
    // Controls whether the finally block should start the next batch.
    // Set to false in the success path so the next batch can start before
    // the cache update (which uses IndexedDB macrotask callbacks).
    let flushInFinally = true;

    try {
      // Routes through makeApiRequest → OfflineManager; when offline this
      // queues the mutation and returns {success: true, queued: true}
      const data = await updatePoints(payloads);

      if (data.queued) {
        debugLog("Batch update queued for offline sync:", payloads.length, "updates");
        this.store.foldBatch(txns);
        await this.updateCache();
        return;
      }

      const serverUpdates = data.data?.updates || data.updates || [];
      this.store.confirmBatch(txns, serverUpdates);

      const totalSkipped = serverUpdates.reduce(
        (sum, update) => sum + (update.skippedCount || 0), 0
      );
      if (totalSkipped > 0) {
        debugLog(`Server skipped ${totalSkipped} participants (absent/excused)`);
      }

      // Release the batch lock and start the next queued batch BEFORE awaiting
      // updateCache(). IndexedDB uses macrotask (setImmediate) callbacks, so
      // awaiting it here would delay the next batch past the microtask drain
      // window. Flushing the next batch inline (before updateCache) keeps
      // batch serialisation within the microtask queue.
      this.batchInFlight = false;
      flushInFinally = false;
      if (this.updateQueue.length > 0) {
        await this.flushQueue();
      }
      await this.updateCache();
    } catch (error) {
      debugError("Error in batch update:", error);

      // Network error (went offline mid-request): queue for offline sync
      if (error instanceof TypeError || !navigator.onLine) {
        try {
          const { offlineManager } = await import("./modules/OfflineManager.js");
          await offlineManager.queueMutation(
            getApiUrl("api/v1/points"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...getAuthHeader(),
                "x-organization-id": getCurrentOrganizationId(),
              },
              body: JSON.stringify(payloads),
            }
          );
          debugLog("Batch update queued for offline sync (network error fallback):", payloads.length, "updates");
        } catch (queueError) {
          debugError("Failed to queue offline mutation:", queueError);
          // Point awards are additive and cannot be replayed safely until the
          // endpoint implements transactional idempotency. Restore the exact
          // pre-click state instead of showing totals that were never saved.
          this.store.rollbackBatch(txns);
          await this.updateCache();
          this.app.showMessage(
            queueError.message || translate("offline.writeUnavailable"),
            "error",
          );
          return;
        }
        this.store.foldBatch(txns);
        await this.updateCache();
      } else {
        // Server error: undo the optimistic deltas
        this.store.rollbackBatch(txns);
        this.app.showMessage(
          `${translate("error_updating_points")}: ${error.message}`,
          "error"
        );
      }
    } finally {
      this.batchInFlight = false;
      if (flushInFinally && this.updateQueue.length > 0) {
        await this.flushQueue();
      }
    }
  }

  /**
   * Store change listener: update only the affected DOM nodes, always from
   * store values. The DOM is never read back to compute totals.
   */
  onStoreChange(changedIds) {
    const touchedGroups = new Set();

    changedIds.forEach((entityId) => {
      const [kind, id] = entityId.split(":");
      if (kind === "participant") {
        const pointsElement = document.getElementById(`name-points-${id}`);
        if (pointsElement) {
          pointsElement.textContent = `${this.store.getParticipantTotal(id)}`;
          this.addHighlightEffect(pointsElement.closest(".list-item"));
        }
        const participant = this.participants.find((p) => String(p.id) === String(id));
        if (participant) {
          participant.total_points = this.store.getParticipantTotal(id);
          if (participant.group_id) {
            touchedGroups.add(String(participant.group_id));
          }
        }
      } else if (kind === "group") {
        touchedGroups.add(id);
        const header = document.querySelector(`.group-header[data-group-id="${id}"] .group-header__points`);
        if (header) {
          header.textContent = `${translate("group_points")}: ${this.store.getGroupTotal(id)}`;
          this.addHighlightEffect(header.closest(".group-header"));
        }
        const group = this.groups.find((g) => String(g.id) === String(id));
        if (group) {
          group.total_points = this.store.getGroupTotal(id);
        }
      }
    });

    // Refresh member-sum footers of affected groups
    touchedGroups.forEach((groupId) => {
      const footer = document.getElementById(`group-points-${groupId}`);
      if (footer) {
        footer.textContent = `${translate("total_points")}: ${this.getGroupIndividualTotal(groupId)}`;
      }
    });
  }

  /**
   * Persist canonical state (with current store totals) to the shared cache
   */
  async updateCache() {
    try {
      const participants = this.participants.map((participant) => ({
        ...participant,
        total_points: this.store.getParticipantTotal(participant.id),
      }));
      const groups = this.groups.map((group) => ({
        ...group,
        total_points: this.store.getGroupTotal(group.id),
      }));
      await setCachedData(
        POINTS_CACHE_KEY,
        {
          participants,
          groups,
          groupedParticipants: this.groupedParticipants,
          unassignedParticipants: this.unassignedParticipants,
        },
        CONFIG.CACHE_DURATION.SHORT,
      );
      debugLog("Cache updated with new points data.");
    } catch (error) {
      debugError("Error updating cache:", error);
    }
  }

  showPointChangeAnimation(element, points) {
    if (!element) {
      return;
    }
    const changeElement = document.createElement("span");
    changeElement.textContent = points > 0 ? `+${points}` : points;
    changeElement.className = "point-change";
    changeElement.style.color = points > 0 ? "green" : "red";
    element.appendChild(changeElement);

    const ANIMATION_DURATION_MS = 2000;
    setTimeout(() => {
      changeElement.remove();
    }, ANIMATION_DURATION_MS);

    this.addHighlightEffect(element);
  }

  addHighlightEffect(element) {
    if (!element) {
      return;
    }
    const HIGHLIGHT_DURATION_MS = 500;
    element.classList.add("highlight");
    setTimeout(() => {
      element.classList.remove("highlight");
    }, HIGHLIGHT_DURATION_MS);
  }

  sortItems(key) {
    debugLog(`Sorting by ${key}`);

    if (this.currentSort.key === key) {
      this.currentSort.order =
        this.currentSort.order === "asc" ? "desc" : "asc";
    } else {
      this.currentSort.key = key;
      this.currentSort.order = "asc";
    }

    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`.sort-btn[data-sort="${key}"]`)?.classList.add('active');

    this.renderList();
  }

  toggleFilter() {
    const filterContainer = document.getElementById("filter-container");
    if (filterContainer) {
      filterContainer.classList.toggle("hidden");
    }
  }

  applyFilter() {
    const groupId = this.currentFilter;
    document.querySelectorAll(".group-header").forEach((header) => {
      header.style.display =
        groupId === "" || header.dataset.groupId === groupId ? "" : "none";
    });
    document.querySelectorAll(".list-item").forEach((item) => {
      item.style.display =
        groupId === "" || item.dataset.groupId === groupId ? "" : "none";
    });
  }

  async refreshPointsData() {
    try {
      const cachedData = await getCachedData(POINTS_CACHE_KEY);
      if (cachedData) {
        debugLog("Using cached points data");
        this.applyPointsData(this.normalizePointsData(cachedData));
        this.renderList();
        return;
      }

      debugLog("Fetching fresh points data");
      const data = await API.getNoCache('v1/points');
      const normalized = this.normalizePointsData(data);

      // The points endpoint returns totals but not role/leader flags, so merge
      // totals into the richer participant records when we have them
      if (this.participants.length > 0) {
        const totalsById = new Map(
          normalized.participants.map((p) => [String(p.id), Number(p.total_points) || 0])
        );
        this.participants.forEach((participant) => {
          if (totalsById.has(String(participant.id))) {
            participant.total_points = totalsById.get(String(participant.id));
          }
        });
        this.groups = normalized.groups.length > 0 ? normalized.groups : this.groups;
        this.store.load(this.participants, this.groups);
        this.organizeParticipants();
      } else {
        this.applyPointsData(normalized);
      }

      await this.updateCache();
      this.renderList();
    } catch (error) {
      debugError("Error fetching points data:", error);
      if (!navigator.onLine) {
        const cachedData = await getCachedDataIgnoreExpiration(POINTS_CACHE_KEY);
        if (cachedData) {
          debugLog("Using stale cached data due to offline status");
          this.applyPointsData(this.normalizePointsData(cachedData));
          this.renderList();
          return;
        }
      }
      throw error;
    }
  }

  organizeParticipants() {
    if (!Array.isArray(this.groups)) {
      this.groups = [];
    }
    if (!Array.isArray(this.participants)) {
      this.participants = [];
    }

    this.groupedParticipants = {};
    this.groups.forEach((group) => {
      this.groupedParticipants[group.id] = [];
    });

    this.unassignedParticipants = [];

    this.participants.forEach((participant) => {
      if (
        participant.group_id &&
        this.groupedParticipants[participant.group_id]
      ) {
        this.groupedParticipants[participant.group_id].push(participant);
      } else {
        this.unassignedParticipants.push(participant);
      }
    });

    Object.values(this.groupedParticipants).forEach((groupParticipants) => {
      groupParticipants.sort((a, b) => {
        if (a.first_leader !== b.first_leader)
          return b.first_leader ? 1 : -1;
        if (a.second_leader !== b.second_leader)
          return b.second_leader ? 1 : -1;
        return a.first_name.localeCompare(b.first_name);
      });
    });

    this.unassignedParticipants.sort((a, b) =>
      a.first_name.localeCompare(b.first_name),
    );
  }

  renderError() {
    const errorMessage = `
        <h1>${translate("error")}</h1>
        <p>${translate("error_loading_manage_points")}</p>
    `;
    setContent(document.getElementById("app"), errorMessage);
  }
}
