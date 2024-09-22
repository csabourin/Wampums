// points_manager.js

import {
  saveOfflineData,
  getOfflineData,
  clearOfflineData,
  openDB,
  setCachedData,
  getCachedData,
} from "./indexedDB.js";

let selectedItem = null;
let pendingUpdates = [];
let updateTimeout = null;
let currentSort = { key: "group", order: "asc" };
let currentFilter = "";

export function initializePointsUI() {
  document.querySelectorAll(".list-item, .group-header").forEach((item) => {
    item.addEventListener("click", function () {
      if (selectedItem) {
        selectedItem.classList.remove("selected");
      }
      this.classList.add("selected");
      selectedItem = this;
      console.log("Selected item:", selectedItem);
    });
  });

  // Add event listeners for sort buttons
  document.querySelectorAll(".sort-options button").forEach((button) => {
    button.addEventListener("click", function () {
      sortItems(this.dataset.sort);
    });
  });

  // Add event listener for group filter
  const groupFilter = document.getElementById("group-filter");
  if (groupFilter) {
    groupFilter.addEventListener("change", function () {
      filterByGroup(this.value);
    });
  }

  // Add event listeners for point buttons
  document.querySelectorAll(".point-btn").forEach((button) => {
    button.addEventListener("click", function () {
      const points = parseInt(this.dataset.points);
      updatePoints(points);
    });
  });
}

export function updatePoints(points) {
  if (!selectedItem) {
    alert(translate("please_select_group_or_individual"));
    return;
  }

  const type = selectedItem.dataset.type;
  const id =
    type === "group"
      ? selectedItem.dataset.groupId
      : selectedItem.dataset.nameId;

  if (type === "no-group") {
    alert(translate("cannot_assign_points_to_no_group"));
    return;
  }

  console.log(`Updating points for ${type} with id ${id}: ${points} points`);

  // Provide immediate visual feedback
  updatePointsUI(type, id, points);

  const updateData = { type, id, points, timestamp: new Date().toISOString() };
  pendingUpdates.push(updateData);

  // Clear any existing timeout
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }

  // Set a new timeout to send updates after a short delay
  updateTimeout = setTimeout(sendBatchUpdate, 300); // 300ms delay

  // If it's the first update in the batch, also trigger an immediate send
  if (pendingUpdates.length === 1) {
    sendBatchUpdate();
  }
}

async function sendBatchUpdate() {
  if (pendingUpdates.length === 0) return;

  const updates = [...pendingUpdates];
  pendingUpdates = [];

  if (navigator.onLine) {
    try {
      const response = await fetch("update_points.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

      console.log("Batch update successful:", data);

      // Apply server updates
      data.updates.forEach((update) => {
        if (update.type === "group") {
          updateGroupPoints(update.id, update.totalPoints, update.memberIds);
        } else {
          updateIndividualPoints(update.id, update.totalPoints);
        }
      });
    } catch (error) {
      console.error("Error in batch update:", error);
      // If there's an error, add the updates back to the pending list
      pendingUpdates.push(...updates);

      // Show an error message to the user
      alert(`An error occurred while updating points: ${error.message}`);
    }
  } else {
    // Save updates for later sync
    updates.forEach((update) => saveOfflineData("updatePoints", update));
  }
}

function updateGroupPoints(groupId, totalPoints, memberIds) {
  const groupElement = document.querySelector(
    `.group-header[data-group-id="${groupId}"]`
  );
  if (groupElement) {
    const pointsElement = groupElement.querySelector(
      `#group-points-${groupId}`
    );
    if (pointsElement) {
      pointsElement.textContent = `${totalPoints} ${translate("points")}`;
    }
    groupElement.dataset.points = totalPoints;
    addHighlightEffect(groupElement);
  }

  // Update individual members
  memberIds.forEach((memberId) => {
    const memberElement = document.querySelector(
      `.list-item[data-name-id="${memberId}"]`
    );
    if (memberElement) {
      const memberPointsElement = memberElement.querySelector(
        `#name-points-${memberId}`
      );
      if (memberPointsElement) {
        const currentPoints = parseInt(memberElement.dataset.points) || 0;
        const newPoints =
          currentPoints + (totalPoints - parseInt(groupElement.dataset.points));
        memberPointsElement.textContent = `${newPoints} ${translate("points")}`;
        memberElement.dataset.points = newPoints;
        addHighlightEffect(memberElement);
      }
    }
  });
}

function updateIndividualPoints(nameId, totalPoints) {
  const nameElement = document.querySelector(
    `.list-item[data-name-id="${nameId}"]`
  );
  if (nameElement) {
    const pointsElement = nameElement.querySelector(`#name-points-${nameId}`);
    if (pointsElement) {
      pointsElement.textContent = `${totalPoints} ${translate("points")}`;
    }
    nameElement.dataset.points = totalPoints;
    addHighlightEffect(nameElement);
  }
}

function updatePointsUI(type, id, points) {
  const selector =
    type === "group"
      ? `.group-header[data-group-id="${id}"]`
      : `.list-item[data-name-id="${id}"]`;
  const element = document.querySelector(selector);
  if (!element) return;

  const pointsElement = element.querySelector(`#${type}-points-${id}`);
  if (!pointsElement) return;

  const currentPoints = parseInt(element.dataset.points) || 0;
  const newPoints = currentPoints + points;

  pointsElement.textContent = `${newPoints} ${translate("points")}`;
  element.dataset.points = newPoints;

  // Show the change with a temporary element
  const changeElement = document.createElement("span");
  changeElement.textContent = points > 0 ? `+${points}` : points;
  changeElement.className = "point-change";
  changeElement.style.color = points > 0 ? "green" : "red";
  pointsElement.appendChild(changeElement);

  // Remove the change element after a short delay
  setTimeout(() => {
    changeElement.remove();
  }, 2000);

  // Add highlight effect
  addHighlightEffect(element);

  // If it's a group update, also update the UI for all members
  if (type === "group") {
    const memberElements = document.querySelectorAll(
      `.list-item[data-group-id="${id}"]`
    );
    memberElements.forEach((memberElement) => {
      const memberPointsElement =
        memberElement.querySelector(`[id^="name-points-"]`);
      if (memberPointsElement) {
        const memberCurrentPoints = parseInt(memberElement.dataset.points) || 0;
        const memberNewPoints = memberCurrentPoints + points;
        memberPointsElement.textContent = `${memberNewPoints} ${translate(
          "points"
        )}`;
        memberElement.dataset.points = memberNewPoints;
        addHighlightEffect(memberElement);
      }
    });
  }
}

function addHighlightEffect(element) {
  element.classList.add("highlight");
  setTimeout(() => {
    element.classList.remove("highlight");
  }, 500);
}

function sortItems(key) {
  console.log(`Sorting by ${key}`);
  const list = document.getElementById("points-list");
  const groups = Array.from(list.querySelectorAll(".group-header"));
  const items = Array.from(list.querySelectorAll(".list-item"));

  if (key === "group") {
    // Sort groups
    groups.sort((a, b) => {
      return (
        a.textContent.localeCompare(b.textContent) *
        (currentSort.order === "asc" ? 1 : -1)
      );
    });

    // Clear the list
    list.innerHTML = "";

    // Append sorted groups with their items
    groups.forEach((group) => {
      list.appendChild(group);
      const groupId = group.dataset.groupId;
      const groupItems = items.filter(
        (item) => item.dataset.groupId === groupId
      );
      groupItems.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
      groupItems.forEach((item) => list.appendChild(item));
    });
  } else {
    // Sort all items
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
        (currentSort.order === "asc" ? 1 : -1)
      );
    });

    // Clear the list
    list.innerHTML = "";

    // Append all groups (to maintain structure) and sorted items
    groups.forEach((group) => list.appendChild(group));
    items.forEach((item) => list.appendChild(item));
  }

  // Update current sort
  if (currentSort.key === key) {
    currentSort.order = currentSort.order === "asc" ? "desc" : "asc";
  } else {
    currentSort.key = key;
    currentSort.order = "asc";
  }

  console.log(`Sorted by ${key}, order: ${currentSort.order}`);
}

function filterByGroup(groupId) {
  currentFilter = groupId;
  const headers = document.querySelectorAll(".group-header");
  const items = document.querySelectorAll(".list-item");

  headers.forEach((header) => {
    header.style.display =
      groupId === "" || header.dataset.id === groupId ? "" : "none";
  });

  items.forEach((item) => {
    item.style.display =
      groupId === "" || item.dataset.groupId === groupId ? "" : "none";
  });
}

export async function refreshPointsData() {
  const cacheKey = "pointsData";
  try {
    // Try to get cached data first
    const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      console.log("Using cached points data");
      updatePointsDisplay(cachedData);
      return cachedData;
    }

    // If no cached data, fetch from server
    console.log("Fetching fresh points data");
    const response = await fetchWithCacheBusting("/get_points_data.php");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    // Cache the new data
    await setCachedData(cacheKey, data);

    updatePointsDisplay(data);
    return data;
  } catch (error) {
    console.error("Error fetching points data:", error);
    // If offline, try to use any available cached data, even if expired
    if (!navigator.onLine) {
      const cachedData = await getCachedData(cacheKey);
      if (cachedData) {
        console.log("Using expired cached data due to offline status");
        updatePointsDisplay(cachedData);
        return cachedData;
      }
    }
    throw error;
  }
}

export function updatePointsDisplay(data) {
  console.log("Updating points display with data:", data);

  // Update group points
  data.groups.forEach((group) => {
    const groupElement = document.querySelector(
      `.group-header[data-group-id="${group.id}"]`
    );
    if (groupElement) {
      const pointsElement = groupElement.querySelector(
        `#group-points-${group.id}`
      );
      if (pointsElement) {
        pointsElement.textContent = `${group.total_points} ${translate(
          "points"
        )}`;
      } else {
        console.log(`Points element not found for group ${group.id}`);
      }
      groupElement.dataset.points = group.total_points;
    } else {
      console.log(`Group element not found for id ${group.id}`);
    }
  });

  // Update individual points
  data.names.forEach((name) => {
    const nameElement = document.querySelector(
      `.list-item[data-name-id="${name.id}"]`
    );
    if (nameElement) {
      const pointsElement = nameElement.querySelector(
        `#name-points-${name.id}`
      );
      if (pointsElement) {
        pointsElement.textContent = `${name.total_points} ${translate(
          "points"
        )}`;
      } else {
        console.log(`Points element not found for name ${name.id}`);
      }
      nameElement.dataset.points = name.total_points;
    } else {
      console.log(`Name element not found for id ${name.id}`);
    }
  });

  console.log("Finished updating points display");
}

document.addEventListener("DOMContentLoaded", function () {
  initializePointsUI();
  if (navigator.onLine) {
    refreshPointsData();
  }
});
