<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Fetch all groups with their points
$groupQuery = "
    SELECT g.id, g.name, COALESCE(SUM(p.value), 0) AS total_points
    FROM groups g
    LEFT JOIN points p ON g.id = p.group_id
    GROUP BY g.id, g.name
    ORDER BY g.name
";
$groupStmt = $pdo->query($groupQuery);
$groups = $groupStmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch all participants with their points
$participantQuery = "
    SELECT p.id, p.first_name, p.group_id, g.name AS group_name, COALESCE(SUM(pt.value), 0) AS total_points
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    LEFT JOIN points pt ON p.id = pt.name_id
    GROUP BY p.id, p.first_name, p.group_id, g.name
    ORDER BY g.name, p.first_name
";
$participantStmt = $pdo->query($participantQuery);
$participants = $participantStmt->fetchAll(PDO::FETCH_ASSOC);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('manage_points'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="offline-indicator" style="display: none;">
      <?php echo translate('you_are_offline'); ?>
    </div>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('manage_points'); ?></h1>

    <div class="sort-options">
        <button data-sort="name"><?php echo translate('sort_by_name'); ?></button>
        <button data-sort="group"><?php echo translate('sort_by_group'); ?></button>
        <button data-sort="points"><?php echo translate('sort_by_points'); ?></button>
    </div>

    <div class="filter-options">
        <label for="group-filter"><?php echo translate('filter_by_group'); ?>:</label>
        <select id="group-filter" onchange="filterByGroup(this.value)">
            <option value=""><?php echo translate('all_groups'); ?></option>
            <?php foreach ($groups as $group): ?>
                <option value="<?php echo $group['id']; ?>">
                    <?php echo htmlspecialchars($group['name']); ?>
                </option>
            <?php endforeach; ?>
        </select>
    </div>

    <div id="points-list">
        <?php foreach ($groups as $group): ?>
            <div class="group-header" data-group-id="<?php echo $group['id']; ?>" data-type="group" data-points="<?php echo $group['total_points']; ?>">
                <?php echo htmlspecialchars($group['name']); ?> - 
                <span id="group-points-<?php echo $group['id']; ?>"><?php echo $group['total_points']; ?> <?php echo translate('points'); ?></span>
            </div>
            <div class="group-content">
                <?php 
                $groupParticipants = array_filter($participants, function($p) use ($group) {
                    return $p['group_id'] == $group['id'];
                });
                foreach ($groupParticipants as $participant): 
                ?>
                    <div class="list-item" data-name-id="<?php echo $participant['id']; ?>" data-type="individual" 
                         data-group-id="<?php echo $participant['group_id']; ?>" data-points="<?php echo $participant['total_points']; ?>"
                         data-name="<?php echo htmlspecialchars($participant['first_name']); ?>">
                        <span><?php echo htmlspecialchars($participant['first_name']); ?></span>
                        <span id="name-points-<?php echo $participant['id']; ?>"><?php echo $participant['total_points']; ?> <?php echo translate('points'); ?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="fixed-bottom">
        <button class="point-btn add" data-points="1">+1</button>
        <button class="point-btn add" data-points="3">+3</button>
        <button class="point-btn add" data-points="5">+5</button>
        <button class="point-btn remove" data-points="-1">-1</button>
        <button class="point-btn remove" data-points="-3">-3</button>
        <button class="point-btn remove" data-points="-5">-5</button>
    </div>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <script src="js/functions.js"></script>
    <script type="module" src="js/app.js"></script>
    <script type="module" src="js/points_manager.js"></script>
</body>
</html>