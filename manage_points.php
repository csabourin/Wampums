<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Fetch all groups
$stmt = $pdo->query("SELECT id, name FROM groups ORDER BY name");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch all names with their associated group and total points
$query = "
    SELECT n.id, n.first_name, g.id AS group_id, g.name AS group_name, 
           COALESCE(SUM(p.value), 0) AS total_points
    FROM names n 
    JOIN groups g ON n.group_id = g.id 
    LEFT JOIN points p ON n.id = p.name_id
    GROUP BY n.id, g.id
    ORDER BY g.name, n.first_name";

$stmt = $pdo->query($query);
$names = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Calculate total points for each group
$groupPoints = [];
foreach ($groups as $group) {
    $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(value), 0) AS total_points
        FROM points
        WHERE group_id = ?
    ");
    $stmt->execute([$group['id']]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $groupPoints[$group['id']] = $result['total_points'];
}

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
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
            <div class="group-header" data-group-id="<?php echo $group['id']; ?>" data-type="group">
                <?php echo htmlspecialchars($group['name']); ?> - 
                <span id="group-points-<?php echo $group['id']; ?>"><?php echo $groupPoints[$group['id']]; ?> <?php echo translate('points'); ?></span>
            </div>
            <?php foreach ($names as $name): ?>
                <?php if ($name['group_id'] == $group['id']): ?>
                    <div class="list-item" data-name-id="<?php echo $name['id']; ?>" data-type="individual" 
                         data-group-id="<?php echo $name['group_id']; ?>" data-points="<?php echo $name['total_points']; ?>"
                         data-name="<?php echo htmlspecialchars($name['first_name']); ?>">
                        <span><?php echo htmlspecialchars($name['first_name']); ?></span>
                        <span id="name-points-<?php echo $name['id']; ?>"><?php echo $name['total_points']; ?> <?php echo translate('points'); ?></span>
                    </div>
                <?php endif; ?>
            <?php endforeach; ?>
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
      <script type="module" src="js/points_script.js"></script>
</body>
</html>