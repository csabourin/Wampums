<?php
require_once 'config.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Check user role and redirect if parent
if ($_SESSION['user_role'] === 'parent') {
    header('Location: index.php');
    exit;
}

// Fetch all groups and their associated names
$query = "
SELECT p.id AS name_id, p.first_name, g.id AS group_id, g.name AS group_name, 
       COALESCE(SUM(pt.value), 0) AS total_points
FROM participants p
LEFT JOIN groups g ON p.group_id = g.id
LEFT JOIN points pt ON p.id = pt.name_id
GROUP BY p.id, g.id, g.name
ORDER BY g.name, p.first_name";

$stmt = $pdo->query($query);
    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Organize results by group
$groups = [];
foreach ($results as $row) {
    $groupId = $row['group_id'];
    if (!isset($groups[$groupId])) {
        $groups[$groupId] = [
            'name' => $row['group_name'],
            'names' => []
        ];
    }
    if ($row['name_id']) {
        $groups[$groupId]['names'][] = [
            'id' => $row['name_id'],
            'name' => $row['first_name'],
            'points' => $row['total_points']
        ];
    }
}

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="./images/icon-192x192.png">
    <title><?php echo translate('dashboard_title'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        .group {
            margin-bottom: 20px;
            background-color: #f9f9f9;
            border-radius: 5px;
            padding: 10px;
        }
        .name-list {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 5px;
        }
        .name-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: #fff;
            padding: 10px;
            margin-bottom: 5px;
            border-radius: 3px;
        }
        .name-item span {
            flex: 1;
        }
        .name-item .points {
            text-align: right;
            font-weight: bold;
        }
        @media (max-width: 600px) {
            .manage-items {
                flex-direction: row;
            }
            .manage-items a {
                width: 100%;
                margin-bottom: 10px;
            }
            .name-item {
                flex-direction: column;
                align-items: flex-start;
            }
            .name-item .points {
                align-self: flex-end;
            }
        }
    </style>
</head>
<body>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator" style="display: none;">
        <?php echo translate('you_are_offline'); ?>
    </div>
    <h1><?php echo translate('dashboard_title'); ?></h1>
    <div class="manage-items">
        <a href="manage_points.php"><?php echo translate('manage_points'); ?></a>
        <a href="manage_honors.php"><?php echo translate('manage_honors'); ?></a>
        <a href="attendance.php"><?php echo translate('attendance'); ?></a>
    </div>
    <div style="display: flex; flex-direction: column; align-items: center;">
        <img width="335" style="max-width:100%;height:auto" src="./images/6eASt-Paul.png" alt="6e A St-Paul d'Aylmer">
    </div>
    <div class="manage-items">
        <a href="manage_participants.php"><?php echo translate('manage_names'); ?></a>
        <a href="manage_groups.php"><?php echo translate('manage_groups'); ?></a>
         <a href="view_participant_documents.php"><?php echo translate('view_participant_documents'); ?></a>
         <a href="approve_badges.php"><?php echo translate('approve_badges'); ?></a>
        <a href="index.php"><?php echo translate('vue_parents'); ?></a>
        <a href="parent_contact_list.php"><?php echo translate('parent_contact_list'); ?></a>
        <a href="manage_users_participants.php"><?php echo translate('manage_participants'); ?></a>
    </div>

    <div id="points-list"></div>
    
    <p><a href="logout.php"><?php echo translate('logout'); ?></a></p>
    <script src="get_translations.php"></script>
    <script src="js/functions.js"></script>
    <script src="js/ajax-functions.js"></script>
    <script type="module" src="js/app.js"></script>
    <script type="module" src="js/points_manager.js"></script>
    <script>
    document.addEventListener('DOMContentLoaded', async function() {
        try {
            const participants = await getParticipants();
            const groups = await getGroups();
            updateDashboard(participants, groups);
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    });

    function updateDashboard(participants, groups) {
        const pointsList = document.getElementById('points-list');
        let html = '';

        groups.forEach(group => {
            html += `
                <div class="group-header" data-group-id="${group.id}">
                    ${group.name} - 
                    <span id="group-points-${group.id}">${group.total_points} ${translations.points}</span>
                </div>
                <div class="group-content">
            `;

            const groupParticipants = participants.filter(p => p.group_id == group.id);
            groupParticipants.forEach(participant => {
                html += `
                    <div class="list-item" data-name-id="${participant.id}" data-type="individual" 
                         data-group-id="${participant.group_id}" data-points="${participant.total_points}"
                         data-name="${participant.first_name}">
                        <span>${participant.first_name} ${participant.last_name}</span>
                        <span id="name-points-${participant.id}">${participant.total_points} ${translations.points}</span>
                    </div>
                `;
            });

            html += '</div>';
        });

        pointsList.innerHTML = html;
    }
    </script>
    <div id="cache-progress-container" style="display: none;">
        <div id="cache-progress-bar"></div>
        <div id="cache-progress-text">Téléchargement des fichiers hors-ligne...</div>
    </div>
</body>
</html>