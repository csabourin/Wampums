<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// requireLogin();

$pdo = getDbConnection();

// Fetch all groups and names
$query = "
    SELECT g.id AS group_id, g.name AS group_name, n.id AS name_id, n.first_name
    FROM groups g
    LEFT JOIN names n ON g.id = n.group_id
    ORDER BY g.name, n.first_name
";
$stmt = $pdo->query($query);
$groupsAndNames = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch attendance dates
$query = "
    SELECT DISTINCT date
    FROM attendance
    ORDER BY date DESC
    LIMIT 10
";
$stmt = $pdo->query($query);
$attendanceDates = $stmt->fetchAll(PDO::FETCH_COLUMN);

// Get current date
$currentDate = date('Y-m-d');

// Fetch attendance for the current date
$query = "
    SELECT name_id, status
    FROM attendance
    WHERE date = ?
";
$stmt = $pdo->prepare($query);
$stmt->execute([$currentDate]);
$currentAttendance = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('attendance'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
</head>
<body>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('attendance'); ?></h1>

    <div class="date-navigation">
        <button id="prevDate">&larr; <?php echo translate('previous'); ?></button>
        <h2 id="currentDate"></h2>
        <button id="nextDate"><?php echo translate('next'); ?> &rarr;</button>
    </div>

    <div class="attendance-list">
        <?php
        $currentGroup = null;
        foreach ($groupsAndNames as $item) {
            if ($currentGroup !== $item['group_id']) {
                $currentGroup = $item['group_id'];
                echo "<div class='group-header'>" . htmlspecialchars($item['group_name']) . "</div>";
            }
            if ($item['name_id']) {
                $status = $currentAttendance[$item['name_id']] ?? 'present';
                echo "<div class='name-item' data-id='{$item['name_id']}' data-status='{$status}'>";
                echo "<span>" . htmlspecialchars($item['first_name']) . "</span>";
                echo "<span class='status'>" . translate($status) . "</span>";
                echo "</div>";
            }
        }
        ?>
    </div>

    <div class="status-buttons">
        <button class="status-button" data-status="non-motivated"><?php echo translate('non-motivated'); ?></button>
        <button class="status-button" data-status="motivated"><?php echo translate('motivated'); ?></button>
        <button class="status-button" data-status="late"><?php echo translate('late'); ?></button>
        <button class="status-button" data-status="present"><?php echo translate('present'); ?></button>
    </div>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

            <script type="module" src="js/app.js"></script>

        <script>
            let currentDate = '<?php echo date('Y-m-d'); ?>';
            const attendanceDates = <?php echo json_encode($attendanceDates); ?>;

            function formatDate(dateString) {
                const options = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto' };
                return new Date(dateString + 'T00:00:00').toLocaleDateString('<?php echo $lang; ?>', options);
            }
            
            document.getElementById('currentDate').textContent = new Date(currentDate + 'T00:00:00').toLocaleDateString('<?php echo $lang; ?>', { day: 'numeric', month: 'long', year: 'numeric' });

            document.getElementById('prevDate').addEventListener('click', () => changeDate('prev'));
            document.getElementById('nextDate').addEventListener('click', () => changeDate('next'));

            // Add event listeners for name items and status buttons
            document.querySelectorAll('.name-item').forEach(item => {
                item.addEventListener('click', function() {
                    document.querySelectorAll('.name-item').forEach(i => i.classList.remove('selected'));
                    this.classList.add('selected');
                });
            });

            document.querySelectorAll('.status-button').forEach(button => {
                button.addEventListener('click', function() {
                    const selectedItem = document.querySelector('.name-item.selected');
                    if (selectedItem) {
                        updateAttendance(selectedItem.dataset.id, this.dataset.status);
                    } else {
                        alert('<?php echo translate("please_select_name"); ?>');
                    }
                });
            });

            function updateAttendance(nameId, status) {
                const date = currentDate;
                const previousStatus = document.querySelector(`.name-item[data-id="${nameId}"]`).dataset.status;

                if (navigator.onLine) {
                    fetch('update_attendance.php', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: `name_id=${nameId}&status=${status}&date=${date}&previous_status=${previousStatus}`
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
                        updateAttendanceUI(nameId, status);
                        if (data.point_adjustment !== 0) {
                            updatePointsUI(nameId, data.point_adjustment);
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('<?php echo translate("error_updating_attendance"); ?>: ' + error.message);
                    });
                } else {
                    updateAttendanceUI(nameId, status);
                    const pointAdjustment = calculateOfflinePointAdjustment(previousStatus, status);
                    if (pointAdjustment !== 0) {
                        updatePointsUI(nameId, pointAdjustment);
                    }
                    saveOfflineData('updateAttendance', { nameId, date, status, previousStatus });
                }
            }

            function updateAttendanceUI(nameId, status) {
                const nameItem = document.querySelector(`.name-item[data-id="${nameId}"]`);
                if (nameItem) {
                    nameItem.dataset.status = status;
                    nameItem.querySelector('.status').textContent = translate(status);
                }
            }

            function updatePointsUI(nameId, pointAdjustment) {
                const nameItem = document.querySelector(`.name-item[data-id="${nameId}"]`);
                if (nameItem) {
                    const pointsElement = nameItem.querySelector('.points');
                    if (pointsElement) {
                        let currentPoints = parseInt(pointsElement.textContent) || 0;
                        currentPoints += pointAdjustment;
                        pointsElement.textContent = currentPoints;
                    } else {
                        const pointsElement = document.createElement('span');
                        pointsElement.className = 'points';
                        pointsElement.textContent = pointAdjustment > 0 ? pointAdjustment : 0;
                        nameItem.appendChild(pointsElement);
                    }
                }
            }

            function calculateOfflinePointAdjustment(oldStatus, newStatus) {
                if (oldStatus === newStatus) return 0;
                if (oldStatus === 'non-motivated' && newStatus !== 'non-motivated') {
                    return 1;  // Give back the point
                } else if (oldStatus !== 'non-motivated' && newStatus === 'non-motivated') {
                    return -1; // Take away a point
                }
                return 0;  // No point adjustment for other status changes
            }

            function saveOfflineData(action, data) {
                let offlineData = JSON.parse(localStorage.getItem('offlineData')) || [];
                offlineData.push({ action, data });
                localStorage.setItem('offlineData', JSON.stringify(offlineData));

                // Also save to a separate storage for attendance data
                if (action === 'updateAttendance') {
                    let offlineAttendance = JSON.parse(localStorage.getItem('offlineAttendance')) || {};
                    if (!offlineAttendance[data.date]) {
                        offlineAttendance[data.date] = {};
                    }
                    offlineAttendance[data.date][data.nameId] = {
                        status: data.status,
                        previousStatus: data.previousStatus,
                        pointAdjustment: calculateOfflinePointAdjustment(data.previousStatus, data.status)
                    };
                    localStorage.setItem('offlineAttendance', JSON.stringify(offlineAttendance));
                }
            }

            function syncOfflineData() {
                const offlineData = JSON.parse(localStorage.getItem('offlineData')) || [];
                if (offlineData.length === 0) return;

                fetch('sync_attendance.php', {
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
                        localStorage.removeItem('offlineAttendance');
                        console.log('Offline data synced successfully');
                        loadAttendanceForDate(currentDate); // Reload current date's attendance
                        if (data.point_adjustments) {
                            applyPointAdjustments(data.point_adjustments);
                        }
                    } else {
                        console.error('Error syncing offline data:', data.message);
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                });
            }

            function applyPointAdjustments(adjustments) {
                for (const [nameId, adjustment] of Object.entries(adjustments)) {
                    updatePointsUI(nameId, adjustment);
                }
            }

            function changeDate(direction) {
                const currentIndex = attendanceDates.indexOf(currentDate);
                let newIndex;

                if (direction === 'prev') {
                    newIndex = currentIndex + 1;
                } else if (direction === 'next') {
                    newIndex = currentIndex - 1;
                }

                if (newIndex >= 0 && newIndex < attendanceDates.length) {
                    currentDate = attendanceDates[newIndex];
                    document.getElementById('currentDate').textContent = formatDate(currentDate);
                    loadAttendanceForDate(currentDate);
                } else {
                    console.log("No more dates available");
                }
            }

            function loadAttendanceForDate(date) {
                if (navigator.onLine) {
                    fetch(`get_attendance.php?date=${date}`)
                    .then(response => response.json())
                    .then(data => {
                        updateAttendanceUIForDate(data);
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('<?php echo translate("error_loading_attendance"); ?>');
                    });
                } else {
                    const offlineData = JSON.parse(localStorage.getItem('offlineAttendance')) || {};
                    const dateData = offlineData[date] || {};
                    updateAttendanceUIForDate(dateData);
                }
            }


            function updateAttendanceUIForDate(data) {
                document.querySelectorAll('.name-item').forEach(item => {
                    const nameId = item.dataset.id;
                    const status = data[nameId] || 'present';
                    item.dataset.status = status;
                    item.querySelector('.status').textContent = translate(status);
                });
            }

            function saveOfflineData(action, data) {
                let offlineData = JSON.parse(localStorage.getItem('offlineData')) || [];
                offlineData.push({ action, data });
                localStorage.setItem('offlineData', JSON.stringify(offlineData));

                // Also save to a separate storage for attendance data
                if (action === 'updateAttendance') {
                    let offlineAttendance = JSON.parse(localStorage.getItem('offlineAttendance')) || {};
                    if (!offlineAttendance[data.date]) {
                        offlineAttendance[data.date] = {};
                    }
                    offlineAttendance[data.date][data.nameId] = data.status;
                    localStorage.setItem('offlineAttendance', JSON.stringify(offlineAttendance));
                }
            }

            function translate(key) {
                const translations = {
                    'non-motivated': '<?php echo translate("non_motivated"); ?>',
                    'motivated': '<?php echo translate("motivated"); ?>',
                    'late': '<?php echo translate("late"); ?>',
                    'present': '<?php echo translate("present"); ?>'
                };
                return translations[key] || key;
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

                fetch('sync_attendance.php', {
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
                        localStorage.removeItem('offlineAttendance');
                        console.log('Offline data synced successfully');
                        loadAttendanceForDate(currentDate); // Reload current date's attendance
                    } else {
                        console.error('Error syncing offline data:', data.message);
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                });
            }

            // Initial load
            loadAttendanceForDate(currentDate);

        </script>
    </script>
</body>
</html>