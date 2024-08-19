<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

try {
    if ($_SERVER['REQUEST_METHOD'] != 'POST') {
        throw new Exception('Invalid request method');
    }

    $json = file_get_contents('php://input');
    $data = json_decode($json, true);

    if (!$data) {
        throw new Exception('Invalid JSON data');
    }

    $type = $data['type'];
    $id = (int)$data['id'];
    $points = (int)$data['points'];
    $timestamp = $data['timestamp'];

    $pdo = getDbConnection();
    $pdo->beginTransaction();

    if ($type === 'group') {
        // Insert points for the group
        $stmt = $pdo->prepare("INSERT INTO points (group_id, value, created_at) VALUES (?, ?, ?)");
        $stmt->execute([$id, $points, $timestamp]);

        // Fetch all members of the group
        $stmt = $pdo->prepare("SELECT id FROM names WHERE group_id = ?");
        $stmt->execute([$id]);
        $members = $stmt->fetchAll(PDO::FETCH_COLUMN);

        // Insert points for each member
        $stmt = $pdo->prepare("INSERT INTO points (name_id, value, created_at) VALUES (?, ?, ?)");
        foreach ($members as $memberId) {
            $stmt->execute([$memberId, $points, $timestamp]);
        }

        // Fetch updated total points for the group
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(value), 0) as total_points FROM points WHERE group_id = ?");
        $stmt->execute([$id]);
        $totalPoints = $stmt->fetchColumn();

        // Fetch updated points for all members of the group
        $stmt = $pdo->prepare("
            SELECT n.id, COALESCE(SUM(p.value), 0) as total_points
            FROM names n
            LEFT JOIN points p ON n.id = p.name_id
            WHERE n.group_id = ?
            GROUP BY n.id
        ");
        $stmt->execute([$id]);
        $memberPoints = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

        $response = [
            'status' => 'success',
            'totalPoints' => $totalPoints,
            'memberPoints' => $memberPoints
        ];
    } else {
        // Insert points for the individual
        $stmt = $pdo->prepare("INSERT INTO points (name_id, value, created_at) VALUES (?, ?, ?)");
        $stmt->execute([$id, $points, $timestamp]);

        // Fetch updated total points for the individual
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(value), 0) as total_points FROM points WHERE name_id = ?");
        $stmt->execute([$id]);
        $totalPoints = $stmt->fetchColumn();

        $response = [
            'status' => 'success',
            'totalPoints' => $totalPoints
        ];
    }

    $pdo->commit();
    echo json_encode($response);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}