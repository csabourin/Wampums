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
import { debugLog, debugError } from "./utils/DebugUtils.js";
import {
  saveOfflineData,
  getOfflineData,
  clearOfflineData,
  openDB,
  setCachedData,
  getCachedData,
  clearPointsRelatedCaches,
} from "./indexedDB.js";

export class ManagePoints {
  constructor(app) {
    this.app = app;
    this.selectedItem = null;
    this.pendingUpdates = [];
    this.updateTimeout = null;
    this.currentSort = { key: "group", order: "asc" };
    this.currentFilter = "";
  }

  async init() {
    try {
      await this.preloadManagePointsData();
      this.render();
      this.attachEventListeners();
      console.debug("init called");
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
      const cachedData = await getCachedData('manage_points_data');
      if (cachedData) {
        // Initialize arrays
        this.groups = cachedData.groups || [];
        this.groupedParticipants = cachedData.groupedParticipants || {};
        this.unassignedParticipants = cachedData.unassignedParticipants || [];

        // Get fresh points data
        const freshData = await getParticipants();
        if (freshData.success) {
          this.participants = freshData.participants;
          // Reorganize with fresh data
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
      } else if (groupsResponse.success && Array.isArray(groupsResponse.groups)) {
        // Backward compatibility
        this.groups = groupsResponse.groups;
      } else {
        debugError("Unexpected groups data structure:", groupsResponse);
        this.groups = []; // Ensure groups is at least an empty array
      }

      // Then handle participants
      if (participantsResponse.success && Array.isArray(participantsResponse.data)) {
        this.participants = participantsResponse.data;
      } else if (participantsResponse.success && Array.isArray(participantsResponse.participants)) {
        // Backward compatibility
        this.participants = participantsResponse.participants;
      } else {
        debugError("Unexpected participants data structure:", participantsResponse);
        this.participants = []; // Ensure participants is at least an empty array
      }

      // Only organize participants after both are loaded
      this.organizeParticipants();

      // Cache all participant data including points
      const participantsToCache = this.participants.map(participant => ({
        id: participant.id,
        first_name: participant.first_name,
        last_name: participant.last_name,
        group_id: participant.group_id,
        group_name: participant.group_name,
        is_leader: participant.is_leader,
        is_second_leader: participant.is_second_leader,
        total_points: participant.total_points || 0
      }));

      await setCachedData('manage_points_data', {
        participants: participantsToCache,
        groups: this.groups,
        groupedParticipants: this.groupedParticipants,
        unassignedParticipants: this.unassignedParticipants
      }, CONFIG.CACHE_DURATION.SHORT); // Cache for 5 minutes (was 24 hours - too long for points data)

    } catch (error) {
      debugError("Error fetching manage points data:", error);
      throw error;
    }
  }


  render() {
    const content = `
      <p><a href="/dashboard">${translate("back_to_dashboard")}</a></p>
      <h1>${translate("manage_points")}</h1>
      <div class="sort-options">
        <button data-sort="name">${translate("sort_by_name")}</button>
        <button data-sort="group">${translate("sort_by_group")}</button>
        <button data-sort="points">${translate("sort_by_points")}</button>
      </div>
      <div class="filter-options">
        <label for="group-filter">${translate("filter_by_group")}:</label>
        <select id="group-filter">
          <option value="">${translate("all_groups")}</option>
          ${this.groups
            .map(
              (group) => `<option value="${group.id}">${group.name}</option>`
            )
            .join("")}
        </select>
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
    document.getElementById("app").innerHTML = content;

    // Render points list sorted by group initially
    this.sortByGroup(); // Call the sort by group function here
  }

  renderPointsList() {
      return this.groups
        .filter((group) => {
          // Check if group has participants or non-zero points
          const groupParticipants = this.participants.filter(
            (p) => p.group_id == group.id
          );
          return groupParticipants.length > 0 || group.total_points > 0;
        })
        .map(
          (group) => `
            <div class="group-header" data-group-id="${
              group.id
            }" data-type="group" data-points="${group.total_points}">
              ${group.name} - ${group.total_points} ${translate("points")}
            </div>
            <div class="group-content">
              ${this.renderParticipantsForGroup(group.id)}
              <div class="group-points" id="group-points-${group.id}">
                ${translate("total_points")}: ${group.total_points}
              </div>
            </div>
          `
        )
        .join("");
  }


  renderUnassignedParticipants() {
    if (this.unassignedParticipants.length === 0) {
      return `<h2>${translate("unassigned_participants")}</h2><p>${translate(
        "no_unassigned_participants"
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
                <span>${participant.first_name} ${participant.last_name}</span>
                <span id="name-points-${participant.id}">${
              participant.total_points
            } ${translate("points")}</span>
              </div>
          `
          )
          .join("")}
      </div>
    `;
  }

  renderParticipantsForGroup(groupId) {
    const groupParticipants = this.participants.filter(
      (p) => p.group_id == groupId
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
            <span>${participant.first_name} ${participant.last_name}</span>
            <span id="name-points-${participant.id}">${
          participant.total_points
        } ${translate("points")}</span>
          </div>
        `
      )
      .join("");
  }

  // Event delegation for attaching listeners to dynamically added elements
  attachEventListeners() {
    const sortContainer = document.querySelector(".sort-options");
    const pointsList = document.getElementById("points-list");
    const filterDropdown = document.getElementById("group-filter");
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
      this.app.showMessage(translate("please_select_group_or_individual"), "error");
      return;
    }

    const type = this.selectedItem.dataset.type;
    const id = type === "group" 
      ? this.selectedItem.dataset.groupId 
      : this.selectedItem.dataset.participantId;

    if (type === "no-group") {
      this.app.showMessage(translate("cannot_assign_points_to_no_group"), "error");
      return;
    }

    // Provide immediate visual feedback
    this.updatePointsUI(type, id, points);

    const updateData = {
      type,
      id,
      points,
      timestamp: new Date().toISOString(),
    };

    // Add to pending updates
    this.pendingUpdates.push(updateData);

    // Process updates - sendBatchUpdate will update the UI from the API response
    try {
      await this.sendBatchUpdate();
      // Note: sendBatchUpdate already updates the UI with server response via 
      // updateGroupPoints/updateIndividualPoints, so no need to re-fetch and overwrite
    } catch (error) {
      debugError("Error updating points:", error);
      this.app.showMessage(translate("error_updating_points"), "error");
    }
  }


  async sendBatchUpdate() {
    if (this.pendingUpdates.length === 0) return;

    const updates = [...this.pendingUpdates];
    this.pendingUpdates = [];

    if (navigator.onLine) {
      try {
        const response = await fetch(getApiUrl('update-points'), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
            'x-organization-id': getCurrentOrganizationId()
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
        const updates = data.data?.updates || data.updates;
        if (updates && Array.isArray(updates)) {
          updates.forEach((update) => {
            if (update.type === "group") {
              this.updateGroupPoints(
                update.id,
                update.totalPoints,
                update.memberIds,
                update.memberTotals
              );
            } else {
              this.updateIndividualPoints(update.id, update.totalPoints);
            }
          });
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
        alert(`An error occurred while updating points: ${error.message}`);
      }
    } else {
      // Save updates for later sync
      updates.forEach((update) => saveOfflineData("updatePoints", update));
    }
  }


  updateGroupPoints(groupId, totalPoints, memberIds, memberTotals) {
    debugLog(`[updateGroupPoints] Updating group ${groupId} to ${totalPoints} points, members:`, memberIds, 'memberTotals:', memberTotals);
    const groupElement = document.querySelector(
      `.group-header[data-group-id="${groupId}"]`
    );
    if (groupElement) {
      // Get the group name from the internal data
      const group = this.groups.find(g => g.id == groupId);
      const groupName = group ? group.name : groupElement.textContent.split(' - ')[0];
      
      // Update the main group header display
      const pointsDisplay = `${groupName} - ${totalPoints} ${translate("points")}`;
      groupElement.innerHTML = pointsDisplay;
      groupElement.dataset.points = totalPoints;
      this.addHighlightEffect(groupElement);
      
      // Update the group points total element if it exists
      const groupPointsElement = document.querySelector(`#group-points-${groupId}`);
      if (groupPointsElement) {
        groupPointsElement.textContent = `${translate("total_points")}: ${totalPoints}`;
      }
      
      // Update the group's total_points in our data
      if (group) {
        group.total_points = totalPoints;
      }
    } else {
      debugLog(`[updateGroupPoints] Could not find element for group ${groupId}`);
    }
    
    // Update each member's individual points from the memberTotals array
    if (memberTotals && Array.isArray(memberTotals)) {
      memberTotals.forEach(member => {
        this.updateIndividualPoints(member.id, member.totalPoints);
      });
    }
  }

  updateIndividualPoints(participantId, totalPoints) {
    debugLog(`[updateIndividualPoints] Updating participant ${participantId} to ${totalPoints} points`);
    const nameElement = document.querySelector(
      `.list-item[data-participant-id="${participantId}"]`
    );
    if (nameElement) {
      const pointsElement = nameElement.querySelector(`#name-points-${participantId}`);
      if (pointsElement) {
        pointsElement.textContent = `${totalPoints} ${translate("points")}`;
      }
      nameElement.dataset.points = totalPoints;
      this.addHighlightEffect(nameElement);
    } else {
      debugLog(`[updateIndividualPoints] Could not find element for participant ${participantId}`);
    }
    
    // Update the participant's total_points in our internal data
    const participant = this.participants.find(p => p.id == participantId);
    if (participant) {
      participant.total_points = totalPoints;
    }
  }

  updatePointsUI(type, id, points) {
    const selector = type === "group" 
      ? `.group-header[data-group-id="${id}"]`
      : `.list-item[data-participant-id="${id}"]`;
    const element = document.querySelector(selector);
    if (!element) return;

    const currentPoints = parseInt(element.dataset.points) || 0;
    const newPoints = currentPoints + points;

    if (type === "group") {
      // Update group points
      const groupParticipants = this.participants.filter(p => p.group_id == id);
      groupParticipants.forEach(participant => {
        const memberElement = document.querySelector(
          `.list-item[data-participant-id="${participant.id}"]`
        );
        if (memberElement) {
          const memberPointsElement = memberElement.querySelector(
            `#name-points-${participant.id}`
          );
          if (memberPointsElement) {
            const currentMemberPoints = parseInt(participant.total_points) || 0;
            const newMemberPoints = currentMemberPoints + points;
            memberPointsElement.textContent = `${newMemberPoints} ${translate("points")}`;
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
        pointsElement.textContent = `${newPoints} ${translate("points")}`;
        element.dataset.points = newPoints;

        // Update the participant's points in the data
        const participant = this.participants.find(p => p.id == id);
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
      await setCachedData('manage_points_data', {
        participants: this.participants,
        groups: this.groups,
        groupedParticipants: this.groupedParticipants,
        unassignedParticipants: this.unassignedParticipants
      }, CONFIG.CACHE_DURATION.SHORT); // Cache for 5 minutes
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
      list.innerHTML = items.map((item) => item.outerHTML).join("");

      // Update current sort order
      if (this.currentSort.key === key) {
        this.currentSort.order =
          this.currentSort.order === "asc" ? "desc" : "asc";
      } else {
        this.currentSort.key = key;
        this.currentSort.order = "asc";
      }

      debugLog(`Sorted by ${key}, order: ${this.currentSort.order}`);
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
          ${group.name} - ${group.total_points} ${translate("points")}
        </div>
        <div class="group-content">
          ${this.renderParticipantsForGroup(group.id)}
          <div class="group-points" id="group-points-${group.id}">
            ${translate("total_points")}: ${group.total_points}
          </div>
        </div>
      `
      )
      .join("");

    // Then, render unassigned participants
    const unassignedHTML = this.renderUnassignedParticipants();

    // Combine group content and unassigned participants into one HTML
    pointsList.innerHTML = groupContent + unassignedHTML;
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
        const cachedData = await getCachedData(cacheKey);
        if (cachedData) {
          debugLog("Using expired cached data due to offline status");
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
    this.groups.forEach(group => {
      this.groupedParticipants[group.id] = [];
    });

    // Initialize unassignedParticipants
    this.unassignedParticipants = [];

    // Organize participants into groups
    this.participants.forEach(participant => {
      if (participant.group_id && this.groupedParticipants[participant.group_id]) {
        this.groupedParticipants[participant.group_id].push(participant);
      } else {
        this.unassignedParticipants.push(participant);
      }
    });

    // Sort participants within each group
    Object.values(this.groupedParticipants).forEach(groupParticipants => {
      groupParticipants.sort((a, b) => {
        // Sort by leader status first
        if (a.is_leader !== b.is_leader) return b.is_leader ? 1 : -1;
        // Then by second leader status
        if (a.is_second_leader !== b.is_second_leader) return b.is_second_leader ? 1 : -1;
        // Finally by name
        return a.first_name.localeCompare(b.first_name);
      });
    });

    // Sort unassigned participants by name
    this.unassignedParticipants.sort((a, b) => 
      a.first_name.localeCompare(b.first_name)
    );
  }

  async updatePointsDisplay(data) {
    debugLog("Updating points display with data:", data);

    // Update points for all participants
    this.participants.forEach(participant => {
      const participantElement = document.querySelector(
        `.list-item[data-participant-id="${participant.id}"]`
      );
      if (participantElement) {
        const pointsElement = participantElement.querySelector(
          `#name-points-${participant.id}`
        );
        if (pointsElement) {
          pointsElement.textContent = `${participant.total_points} ${translate("points")}`;
          participantElement.dataset.points = participant.total_points;
        }
      }
    });

    // Update group points - use the group's total_points from API (not recalculated from individuals)
    this.groups.forEach(group => {
      const groupElement = document.querySelector(
        `.group-header[data-group-id="${group.id}"]`
      );
      if (groupElement) {
        // Use group.total_points directly from API
        const totalPoints = parseInt(group.total_points) || 0;

        // Update group points display
        const pointsDisplay = `${group.name} - ${totalPoints} ${translate("points")}`;
        groupElement.innerHTML = pointsDisplay;
        groupElement.dataset.points = totalPoints;

        // Update the group points total if it exists
        const groupPointsElement = document.querySelector(`#group-points-${group.id}`);
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
    document.getElementById("app").innerHTML = errorMessage;
  }
}
