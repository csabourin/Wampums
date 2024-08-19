// points_script.js

let selectedItem = null;
let currentSort = { key: 'group', order: 'asc' };
let currentFilter = '';

document.addEventListener('DOMContentLoaded', function() {
    initializePointsUI();
    if (navigator.onLine) {
        refreshPointsData();
    }
});

function initializePointsUI() {
    document.querySelectorAll('.list-item, .group-header').forEach(item => {
        item.addEventListener('click', function() {
            if (window.selectedItem) {
                window.selectedItem.classList.remove('selected');
            }
            this.classList.add('selected');
            window.selectedItem = this;
            console.log('Selected item:', window.selectedItem);
        });
    });

    // Add event listeners for sort buttons
    document.querySelectorAll('.sort-options button').forEach(button => {
        button.addEventListener('click', function() {
            sortItems(this.dataset.sort);
        });
    });

    // Add event listener for group filter
    const groupFilter = document.getElementById('group-filter');
    if (groupFilter) {
        groupFilter.addEventListener('change', function() {
            filterByGroup(this.value);
        });
    }

    // Add event listeners for point buttons
    document.querySelectorAll('.point-btn').forEach(button => {
        button.addEventListener('click', function() {
            const points = parseInt(this.dataset.points);
            updatePoints(points);
        });
    });
}

function refreshPointsData() {
    window.fetchWithCacheBusting('/get_points_data.php')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            updatePointsDisplay(data);
        })
        .catch(error => {
            console.error('Error fetching points data:', error);
        });
}

function updatePointsDisplay(data) {
    // Update group points
    data.groups.forEach(group => {
        const groupElement = document.querySelector(`.group-header[data-group-id="${group.id}"]`);
        if (groupElement) {
            const pointsElement = groupElement.querySelector(`#group-points-${group.id}`);
            if (pointsElement) {
                pointsElement.textContent = `${group.total_points} ${translate('points')}`;
            }
            groupElement.dataset.points = group.total_points;
        }
    });

    // Update individual points
    data.names.forEach(name => {
        const nameElement = document.querySelector(`.list-item[data-name-id="${name.id}"]`);
        if (nameElement) {
            const pointsElement = nameElement.querySelector(`#name-points-${name.id}`);
            if (pointsElement) {
                pointsElement.textContent = `${name.total_points} ${translate('points')}`;
            }
            nameElement.dataset.points = name.total_points;
        }
    });

    // Remove any existing pending update indicators
    document.querySelectorAll('.pending-update').forEach(el => el.remove());
}

function updatePointsUI(type, id, points) {
    const selector = type === 'group' ? `[data-group-id="${id}"]` : `[data-name-id="${id}"]`;
    const element = document.querySelector(selector);
    if (!element) return;

    const pointsElement = element.querySelector(`#${type}-points-${id}`);
    if (!pointsElement) return;

    const currentPoints = parseInt(element.dataset.points) || 0;
    const newPoints = currentPoints + points;

    // Update the points display
    pointsElement.textContent = `${newPoints} ${translate('points')}`;
    element.dataset.points = newPoints;

    // Show the change with a temporary element
    const changeElement = document.createElement('span');
    changeElement.textContent = points > 0 ? `+${points}` : points;
    changeElement.className = 'point-change';
    changeElement.style.color = points > 0 ? 'green' : 'red';
    pointsElement.appendChild(changeElement);

    // Remove the change element after a short delay
    setTimeout(() => {
        changeElement.remove();
    }, 2000);

    // Add highlight effect
    addHighlightEffect(pointsElement);
}

function addHighlightEffect(element) {
    element.classList.add('highlight');
    setTimeout(() => {
        element.classList.remove('highlight');
    }, 500);
}

// Make sure to have this translation function defined or imported
function translate(key) {
    // Implement translation logic here
    return key; // Fallback to just returning the key if no translation is available
}


function sortItems(key) {
    console.log(`Sorting by ${key}`);
    const list = document.getElementById('points-list');
    const groups = Array.from(list.querySelectorAll('.group-header'));
    const items = Array.from(list.querySelectorAll('.list-item'));

    if (key === 'group') {
        // Sort groups
        groups.sort((a, b) => {
            return a.textContent.localeCompare(b.textContent) * (currentSort.order === 'asc' ? 1 : -1);
        });

        // Clear the list
        list.innerHTML = '';

        // Append sorted groups with their items
        groups.forEach(group => {
            list.appendChild(group);
            const groupId = group.dataset.groupId;
            const groupItems = items.filter(item => item.dataset.groupId === groupId);
            groupItems.sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
            groupItems.forEach(item => list.appendChild(item));
        });
    } else {
        // Sort all items
        items.sort((a, b) => {
            let valueA, valueB;
            if (key === 'name') {
                valueA = a.dataset.name;
                valueB = b.dataset.name;
            } else if (key === 'points') {
                valueA = parseInt(a.dataset.points);
                valueB = parseInt(b.dataset.points);
            }
            return (valueA < valueB ? -1 : valueA > valueB ? 1 : 0) * (currentSort.order === 'asc' ? 1 : -1);
        });

        // Clear the list
        list.innerHTML = '';

        // Append all groups (to maintain structure) and sorted items
        groups.forEach(group => list.appendChild(group));
        items.forEach(item => list.appendChild(item));
    }

    // Update current sort
    if (currentSort.key === key) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.order = 'asc';
    }

    console.log(`Sorted by ${key}, order: ${currentSort.order}`);
}

function filterByGroup(groupId) {
    currentFilter = groupId;
    const headers = document.querySelectorAll('.group-header');
    const items = document.querySelectorAll('.list-item');

    headers.forEach(header => {
        header.style.display = (groupId === '' || header.dataset.id === groupId) ? '' : 'none';
    });

    items.forEach(item => {
        item.style.display = (groupId === '' || item.dataset.groupId === groupId) ? '' : 'none';
    });
}

// Call refreshPointsData every 30 seconds when online
setInterval(() => {
    if (navigator.onLine) {
        refreshPointsData();
    }
}, 30000);

// Expose necessary functions to window object for use in app.js
window.refreshPointsData = refreshPointsData;
window.updatePointsDisplay = updatePointsDisplay;