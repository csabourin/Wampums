// app.js

import { saveOfflineData, getOfflineData, clearOfflineData } from './indexedDB.js';

let newWorker;
let selectedItem = null;
let pendingUpdates = new Map();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then((registration) => {
      console.log('Service Worker registered with scope:', registration.scope);

      registration.addEventListener('updatefound', () => {
        newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar();
          }
        });
      });

      // Register for sync
      navigator.serviceWorker.ready.then((swRegistration) => {
        return swRegistration.sync.register('sync-points');
      });
    })
    .catch((error) => {
      console.log('Service Worker registration failed:', error);
    });
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
window.addEventListener('load', updateOnlineStatus);

navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data === 'sync-data') {
    syncData();
  }
});

let isSyncing = false;

function updateOnlineStatus() {
  const status = navigator.onLine ? 'online' : 'offline';
  console.log('Connection status:', status);
  document.body.classList.remove('online', 'offline');
  document.body.classList.add(status);

  const offlineIndicator = document.getElementById('offline-indicator');
  if (offlineIndicator) {
    offlineIndicator.style.display = status === 'offline' ? 'block' : 'none';
  }

  const manageLinks = document.querySelectorAll('.manage-names, .manage-groups');
  manageLinks.forEach(link => {
    link.style.pointerEvents = status === 'offline' ? 'none' : 'auto';
    link.style.opacity = status === 'offline' ? '0.5' : '1';
  });

  if (status === 'online') {
    clearCache();
    syncData();
  }
}

function syncData() {
  if (isSyncing) return;
  isSyncing = true;

  getOfflineData()
    .then(offlineData => {
      if (offlineData.length > 0) {
        return fetch('/sync_data.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(offlineData),
        });
      } else {
        return Promise.resolve(null);
      }
    })
    .then(response => response ? response.json() : null)
    .then(data => {
      if (data && data.success) {
        clearOfflineData();
        console.log('Data synced successfully');
        applyServerUpdates(data.serverUpdates);
      } else if (data) {
        console.error('Error syncing data:', data.error);
        alert(translate('failed_to_sync_data'));
      }
    })
    .catch(error => {
      console.error('Error syncing data:', error);
      alert(translate('failed_to_sync_data'));
    })
    .finally(() => {
      isSyncing = false;
    });
}

function applyServerUpdates(updates) {
  updates.forEach(update => {
      if (update.action === 'updatePoints') {
          const { type, id, totalPoints, memberPoints } = update.data;
          if (type === 'group') {
              updateGroupPoints(id, totalPoints, memberPoints);
          } else {
              updateIndividualPoints(id, totalPoints);
          }
      }
      // Add more cases for other types of updates as needed
  });
}

function updateGroupPoints(groupId, totalPoints, memberPoints) {
  console.log(`Updating group points for group ${groupId}: ${totalPoints} points`);
  const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
  if (groupElement) {
      const pointsElement = groupElement.querySelector(`#group-points-${groupId}`);
      if (pointsElement) {
          pointsElement.textContent = `${totalPoints} ${translate('points')}`;
          addHighlightEffect(pointsElement);
      }
      groupElement.dataset.points = totalPoints;
  }

  // Update individual member points
  for (const [memberId, memberTotalPoints] of Object.entries(memberPoints)) {
      updateIndividualPoints(memberId, memberTotalPoints);
  }
}

function updateIndividualPoints(nameId, totalPoints) {
  console.log(`Updating individual points for name ${nameId}: ${totalPoints} points`);
  const nameElement = document.querySelector(`[data-name-id="${nameId}"]`);
  if (nameElement) {
      const pointsElement = nameElement.querySelector(`#name-points-${nameId}`);
      if (pointsElement) {
          pointsElement.textContent = `${totalPoints} ${translate('points')}`;
          addHighlightEffect(pointsElement);
      }
      nameElement.dataset.points = totalPoints;
  } else {
      console.error(`Name element not found for id ${nameId}`);
  }
}

function showUpdateBar() {
  const updateBar = document.createElement('div');
  updateBar.textContent = translate('new_version_available');
  updateBar.style.cssText = 'position: fixed; bottom: 0; left: 0; right: 0; background: #4c65ae; color: white; text-align: center; padding: 1em; cursor: pointer;';
  updateBar.addEventListener('click', () => {
    newWorker.postMessage({ action: 'skipWaiting' });
    window.location.reload();
  });
  document.body.appendChild(updateBar);
}

function sendServerUpdate(type, id, points) {
    const data = {
        type: type,
        id: id,
        points: points,
        timestamp: new Date().toISOString()
    };

    return fetch('update_points.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        if (data.status !== 'success') {
            throw new Error(data.message || 'Unknown error occurred');
        }
        return data;
    });
}

function setPointButtonsDisabled(disabled) {
  const pointButtons = document.querySelectorAll('.point-btn');
  pointButtons.forEach(button => {
    button.disabled = disabled;
  });
}


function updateAttendance(nameId, status) {
  if (navigator.onLine) {
    sendAttendanceUpdate(nameId, status);
  } else {
    updateAttendanceUI(nameId, status);
    saveOfflineData('updateAttendance', { nameId, status, date: getCurrentDate() });
  }
}

function sendAttendanceUpdate(nameId, status) {
  const data = {
    name_id: nameId,
    status: status,
    date: getCurrentDate()
  };

  fetch('update_attendance.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(data => {
    if (data.status === 'success') {
      updateAttendanceUI(nameId, status);
    } else {
      console.error('Error updating attendance:', data.message);
      alert(translate('error_updating_attendance'));
    }
  })
  .catch(error => {
    console.error('Error:', error);
    alert(translate('error_updating_attendance'));
  });
}

function updateAttendanceUI(nameId, status) {
  const nameItem = document.querySelector(`.name-item[data-id="${nameId}"]`);
  if (nameItem) {
    nameItem.dataset.status = status;
    nameItem.querySelector('.status').textContent = translate(status);
  }
}

function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

function clearCache() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage('clearCache');
  }
}

window.updatePoints = function(points) {
    console.log('updatePoints called with', points, 'points');
    if (!window.selectedItem) {
        console.log('No item selected');
        alert(translate('please_select_group_or_individual'));
        return;
    }

    const type = window.selectedItem.classList.contains('group-header') ? 'group' : 'individual';
    const id = type === 'group' ? window.selectedItem.dataset.groupId : window.selectedItem.dataset.nameId;

    console.log(`Updating points for ${type} with id ${id}: ${points} points`);

    // Provide immediate visual feedback
    if (type === 'group') {
        updateGroupPointsUI(id, points);
    } else {
        updatePointsUI(type, id, points);
    }

    if (navigator.onLine) {
        console.log('Online: Sending server update');
        sendServerUpdate(type, id, points)
            .then(data => {
                console.log('Server update successful:', data);
                if (type === 'group') {
                    updateGroupWithServerData(id, data);
                } else {
                    updateSingleItem(type, id, data.totalPoints);
                }
            })
            .catch(error => {
                console.error('Error updating points:', error);
                // Revert the optimistic update
                if (type === 'group') {
                    updateGroupPointsUI(id, -points);
                } else {
                    updatePointsUI(type, id, -points);
                }
                alert(translate('failed_to_update_points'));
            });
    } else {
        console.log('Offline: Saving update for later sync');
        // Offline update
        saveOfflineData('updatePoints', { type, id, points, timestamp: new Date().toISOString() });
        showPendingUpdate(type, id, points);
    }
}

function updateGroupPointsUI(groupId, points) {
  const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
  if (!groupElement) {
      console.log(`Group element not found for id ${groupId}`);
      return;
  }

  // Update group points
  const groupPointsElement = groupElement.querySelector(`#name-points-${groupId}`);
  if (groupPointsElement) {
      const currentPoints = parseInt(groupElement.dataset.points) || 0;
      const newPoints = currentPoints + points;
      groupPointsElement.textContent = `${newPoints} ${translate('points')}`;
      groupElement.dataset.points = newPoints;
      addHighlightEffect(groupElement);
  }

  // Update individual items in the group
  const individualItems = document.querySelectorAll(`[data-group-id="${groupId}"].list-item`);
  individualItems.forEach(item => {
      const itemId = item.dataset.nameId;
      const itemPointsElement = item.querySelector(`#name-points-${itemId}`);
      if (itemPointsElement) {
          const currentPoints = parseInt(item.dataset.points) || 0;
          const newPoints = currentPoints + points;
          itemPointsElement.textContent = `${newPoints} ${translate('points')}`;
          item.dataset.points = newPoints;
          addHighlightEffect(item);
      }
  });
}

function updateGroupWithServerData(groupId, data) {
    console.log('Updating group with server data:', data);
    const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
    if (!groupElement) {
        console.log(`Group element not found for id ${groupId}`);
        return;
    }

    // Update group points
    const groupPointsElement = groupElement.querySelector(`#name-points-${groupId}`);
    if (groupPointsElement) {
        groupPointsElement.textContent = `${data.totalPoints} ${translate('points')}`;
        groupElement.dataset.points = data.totalPoints;
        addHighlightEffect(groupElement);
    }

    // Update individual items in the group
    if (data.memberPoints && typeof data.memberPoints === 'object') {
        Object.entries(data.memberPoints).forEach(([memberId, points]) => {
            const itemElement = document.querySelector(`[data-name-id="${memberId}"]`);
            if (itemElement) {
                const itemPointsElement = itemElement.querySelector(`#name-points-${memberId}`);
                if (itemPointsElement) {
                    itemPointsElement.textContent = `${points} ${translate('points')}`;
                    itemElement.dataset.points = points;
                    addHighlightEffect(itemElement);
                }
            }
        });
    } else {
        console.log('No member points data or invalid format:', data.memberPoints);
    }
}

function updatePointsUI(type, id, points) {
  console.log(`updatePointsUI called for ${type} with id ${id}, points change: ${points}`);
  const selector = type === 'group' ? `[data-group-id="${id}"]` : `[data-name-id="${id}"]`;
  const element = document.querySelector(selector);
  if (!element) {
      console.log(`Element not found for selector: ${selector}`);
      return;
  }

  const pointsElement = element.querySelector(`#name-points-${id}`);
  if (!pointsElement) {
      console.log(`Points element not found for ${type} with id ${id}`);
      return;
  }

  const currentPoints = parseInt(element.dataset.points) || 0;
  const newPoints = currentPoints + points;

  console.log(`Updating points display from ${currentPoints} to ${newPoints}`);

  // Update the points display
  pointsElement.textContent = `${newPoints} ${translate('points')}`;
  element.dataset.points = newPoints;

  // Show the change with a temporary element
  const changeElement = document.createElement('span');
  changeElement.textContent = points > 0 ? `+${points}` : points;
  changeElement.className = 'point-change';
  changeElement.style.color = points > 0 ? 'green' : 'red';
  changeElement.style.marginLeft = '5px';
  pointsElement.appendChild(changeElement);

  // Add highlight effect
  addHighlightEffect(element);

  console.log('Added highlight effect and point change indicator');

  // Remove the change element after a short delay
  setTimeout(() => {
      changeElement.remove();
      console.log('Removed point change indicator');
  }, 2000);
}

function updateSingleItem(type, id, totalPoints) {
  console.log(`Updating single ${type} with id ${id} to ${totalPoints} points`);
  const selector = type === 'group' ? `[data-group-id="${id}"]` : `[data-name-id="${id}"]`;
  const element = document.querySelector(selector);
  if (!element) {
      console.log(`Element not found for selector: ${selector}`);
      return;
  }

  const pointsElement = element.querySelector(`#name-points-${id}`);
  if (!pointsElement) {
      console.log(`Points element not found for ${type} with id ${id}`);
      return;
  }

  pointsElement.textContent = `${totalPoints} ${translate('points')}`;
  element.dataset.points = totalPoints;
  addHighlightEffect(element);
  console.log(`Updated ${type} ${id} to ${totalPoints} points`);
}

function refreshPointsData() {
  console.log('Refreshing points data');
  return fetchWithCacheBusting('/get_points_data.php')
      .then(response => {
          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
      })
      .then(data => {
          console.log('Received updated points data:', data);
          updatePointsDisplay(data);
          console.log('Points data display updated');
      })
      .catch(error => {
          console.error('Error fetching points data:', error);
      });
}

function updatePointsDisplay(data) {
  console.log('Updating points display with data:', data);

  // Update group points
  data.groups.forEach(group => {
      const groupElement = document.querySelector(`.group-header[data-group-id="${group.id}"]`);
      if (groupElement) {
          const pointsElement = groupElement.querySelector(`#group-points-${group.id}`);
          if (pointsElement) {
              pointsElement.textContent = `${group.total_points} ${translate('points')}`;
          } else {
              console.log(`Points element not found for group ${group.id}`);
          }
          groupElement.dataset.points = group.total_points;
      } else {
          console.log(`Group element not found for id ${group.id}`);
      }
  });

  // Update individual points
  data.names.forEach(name => {
      const nameElement = document.querySelector(`.list-item[data-name-id="${name.id}"]`);
      if (nameElement) {
          const pointsElement = nameElement.querySelector(`#name-points-${name.id}`);
          if (pointsElement) {
              pointsElement.textContent = `${name.total_points} ${translate('points')}`;
          } else {
              console.log(`Points element not found for name ${name.id}`);
          }
          nameElement.dataset.points = name.total_points;
      } else {
          console.log(`Name element not found for id ${name.id}`);
      }
  });

  console.log('Finished updating points display');
}

function addHighlightEffect(element) {
  element.classList.add('highlight');
  setTimeout(() => {
      element.classList.remove('highlight');
  }, 500);
}

function showPendingUpdate(type, id, points) {
  const selector = type === 'group' ? `[data-group-id="${id}"]` : `[data-name-id="${id}"]`;
  const element = document.querySelector(selector);
  if (!element) return;

  const pendingElement = document.createElement('span');
  pendingElement.textContent = points > 0 ? `+${points}` : points;
  pendingElement.className = 'pending-update';
  pendingElement.style.marginLeft = '5px';
  pendingElement.style.color = points > 0 ? 'green' : 'red';

  const pointsElement = element.querySelector(`#${type}-points-${id}`);
  if (pointsElement) {
      pointsElement.appendChild(pendingElement);
  }
}

function removePendingUpdate(type, id) {
  const selector = type === 'group' ? `[data-group-id="${id}"]` : `[data-name-id="${id}"]`;
  const element = document.querySelector(selector);
  if (!element) return;

  const pendingElement = element.querySelector('.pending-update');
  if (pendingElement) {
      pendingElement.remove();
  }
}

function applyPendingUpdates() {
  getOfflineData()
      .then(offlineData => {
          const updatePromises = offlineData.map(item => {
              if (item.action === 'updatePoints') {
                  const { type, id, points } = item.data;
                  return sendServerUpdate(type, id, points)
                      .then(data => {
                          console.log('Pending update applied successfully:', data);
                          if (type === 'group') {
                              updateGroupPoints(id, data.totalPoints, data.memberPoints);
                          } else {
                              updateIndividualPoints(id, data.totalPoints);
                          }
                          removePendingUpdate(type, id);
                      })
                      .catch(error => {
                          console.error('Error applying pending update:', error);
                      });
              }
              return Promise.resolve();
          });

          return Promise.all(updatePromises);
      })
      .then(() => {
          console.log('All pending updates applied');
          return clearOfflineData();
      })
      .then(() => {
          console.log('Offline data cleared');
      })
      .catch(error => {
          console.error('Error in applyPendingUpdates:', error);
      });
}

// Expose these functions globally
window.updatePoints = updatePoints;
window.showPendingUpdate = showPendingUpdate;
window.removePendingUpdate = removePendingUpdate;
window.applyPendingUpdates = applyPendingUpdates;
window.refreshPointsData = refreshPointsData;
window.updatePointsDisplay = updatePointsDisplay;

// Refresh points data periodically when online
setInterval(() => {
  if (navigator.onLine) {
    refreshPointsData();
  }
}, 30000);  // Refresh every 30 seconds

// Translation function (placeholder - implement actual translation logic)
function translate(key) {
  // Implement your translation logic here
  return key;
}