<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();
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
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('attendance'); ?></h1>

    <div class="date-navigation">
        <button id="prevDate">&larr; <?php echo translate('previous'); ?></button>
        <h2 id="currentDate"></h2>
        <button id="nextDate"><?php echo translate('next'); ?> &rarr;</button>
    </div>

    <div id="attendance-container" class="attendance-list"></div>

    <div class="status-buttons">
        <button class="status-button" data-status="non-motivated"><?php echo translate('non_motivated'); ?></button>
        <button class="status-button" data-status="motivated"><?php echo translate('motivated'); ?></button>
        <button class="status-button" data-status="late"><?php echo translate('late'); ?></button>
        <button class="status-button" data-status="present"><?php echo translate('present'); ?></button>
    </div>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <script src="js/functions.js"></script>
    <script type="module" src="js/app.js"></script>

    <script>
        let currentDate = '<?php echo date('Y-m-d'); ?>';
        const lang = '<?php echo $lang; ?>';

        function formatDate(dateString) {
            const options = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto' };
            return new Date(dateString + 'T00:00:00').toLocaleDateString(lang, options);
        }

        document.getElementById('currentDate').textContent = formatDate(currentDate);

        document.getElementById('prevDate').addEventListener('click', () => changeDate('prev'));
        document.getElementById('nextDate').addEventListener('click', () => changeDate('next'));

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

        function loadAttendanceForDate(date) {
            fetch(`api.php?action=get_attendance&date=${date}`)
                .then(response => response.json())
                .then(data => {
                    updateAttendanceUIForDate(data);
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('<?php echo translate("error_loading_attendance"); ?>');
                });
        }

        function loadGroupsAndNames() {
            fetch('api.php?action=get_participants')
                .then(response => response.json())
                .then(data => {
                    renderGroupsAndNames(data);
                    loadAttendanceForDate(currentDate);
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('<?php echo translate("error_loading_participants"); ?>');
                });
        }

        function renderGroupsAndNames(data) {
            const container = document.getElementById('attendance-container');
            container.innerHTML = '';
            let currentGroup = null;

            data.forEach(item => {
                if (currentGroup !== item.group_id) {
                    currentGroup = item.group_id;
                    const groupHeader = document.createElement('div');
                    groupHeader.className = 'group-header';
                    groupHeader.textContent = item.group_name;
                    container.appendChild(groupHeader);
                }
                const nameItem = document.createElement('div');
                nameItem.className = 'name-item';
                nameItem.dataset.id = item.id; // Ensure 'id' is being used correctly
                nameItem.dataset.status = 'present'; // Default status
                nameItem.innerHTML = `
                    <span>${item.first_name}</span>
                    <span class="status">${translate('present')}</span>
                `;
                container.appendChild(nameItem);

                nameItem.addEventListener('click', function() {
                    document.querySelectorAll('.name-item').forEach(i => i.classList.remove('selected'));
                    this.classList.add('selected');
                });
            });
        }


        function updateAttendance(nameId, status) {
            const date = currentDate;
            const previousStatus = document.querySelector(`.name-item[data-id="${nameId}"]`).dataset.status;

            fetch('api.php?action=update_attendance', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    name_id: nameId,
                    status: status,
                    date: date,
                    previous_status: previousStatus,
                })
            })
            .then(response => response.json())
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
        }

        function updateAttendanceUI(nameId, status) {
            const nameItem = document.querySelector(`.name-item[data-id="${nameId}"]`);
            if (nameItem) {
                nameItem.dataset.status = status;
                nameItem.querySelector('.status').textContent = translate(status);
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

        function changeDate(direction) {
            // Implement logic to change date and load attendance
            // Assuming attendanceDates array is fetched from an API
            let newDate = new Date(currentDate);
            if (direction === 'prev') {
                newDate.setDate(newDate.getDate() - 1);
            } else if (direction === 'next') {
                newDate.setDate(newDate.getDate() + 1);
            }
            currentDate = newDate.toISOString().split('T')[0];
            document.getElementById('currentDate').textContent = formatDate(currentDate);
            loadAttendanceForDate(currentDate);
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

        // Initial load
        loadGroupsAndNames();

    </script>
</body>
</html>
