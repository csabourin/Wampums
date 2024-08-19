<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// requireLogin();

header('Content-Type: application/json');

try {
    $pdo = getDbConnection();

    // Fetch all groups with total points
    $groupQuery = "
        SELECT g.id, g.name, COALESCE(SUM(p.value), 0) AS total_points
        FROM groups g
        LEFT JOIN points p ON g.id = p.group_id
        GROUP BY g.id, g.name
        ORDER BY g.name
    ";
    $groupStmt = $pdo->query($groupQuery);
    $groups = $groupStmt->fetchAll(PDO::FETCH_ASSOC);

    // Fetch all names with their associated group and total points
    $nameQuery = "
        SELECT n.id, n.first_name, n.group_id, COALESCE(SUM(p.value), 0) AS total_points
        FROM names n 
        LEFT JOIN points p ON n.id = p.name_id
        GROUP BY n.id, n.first_name, n.group_id
        ORDER BY n.first_name
    ";
    $nameStmt = $pdo->query($nameQuery);
    $names = $nameStmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'groups' => $groups,
        'names' => $names
    ]);
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}