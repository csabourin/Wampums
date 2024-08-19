<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json = file_get_contents('php://input');
    $offlineData = json_decode($json, true);

    if (!is_array($offlineData)) {
        echo json_encode(['status' => 'error', 'message' => 'Invalid data format']);
        exit;
    }

    $pdo = getDbConnection();
    $pdo->beginTransaction();

    try {
        foreach ($offlineData as $item) {
            if ($item['action'] === 'awardHonor') {
                foreach ($item['data'] as $honor) {
                    $nameId = $honor['nameId'];
                    $date = $honor['date'];

                    $stmt = $pdo->prepare("
                        INSERT INTO honors (name_id, date)
                        VALUES (?, ?)
                        ON CONFLICT (name_id, date) DO NOTHING
                        RETURNING id
                    ");
                    $stmt->execute([$nameId, $date]);
                    $result = $stmt->fetch(PDO::FETCH_ASSOC);

                    if ($result !== false) {
                        // Add points to the points table
                        $pointStmt = $pdo->prepare("
                            INSERT INTO points (name_id, value, created_at)
                            VALUES (?, 5, ?)
                        ");
                        $pointStmt->execute([$nameId, $date]);
                    }
                }
            }
        }

        $pdo->commit();
        echo json_encode(['status' => 'success', 'message' => 'Offline data synced successfully']);
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error syncing offline data: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method']);
}