<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// requireLogin();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json = file_get_contents('php://input');
    $honors = json_decode($json, true);

    if (!is_array($honors)) {
        echo json_encode(['status' => 'error', 'message' => 'Invalid data format']);
        exit;
    }

    $pdo = getDbConnection();
    $pdo->beginTransaction();

    try {
        $awards = [];
        foreach ($honors as $honor) {
            $nameId = $honor['nameId'];
            $date = $honor['date'];

            // Check if an honor already exists for this name and date
            $checkStmt = $pdo->prepare("SELECT COUNT(*) FROM honors WHERE name_id = ? AND date = ?");
            $checkStmt->execute([$nameId, $date]);
            $honorExists = $checkStmt->fetchColumn() > 0;

            if (!$honorExists) {
                $stmt = $pdo->prepare("INSERT INTO honors (name_id, date) VALUES (?, ?)");
                $stmt->execute([$nameId, $date]);

                // Add points
                $pointStmt = $pdo->prepare("INSERT INTO points (name_id, value, created_at) VALUES (?, 5, ?)");
                $pointStmt->execute([$nameId, $date]);

                $awards[] = [
                    'nameId' => $nameId,
                    'awarded' => true
                ];
            } else {
                $awards[] = [
                    'nameId' => $nameId,
                    'awarded' => false,
                    'message' => 'Honor already awarded for this date'
                ];
            }
        }

        $pdo->commit();
        echo json_encode(['status' => 'success', 'awards' => $awards]);
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error awarding honor: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method']);
}