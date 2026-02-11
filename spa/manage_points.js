import {
  getParticipants,
  getGroups,
  updatePoints,
  getAuthHeader,
  getCurrentOrganizationId,
  getApiUrl,
  CONFIG,
} from "./ajax-functions.js";
import { translate } from "./app.js";
import { debugLog, debugError, debugWarn } from "./utils/DebugUtils.js";
import {
  saveOfflineData,
  getOfflineData,
  clearOfflineData,
  openDB,
  setCachedData,
  getCachedData,
  getCachedDataIgnoreExpiration,
  clearPointsRelatedCaches,
} from "./indexedDB.js";
import { canViewPoints } from "./utils/PermissionUtils.js";
import { normalizeParticipantList } from "./utils/ParticipantRoleUtils.js";
import { OptimisticUpdateManager, generateOptimisticId } from "./utils/OptimisticUpdateManager.js";
import { setContent } from "./utils/DOMUtils.js";

export class ManagePoints {
  constructor(app) {
    this.app = app;
    this.selectedItem = null;
    this.pendingUpdates = [];
    this.updateTimeout = null;
    this.currentSort = { key: "group", order: "asc" };
    this.currentFilter = "";
    this.optimisticManager = new OptimisticUpdateManager();
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
      debugLog("init called");
      if (navigator.onLine) {
        await this.refreshPointsData();
      }
    } catch (error) {
      debugError("Error initializing manage points:", error);
      this.renderError();
    }
  }

  async preloadManagePointsData() {
    try {
      const cachedData = await getCachedData("manage_points_data");
      if (cachedData) {
        // Initialize arrays
        this.participants = normalizeParticipantList(
          cachedData.participants || []
        );
        this.groups = cachedData.groups || [];
        this.groupedParticipants = cachedData.groupedParticipants || {};
        this.unassignedParticipants = cachedData.unassignedParticipants || [];

        // Try to get fresh points data, but if offline, gracefully
        // use the cached data that was already loaded above.
        try {
          const freshData = await getParticipants();
          if (freshData.success) {
            // Support both new format (data) and old format (participants)
            this.participants = normalizeParticipantList(
              freshData.data || freshData.participants || []
            );
            debugLog(
              "Fresh participants loaded:",
              this.participants.length,
              "records",
            );
            // Reorganize with fresh data
            this.organizeParticipants();
          }
        } catch (fetchError) {
          debugWarn(
            "Could not fetch fresh participants (possibly offline), using cached data:",
            fetchError.message,
          );
          // Cached data was already assigned above, so just organize it
          this.organizeParticipants();
        }
      } else {
        await this.fetchData();
      }
    } catch (error) {
      debugError("Error preloading manage points data:", error);
      // Initialize with empty arrays/objects if there's an error
      this.participants = [];
      this.groups = [];
      this.groupedParticipants = {};
      this.unassignedParticipants = [];
      throw error;
    }
  }

  async fetchData() {
    try {
      // Initialize arrays to prevent undefined errors
      this.participants = [];
      this.groups = [];
      this.groupedParticipants = {};
      this.unassignedParticipants = [];

      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      // Handle groups first
      if (groupsResponse.success && Array.isArray(groupsResponse.data)) {
        this.groups = groupsResponse.data;
      } else if (
        groupsResponse.success &&
        Array.isArray(groupsResponse.groups)
      ) {
        // Backward compatibility
        this.groups = groupsResponse.groups;
      } else {
        debugError("Unexpected groups data structure:", groupsResponse);
        this.groups = []; // Ensure groups is at least an empty array
      }

      // Then handle participants
      if (
        participantsResponse.success &&
        Array.isArray(participantsResponse.data)
      ) {
        this.participants = normalizeParticipantList(participantsResponse.data);
      } else if (
        participantsResponse.success &&
        Array.isArray(participantsResponse.participants)
      ) {
        // Backward compatibility
        this.participants = normalizeParticipantList(
          participantsResponse.participants
        );
      } else {
        debugError(
          "Unexpected participants data structure:",
          participantsResponse,
        );
        this.participants = []; // Ensure participants is at least an empty array
      }

      // Only organize participants after both are loaded
      this.organizeParticipants();

      // Cache all participant data including points
      const participantsToCache = this.participants.map((participant) => ({
        id: participant.id,
        first_name: participant.first_name,
        last_name: participant.last_name,
        group_id: participant.group_id,
        group_name: participant.group_name,
        first_leader: participant.first_leader,
        second_leader: participant.second_leader,
        is_leader: participant.first_leader,
        is_second_leader: participant.second_leader,
        total_points: participant.total_points || 0,
      }));

      await setCachedData(
        "manage_points_data",
        {
          participants: participantsToCache,
          groups: this.groups,
          groupedParticipants: this.groupedParticipants,
          unassignedParticipants: this.unassignedParticipants,
        },
        CONFIG.CACHE_DURATION.SHORT,
      ); // Cache for 5 minutes (was 24 hours - too long for points data)
    } catch (error) {
      debugError("Error fetching manage points data:", error);
      throw error;
    }
  }

  render() {
    const content = `
      <a href="/dashboard" class="button button--ghost">← ${translate("back")}</a>
      <h1>${translate("manage_points")}</h1>
      <div class="controls-container">
        <div class="sort-options">
          <button class="sort-btn" data-sort="name" title="${translate("sort_by_name")}">👤</button>
          <button class="sort-btn" data-sort="group" title="${translate("sort_by_group")}">👥</button>
          <button class="sort-btn" data-sort="points" title="${translate("sort_by_points")}">🏆</button>
          <button class="filter-toggle-btn" id="filter-toggle" title="${translate("filter_by_group")}">🔍</button>
        </div>
        <div class="filter-options hidden" id="filter-container">
          <label for="group-filter">${translate("filter_by_group")}:</label>
          <select id="group-filter">
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
    // Render points list sorted by group initially
    this.sortByGroup(); // Call the sort by group function here

    // Mark the group button as active initially
    setTimeout(() => {
      const groupBtn = document.querySelector('.sort-btn[data-sort="group"]');
      if (groupBtn) {
        groupBtn.classList.add('active');
      }
    }, 0);
  }

  renderPointsList() {
    return this.groups
      .filter((group) => {
        // Check if group has participants or non-zero points
        const groupParticipants = this.participants.filter(
          (p) => p.group_id == group.id,
        );
        return groupParticipants.length > 0 || group.total_points > 0;
      })
      .map(
        (group) => `
            <div class="group-header" data-group-id="${
              group.id
            }" data-type="group" data-points="${group.total_points}">
              <span>${group.name}</span>
              <span id="group-points-${group.id}">${group.total_points}</span>
            </div>
            <div class="group-content">
              ${this.renderParticipantsForGroup(group.id)}
            </div>
          `,
      )
      .join("");
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
          .map(
            (participant) => `
              <div class="list-item" data-participant-id="${participant.id}"
                data-type="individual"
                data-group-id="null" data-points="${participant.total_points}"
                data-name="${participant.first_name}">
                <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
                <span class="participant-points" id="name-points-${participant.id}">${participant.total_points}</span>
              </div>
          `,
          )
          .join("")}
      </div>
    `;
  }

  renderParticipantsForGroup(groupId) {
    const groupParticipants = this.participants.filter(
      (p) => p.group_id == groupId,
    );
    if (groupParticipants.length === 0) {
      return `<p>${translate("no_participants_in_group")}</p>`;
    }

    return groupParticipants
      .map(
        (participant) => `
          <div class="list-item" data-participant-id="${
            participant.id
          }" data-type="individual"
            data-group-id="${participant.group_id}" data-points="${
              participant.total_points
            }"
            data-name="${participant.first_name}">
            <span class="participant-name">${participant.first_name} ${participant.last_name}</span>
            <span class="participant-points" id="name-points-${participant.id}">${participant.total_points}</span>
          </div>
        `,
      )
      .join("");
  }

  // Event delegation for attaching listeners to dynamically added elements
  attachEventListeners() {
    const sortContainer = document.querySelector(".sort-options");
    const pointsList = document.getElementById("points-list");
    const filterDropdown = document.getElementById("group-filter");
    const filterToggle = document.getElementById("filter-toggle");
    const fixedBottom = document.querySelector(".fixed-bottom"); // Ensure we target .fixed-bottom

    // Check if these elements exist before adding listeners
    if (sortContainer) {
      // Add listener for sorting buttons
      sortContainer.addEventListener("click", (event) => {
        const target = event.target;
        if (target.tagName === "BUTTON" && target.dataset.sort) {
          this.sortItems(target.dataset.sort);
        }
      });
    }

    if (pointsList) {
      // Add listener for point buttons and list items
      pointsList.addEventListener("click", (event) => {
        const target = event.target;

        // Handle point button click
        if (target.classList.contains("point-btn")) {
          this.handlePointButtonClick(target);
        }

        // Handle list item or group header click
        else if (target.closest(".list-item, .group-header")) {
          this.handleItemClick(target.closest(".list-item, .group-header"));
        }
      });
    }

    if (filterDropdown) {
      // Add change listener for group filter dropdown
      filterDropdown.addEventListener("change", (event) => {
        this.filterByGroup(event.target.value);
      });
    }

    if (filterToggle) {
      // Add listener for filter toggle button
      filterToggle.addEventListener("click", () => {
        this.toggleFilter();
      });
    }

    // Add listener for point buttons in the fixed-bottom section
    if (fixedBottom) {
      fixedBottom.addEventListener("click", (event) => {
        const target = event.target;
        if (target.classList.contains("point-btn")) {
          this.handlePointButtonClick(target); // Call point button handler
        }
      });
    }
  }

  handleItemClick(item) {
    if (this.selectedItem) {
      this.selectedItem.classList.remove("selected");
    }
    item.classList.add("selected");
    this.selectedItem = item;
  }

  async handlePointButtonClick(btn) {
    const points = parseInt(btn.dataset.points);
    await this.updatePoints(points);
  }

  async updatePoints(points) {
    if (!this.selectedItem) {
      this.app.showMessage(
        translate("please_select_group_or_individual"),
        "error",
      );
      return;
    }

    const type = this.selectedItem.dataset.type;
    const id =
      type === "group"
        ? this.selectedItem.dataset.groupId
        : this.selectedItem.dataset.participantId;

    if (type === "no-group") {
      this.app.showMessage(
        translate("cannot_assign_points_to_no_group"),
        "error",
      );
      return;
    }

    const updateKey = `points-${type}-${id}-${Date.now()}`;
    // Include current date for group points - backend uses this to filter by attendance
    const today = new Date().toISOString().split('T')[0];
    const updateData = {
      type,
      id,
      points,
      timestamp: new Date().toISOString(),
      date: type === 'group' ? today : undefined, // Only include date for group points
    };

    // Use OptimisticUpdateManager for instant feedback with rollback capability
    await this.optimisticManager.execute(updateKey, {
      optimisticFn: () => {
        // Save current state for rollback
        const rollbackState = {
          participants: JSON.parse(JSON.stringify(this.participants)),
          groups: JSON.parse(JSON.stringify(this.groups)),
        };

        // Provide immediate visual feedback
        this.updatePointsUI(type, id, points);

        // Add to pending updates
        this.pendingUpdates.push(updateData);

        return rollbackState;
      },

      apiFn: async () => {
        // Send batch update to server
        return await this.sendBatchUpdate();
      },

      successFn: (result) => {
        // Server response already applied by sendBatchUpdate
        // which calls updateGroupPoints/updateIndividualPoints
        debugLog("Points update successful:", result);
      },

      rollbackFn: (rollbackState, error) => {
        // Revert to previous state
        this.participants = rollbackState.participants;
        this.groups = rollbackState.groups;

        // Remove the failed update from pending updates
        const index = this.pendingUpdates.findIndex(
          (u) => u.type === type && u.id === id && u.points === points
        );
        if (index !== -1) {
          this.pendingUpdates.splice(index, 1);
        }

        // Re-render to show original values
        this.sortByGroup();

        // Show error message
        this.app.showMessage(
          `${translate("error_updating_points")}: ${error.message}`,
          "error"
        );
      },

      onError: (error) => {
        debugError("Error updating points:", error);
      }
    });
  }

  async sendBatchUpdate() {
    if (this.pendingUpdates.length === 0) return;

    const updates = [...this.pendingUpdates];
    this.pendingUpdates = [];

    if (navigator.onLine) {
      try {
        const response = await fetch(getApiUrl("update-points"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
            "x-organization-id": getCurrentOrganizationId(),
          },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.status === "error") {
          throw new Error(data.message || "Unknown error occurred");
        }

        debugLog("Batch update successful:", data);

        // Apply server updates
        // Support both new format (data.data.updates) and old format (data.updates)
        const serverUpdates = data.data?.updates || data.updates;
        if (serverUpdates && Array.isArray(serverUpdates)) {
          let totalSkipped = 0;
          serverUpdates.forEach((update) => {
            if (update.type === "group") {
              this.updateGroupPoints(
                update.id,
                update.totalPoints,
                update.memberIds,
                update.memberTotals,
              );
              // Track skipped participants for group points
              if (update.skippedCount > 0) {
                totalSkipped += update.skippedCount;
                debugLog(`Group ${update.id}: ${update.skippedCount} participants skipped (absent/excused)`);
              }
            } else {
              this.updateIndividualPoints(update.id, update.totalPoints);
            }
          });

          // Show info message if participants were skipped
          if (totalSkipped > 0) {
            this.app.showMessage(
              translate("points_skipped_absent_participants").replace("{{count}}", totalSkipped),
              "info"
            );
          }
        } else {
          debugLog("Unexpected response format:", data);
        }

        // Clear all points-related caches so dashboard and other pages get fresh data
        await clearPointsRelatedCaches();

        // Update the local cache with the latest data
        await this.updateCache();
      } catch (error) {
        debugError("Error in batch update:", error);
        // If there's an error, add the updates back to the pending list
        this.pendingUpdates.push(...updates);

        // Show an error message to the user
        alert(`${translate("error_updating_points")}: ${error.message}`);
      }
    } else {
      // Save updates for later sync
      updates.forEach((update) => saveOfflineData("updatePoints", update));
    }
  }

  updateGroupPoints(groupId, totalPoints, memberIds, memberTotals) {
    debugLog(
      `[updateGroupPoints] Updating group ${groupId} to ${totalPoints} points, members:`,
      memberIds,
      "memberTotals:",
      memberTotals,
    );
    const groupElement = document.querySelector(
      `.group-header[data-group-id="${groupId}"]`,
    );
    if (groupElement) {
      // Get the group name from the internal data
      const group = this.groups.find((g) => g.id == groupId);
      const groupName = group
        ? group.name
        : groupElement.textContent.split(" - ")[0];

      // Update the main group header display
      const pointsDisplay = `${groupName} - ${totalPoints} `;
      setContent(groupElement, pointsDisplay);
      groupElement.dataset.points = totalPoints;
      this.addHighlightEffect(groupElement);

      // Update the group points total element if it exists
      const groupPointsElement = document.querySelector(
        `#group-points-${groupId}`,
      );
      if (groupPointsElement) {
        groupPointsElement.textContent = `${translate("total_points")}: ${totalPoints}`;
      }

      // Update the group's total_points in our data
      if (group) {
        group.total_points = totalPoints;
      }
    } else {
      debugLog(
        `[updateGroupPoints] Could not find element for group ${groupId}`,
      );
    }

    // Update each member's individual points from the memberTotals array
    if (memberTotals && Array.isArray(memberTotals)) {
      memberTotals.forEach((member) => {
        this.updateIndividualPoints(member.id, member.totalPoints);
      });
    }
  }

  updateIndividualPoints(participantId, totalPoints) {
    debugLog(
      `[updateIndividualPoints] Updating participant ${participantId} to ${totalPoints} points`,
    );
    const nameElement = document.querySelector(
      `.list-item[data-participant-id="${participantId}"]`,
    );
    if (nameElement) {
      const pointsElement = nameElement.querySelector(
        `#name-points-${participantId}`,
      );
      if (pointsElement) {
        pointsElement.textContent = `${totalPoints} `;
      }
      nameElement.dataset.points = totalPoints;
      this.addHighlightEffect(nameElement);
    } else {
      debugLog(
        `[updateIndividualPoints] Could not find element for participant ${participantId}`,
      );
    }

    // Update the participant's total_points in our internal data
    const participant = this.participants.find((p) => p.id == participantId);
    if (participant) {
      participant.total_points = totalPoints;
    }
  }

  updatePointsUI(type, id, points) {
    const selector =
      type === "group"
        ? `.group-header[data-group-id="${id}"]`
        : `.list-item[data-participant-id="${id}"]`;
    const element = document.querySelector(selector);
    if (!element) return;

    const currentPoints = parseInt(element.dataset.points) || 0;
    const newPoints = currentPoints + points;

    if (type === "group") {
      // Update group points
      const groupParticipants = this.participants.filter(
        (p) => p.group_id == id,
      );
      groupParticipants.forEach((participant) => {
        const memberElement = document.querySelector(
          `.list-item[data-participant-id="${participant.id}"]`,
        );
        if (memberElement) {
          const memberPointsElement = memberElement.querySelector(
            `#name-points-${participant.id}`,
          );
          if (memberPointsElement) {
            const currentMemberPoints = parseInt(participant.total_points) || 0;
            const newMemberPoints = currentMemberPoints + points;
            memberPointsElement.textContent = `${newMemberPoints}`;
            memberElement.dataset.points = newMemberPoints;
            participant.total_points = newMemberPoints;
          }
        }
      });

      // Update group total display
      const groupPointsElement = document.querySelector(`#group-points-${id}`);
      if (groupPointsElement) {
        groupPointsElement.textContent = `${translate("total_points")}: ${newPoints}`;
      }
      element.dataset.points = newPoints;
    } else {
      // Update individual points
      const pointsElement = element.querySelector(`#name-points-${id}`);
      if (pointsElement) {
        pointsElement.textContent = `${newPoints} `;
        element.dataset.points = newPoints;

        // Update the participant's points in the data
        const participant = this.participants.find((p) => p.id == id);
        if (participant) {
          participant.total_points = newPoints;
        }
      }
    }

    // Show point change animation
    this.showPointChangeAnimation(element, points);
  }

  async updateCache() {
    try {
      await setCachedData(
        "manage_points_data",
        {
          participants: this.participants,
          groups: this.groups,
          groupedParticipants: this.groupedParticipants,
          unassignedParticipants: this.unassignedParticipants,
        },
        CONFIG.CACHE_DURATION.SHORT,
      ); // Cache for 5 minutes
      debugLog("Cache updated with new points data.");
    } catch (error) {
      debugError("Error updating cache:", error);
    }
  }

  // Add this new method for point change animation
  showPointChangeAnimation(element, points) {
    const changeElement = document.createElement("span");
    changeElement.textContent = points > 0 ? `+${points}` : points;
    changeElement.className = "point-change";
    changeElement.style.color = points > 0 ? "green" : "red";
    element.appendChild(changeElement);

    // Remove the change element after animation
    setTimeout(() => {
      changeElement.remove();
    }, 2000);

    // Add highlight effect
    this.addHighlightEffect(element);
  }

  addHighlightEffect(element) {
    element.classList.add("highlight");
    setTimeout(() => {
      element.classList.remove("highlight");
    }, 500);
  }

  sortItems(key) {
    debugLog(`Sorting by ${key}`);

    // Toggle sort order if clicking same key, otherwise start with asc
    if (this.currentSort.key === key) {
      this.currentSort.order =
        this.currentSort.order === "asc" ? "desc" : "asc";
    } else {
      this.currentSort.key = key;
      this.currentSort.order = "asc";
    }

    // Update visual indicator for active sort button
    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.sort-btn[data-sort="${key}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }

    if (key === "group") {
      this.sortByGroup(); // Reuse the method to sort by group
    } else {
      // Handle other sorts (name, points)
      const list = document.getElementById("points-list");
      const items = Array.from(document.querySelectorAll(".list-item"));

      // Sort participants by name or points
      items.sort((a, b) => {
        let valueA, valueB;
        if (key === "name") {
          valueA = a.dataset.name;
          valueB = b.dataset.name;
        } else if (key === "points") {
          valueA = parseInt(a.dataset.points);
          valueB = parseInt(b.dataset.points);
        }
        return (
          (valueA < valueB ? -1 : valueA > valueB ? 1 : 0) *
          (this.currentSort.order === "asc" ? 1 : -1)
        );
      });

      // Clear the list and render only participants
      setContent(list, items.map((item) => item.outerHTML).join(""));
      debugLog(`Sorted by ${key}, order: ${this.currentSort.order}`);
    }
  }

  toggleFilter() {
    const filterContainer = document.getElementById("filter-container");
    if (filterContainer) {
      filterContainer.classList.toggle("hidden");
    }
  }

  sortByGroup() {
    const pointsList = document.getElementById("points-list");

    // First, render the groups with participants
    const groupContent = this.groups
      .map(
        (group) => `
        <div class="group-header" data-group-id="${
          group.id
        }" data-type="group" data-points="${group.total_points}">
          ${group.name} - ${group.total_points} 
        </div>
        <div class="group-content">
          ${this.renderParticipantsForGroup(group.id)}
          <div class="group-points" id="group-points-${group.id}">
            ${translate("total_points")}: ${group.total_points}
          </div>
        </div>
      `,
      )
      .join("");

    // Then, render unassigned participants
    const unassignedHTML = this.renderUnassignedParticipants();

    // Combine group content and unassigned participants into one HTML
    setContent(pointsList, groupContent + unassignedHTML);
  }

  filterByGroup(groupId) {
    this.currentFilter = groupId;
    const headers = document.querySelectorAll(".group-header");
    const items = document.querySelectorAll(".list-item");

    headers.forEach((header) => {
      header.style.display =
        groupId === "" || header.dataset.groupId === groupId ? "" : "none";
    });

    items.forEach((item) => {
      item.style.display =
        groupId === "" || item.dataset.groupId === groupId ? "" : "none";
    });
  }

  async refreshPointsData() {
    const cacheKey = "manage_points_data";
    try {
      // Try to get cached data first
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        debugLog("Using cached points data");
        this.updatePointsDisplay(cachedData);
        return cachedData;
      }

      // If no cached data, fetch from server
      debugLog("Fetching fresh points data");
      const response = await this.fetchWithCacheBusting("/api/points-data");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      // Cache the new data
      await setCachedData(cacheKey, data);

      this.updatePointsDisplay(data);
      return data;
    } catch (error) {
      debugError("Error fetching points data:", error);
      // If offline, try to use any available cached data, even if expired
      if (!navigator.onLine) {
        const cachedData = await getCachedDataIgnoreExpiration(cacheKey);
        if (cachedData) {
          debugLog("Using stale cached data due to offline status");
          this.updatePointsDisplay(cachedData);
          return cachedData;
        }
      }
      throw error;
    }
  }

  organizeParticipants() {
    // Safety check for undefined groups
    if (!Array.isArray(this.groups)) {
      this.groups = [];
    }

    // Safety check for undefined participants
    if (!Array.isArray(this.participants)) {
      this.participants = [];
    }

    // Initialize groupedParticipants with empty arrays for each group
    this.groupedParticipants = {};
    this.groups.forEach((group) => {
      this.groupedParticipants[group.id] = [];
    });

    // Initialize unassignedParticipants
    this.unassignedParticipants = [];

    // Organize participants into groups
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

    // Sort participants within each group
    Object.values(this.groupedParticipants).forEach((groupParticipants) => {
      groupParticipants.sort((a, b) => {
        // Sort by leader status first
        if (a.first_leader !== b.first_leader)
          return b.first_leader ? 1 : -1;
        // Then by second leader status
        if (a.second_leader !== b.second_leader)
          return b.second_leader ? 1 : -1;
        // Finally by name
        return a.first_name.localeCompare(b.first_name);
      });
    });

    // Sort unassigned participants by name
    this.unassignedParticipants.sort((a, b) =>
      a.first_name.localeCompare(b.first_name),
    );
  }

  async updatePointsDisplay(data) {
    debugLog("Updating points display with data:", data);

    // Normalize and update internal data structures when fresh data is provided
    if (data) {
      const participantsFromData = data.participants || data.names;
      if (Array.isArray(participantsFromData)) {
        this.participants = participantsFromData.map((participant) => ({
          total_points: 0,
          ...participant,
          total_points: participant.total_points ?? 0,
        }));
      }

      if (Array.isArray(data.groups)) {
        this.groups = data.groups.map((group) => ({
          total_points: 0,
          ...group,
          total_points: group.total_points ?? 0,
        }));
      }

      // Rebuild grouping to ensure render helpers can use fresh data
      this.organizeParticipants();

      // If the DOM has not yet been rendered, bail out after re-rendering the lists
      const pointsList = document.getElementById("points-list");
      if (pointsList) {
        this.sortByGroup();
      }
    }

    // Update points for all participants
    this.participants.forEach((participant) => {
      const participantElement = document.querySelector(
        `.list-item[data-participant-id="${participant.id}"]`,
      );
      if (participantElement) {
        const pointsElement = participantElement.querySelector(
          `#name-points-${participant.id}`,
        );
        if (pointsElement) {
          pointsElement.textContent = `${participant.total_points} `;
          participantElement.dataset.points = participant.total_points;
        }
      }
    });

    // Update group points - use the group's total_points from API (not recalculated from individuals)
    this.groups.forEach((group) => {
      const groupElement = document.querySelector(
        `.group-header[data-group-id="${group.id}"]`,
      );
      if (groupElement) {
        // Use group.total_points directly from API
        const totalPoints = parseInt(group.total_points) || 0;

        // Update group points display
        const pointsDisplay = `${group.name} - ${totalPoints} `;
        setContent(groupElement, pointsDisplay);
        groupElement.dataset.points = totalPoints;

        // Update the group points total if it exists
        const groupPointsElement = document.querySelector(
          `#group-points-${group.id}`,
        );
        if (groupPointsElement) {
          groupPointsElement.textContent = `${translate("total_points")}: ${totalPoints}`;
        }
      }
    });

    // Refresh the sort if needed
    if (this.currentSort.key === "points") {
      this.sortItems("points");
    }
  }

  async fetchWithCacheBusting(url) {
    const cacheBuster = new Date().getTime();
    const separator = url.includes("?") ? "&" : "?";
    return fetch(`${url}${separator}_=${cacheBuster}`);
  }

  renderError() {
    const errorMessage = `
        <h1>${translate("error")}</h1>
        <p>${translate("error_loading_manage_points")}</p>
    `;
    setContent(document.getElementById("app"), errorMessage);
  }
}
