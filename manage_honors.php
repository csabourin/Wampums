<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Determine the start of the academic year
$currentMonth = date('n');
$currentYear = date('Y');
$academicYearStart = ($currentMonth >= 9) ? "$currentYear-09-01" : ($currentYear - 1) . "-09-01";

// Fetch groups
$groupQuery = "SELECT id, name FROM groups ORDER BY name";
$groupStmt = $pdo->query($groupQuery);
$groups = $groupStmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch names with honors count
$query = "
    SELECT n.id AS name_id, n.first_name, g.id AS group_id, g.name AS group_name,
           COALESCE(honor_counts.total_honors, 0) AS total_honors
    FROM names n
    JOIN groups g ON n.group_id = g.id
    LEFT JOIN (
        SELECT name_id, COUNT(*) as total_honors
        FROM honors
        WHERE date >= :academic_year_start AND date <= CURRENT_DATE
        GROUP BY name_id
    ) honor_counts ON n.id = honor_counts.name_id
    ORDER BY g.name, n.first_name
";

$stmt = $pdo->prepare($query);
$stmt->execute([
    'academic_year_start' => $academicYearStart
]);

$names = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Organize names by group
$namesByGroup = [];
foreach ($names as $name) {
    $groupId = $name['group_id'];
    if (!isset($namesByGroup[$groupId])) {
        $namesByGroup[$groupId] = [];
    }
    $namesByGroup[$groupId][] = $name;
}

// Get current date for JavaScript
$currentDate = date('Y-m-d');

// Fetch honor dates (you might need to adjust this query based on your needs)
$honorDatesQuery = "
    SELECT DISTINCT date
    FROM honors
    WHERE date <= CURRENT_DATE
    ORDER BY date DESC
    LIMIT 10
";
$honorDatesStmt = $pdo->query($honorDatesQuery);
$honorDates = $honorDatesStmt->fetchAll(PDO::FETCH_COLUMN);
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
    <title><?php echo translate('manage_honors'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="offline-indicator" style="display: none;">
      <?php echo translate('you_are_offline'); ?>
    </div>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('manage_honors'); ?></h1>

    <div class="date-navigation">
        <button id="prevDate">&larr; <?php echo translate('previous'); ?></button>
        <h2 id="currentDate"></h2>
        <button id="nextDate"><?php echo translate('next'); ?> &rarr;</button>
    </div>

    <div class="sort-options">
        <button onclick="sortItems('name')"><?php echo translate('sort_by_name'); ?></button>
        <button onclick="sortItems('honors')"><?php echo translate('sort_by_honors'); ?></button>
    </div>

    <div id="honors-list">
        <?php foreach ($groups as $group): ?>
            <div class="group-header" data-id="<?php echo $group['id']; ?>">
                <?php echo htmlspecialchars($group['name']); ?>
            </div>
            <?php if (isset($namesByGroup[$group['id']])): ?>
                <?php foreach ($namesByGroup[$group['id']] as $name): ?>
                    <div class="list-item" data-id="<?php echo $name['name_id']; ?>" data-type="individual" 
                         data-group-id="<?php echo $name['group_id']; ?>" 
                         data-honors="<?php echo $name['total_honors']; ?>"
                         data-name="<?php echo htmlspecialchars($name['first_name']); ?>">
                        <span><?php echo htmlspecialchars($name['first_name']); ?></span>
                        <span class="honor-count"><?php echo $name['total_honors']; ?> <?php echo translate('honors'); ?></span>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>

    <div class="fixed-bottom">
        <button class="honor-btn" onclick="awardHonor()"><?php echo translate('award_honor'); ?></button>
    </div>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <script type="module" src="js/app.js"></script>
    <script>
        // Translations
        const translations = {
            honors: <?php echo json_encode(translate('honors')); ?>,
            points: <?php echo json_encode(translate('points')); ?>,
            selectIndividuals: <?php echo json_encode(translate('select_individuals')); ?>,
            errorAwardingHonor: <?php echo json_encode(translate('error_awarding_honor')); ?>,
            honorAwardedSuccessfully: <?php echo json_encode(translate('honor_awarded_successfully')); ?>,
            noHonorsOnThisDate: <?php echo json_encode(translate('no_honors_on_this_date')); ?>,
            errorLoadingHonors: <?php echo json_encode(translate('error_loading_honors')); ?>
        };

        let currentDate = '<?php echo $currentDate; ?>';
        const honorDates = <?php echo json_encode($honorDates); ?>;
        let selectedItems = new Set();

        document.getElementById('currentDate').textContent = formatDate(currentDate);

        document.getElementById('prevDate').addEventListener('click', () => changeDate('prev'));
        document.getElementById('nextDate').addEventListener('click', () => changeDate('next'));

        document.querySelectorAll('.list-item').forEach(item => {
            item.addEventListener('click', function() {
                this.classList.toggle('selected');
                if (this.classList.contains('selected')) {
                    selectedItems.add(this.dataset.id);
                } else {
                    selectedItems.delete(this.dataset.id);
                }
            });
        });

        function formatDate(dateString) {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            return new Date(dateString + 'T00:00:00').toLocaleDateString('<?php echo $lang; ?>', options);
        }

        function changeDate(direction) {
            const currentIndex = honorDates.indexOf(currentDate);
            let newIndex;

            if (direction === 'prev') {
                newIndex = currentIndex + 1;
            } else if (direction === 'next') {
                newIndex = currentIndex - 1;
            }

            if (newIndex >= 0 && newIndex < honorDates.length) {
                currentDate = honorDates[newIndex];
            } else if (direction === 'next' && (currentIndex <= 0 || currentIndex === -1)) {
                currentDate = '<?php echo date('Y-m-d'); ?>'; // Set to today's date
            } else {
                console.log("No more dates available");
                return;
            }

            document.getElementById('currentDate').textContent = formatDate(currentDate);
            loadHonorsForDate(currentDate);
        }

        function loadHonorsForDate(date) {
            if (date === '<?php echo date('Y-m-d'); ?>') {
                showAllNames();
                return;
            }

            fetch(`get_honors.php?date=${date}`)
            .then(response => response.json())
            .then(result => {
                if (result.status === 'success') {
                    const data = result.data;
                    const honorsList = document.getElementById('honors-list');
                    honorsList.innerHTML = '';

                    let currentGroup = null;
                    data.forEach(honor => {
                        if (currentGroup !== honor.group_name) {
                            currentGroup = honor.group_name;
                            const groupHeader = document.createElement('div');
                            groupHeader.className = 'group-header';
                            groupHeader.textContent = honor.group_name;
                            honorsList.appendChild(groupHeader);
                        }

                        const item = document.createElement('div');
                        item.className = 'list-item';
                        item.dataset.id = honor.name_id;
                        item.dataset.type = 'individual';
                        item.dataset.groupId = honor.group_id;
                        item.dataset.honors = honor.total_honors;
                        item.dataset.name = honor.first_name;

                        item.innerHTML = `
                            <span>${honor.first_name}</span>
                            <span class="honor-count">${honor.total_honors} ${translations.honors}</span>
                        `;

                        honorsList.appendChild(item);
                    });

                    if (honorsList.children.length === 0) {
                        honorsList.innerHTML = `<p>${translations.noHonorsOnThisDate}</p>`;
                    }
                } else {
                    throw new Error(result.message || 'Unknown error occurred');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert(translations.errorLoadingHonors);
            });
        }

        function showAllNames() {
            const honorsList = document.getElementById('honors-list');
            honorsList.innerHTML = ''; // Clear the list

            let groupHeader, item;

            <?php foreach ($groups as $group): ?>
            groupHeader = document.createElement('div');
            groupHeader.className = 'group-header';
            groupHeader.textContent = '<?php echo addslashes($group['name']); ?>';
            honorsList.appendChild(groupHeader);

            <?php if (isset($namesByGroup[$group['id']])): ?>
            <?php foreach ($namesByGroup[$group['id']] as $name): ?>
            item = document.createElement('div');
            item.className = 'list-item';
            item.dataset.id = '<?php echo $name['name_id']; ?>';
            item.dataset.type = 'individual';
            item.dataset.groupId = '<?php echo $name['group_id']; ?>';
            item.dataset.honors = '<?php echo $name['total_honors']; ?>';
            item.dataset.name = '<?php echo addslashes($name['first_name']); ?>';
            item.innerHTML = `
                <span><?php echo addslashes($name['first_name']); ?></span>
                <span class="honor-count"><?php echo $name['total_honors']; ?> ${translations.honors}</span>
            `;
            item.addEventListener('click', toggleSelection);
            honorsList.appendChild(item);
            <?php endforeach; ?>
            <?php endif; ?>
            <?php endforeach; ?>

            selectedItems.clear();
        }

        function toggleSelection(event) {
            const item = event.currentTarget;
            if (!item.classList.contains('disabled')) {
                item.classList.toggle('selected');
                if (item.classList.contains('selected')) {
                    selectedItems.add(item.dataset.id);
                } else {
                    selectedItems.delete(item.dataset.id);
                }
            }
        }

        function awardHonor() {
            if (selectedItems.size === 0) {
                alert(translations.selectIndividuals);
                return;
            }

            const honors = Array.from(selectedItems).map(id => ({
                nameId: id,
                date: currentDate
            }));

            if (navigator.onLine) {
                fetch('award_honor.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(honors)
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success') {
                        updateHonorsUI(data.awards);
                        selectedItems.clear();
                        loadHonorsForDate(currentDate); // Reload the current date to reflect changes
                    } else {
                        alert(data.message);
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert(translations.errorAwardingHonor);
                });
            } else {
                saveOfflineData('awardHonor', honors);
                updateHonorsUI(honors.map(h => ({ nameId: h.nameId, awarded: true })));
                selectedItems.clear();
                loadHonorsForDate(currentDate); // Reload the current date to reflect changes
            }
        }

        function updateHonorsUI(awards) {
            awards.forEach(award => {
                if (award.awarded) {
                    const item = document.querySelector(`.list-item[data-id="${award.nameId}"]`);
                    if (item) {
                        const honorCount = item.querySelector('.honor-count');
                        const currentHonors = parseInt(honorCount.textContent);
                        honorCount.textContent = `${currentHonors + 1} ${translations.honors}`;
                        item.classList.add('disabled');
                    }
                }
            });
        }



        function sortItems(key) {
            const list = document.getElementById('honors-list');
            const items = Array.from(list.querySelectorAll('.list-item'));
            const headers = Array.from(list.querySelectorAll('.group-header'));

            items.sort((a, b) => {
                if (key === 'name') {
                    return a.dataset.name.localeCompare(b.dataset.name);
                } else if (key === 'honors') {
                    return parseInt(b.dataset.honors) - parseInt(a.dataset.honors);
                } else if (key === 'points') {
                    return parseInt(b.dataset.points) - parseInt(a.dataset.points);
                } else { // group
                    return a.dataset.groupId.localeCompare(b.dataset.groupId);
                }
            });

            list.innerHTML = '';

            if (key === 'group') {
                headers.forEach(header => {
                    list.appendChild(header);
                    const groupId = header.dataset.id;
                    items.filter(item => item.dataset.groupId === groupId).forEach(item => list.appendChild(item));
                });
            } else {
                items.forEach(item => list.appendChild(item));
            }
        }

        function filterByGroup(groupId) {
            document.querySelectorAll('.list-item').forEach(item => {
                if (groupId === '' || item.dataset.groupId === groupId) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            document.querySelectorAll('.group-header').forEach(header => {
                if (groupId === '' || header.dataset.id === groupId) {
                    header.style.display = '';
                } else {
                    header.style.display = 'none';
                }
            });
        }


        function saveOfflineData(action, data) {
            let offlineData = JSON.parse(localStorage.getItem('offlineData')) || [];
            offlineData.push({ action, data });
            localStorage.setItem('offlineData', JSON.stringify(offlineData));
        }

        // Add event listeners for online/offline events
        window.addEventListener('online', () => {
            console.log('Back online');
            syncOfflineData();
        });

        window.addEventListener('offline', () => {
            console.log('Gone offline');
        });

        function syncOfflineData() {
            const offlineData = JSON.parse(localStorage.getItem('offlineData')) || [];
            if (offlineData.length === 0) return;

            fetch('sync_honors.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(offlineData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    localStorage.removeItem('offlineData');
                    console.log('Offline data synced successfully');
                    location.reload(); // Reload the page to get the latest data
                } else {
                    console.error('Error syncing offline data:', data.message);
                }
            })
            .catch(error => {
                console.error('Error:', error);
            });
        }

        // Initial load
        if (currentDate === '<?php echo $currentDate; ?>') {
            showAllNames();
        } else {
            loadHonorsForDate(currentDate);
        }
    </script>
</body>
</html>