<?php
ob_start();
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $json = file_get_contents('php://input');
    $offlineData = json_decode($json, true);

    if (!is_array($offlineData)) {
        echo json_encode(['success' => false, 'message' => 'Invalid data format']);
        exit;
    }

    $pdo = getDbConnection();
    $pdo->beginTransaction();

    try {
        foreach ($offlineData as $item) {
            if ($item['action'] === 'updatePoints') {
                $stmt = $pdo->prepare("INSERT INTO points (name_id, group_id, value, created_at) VALUES (?, ?, ?, ?)");
                $stmt->execute([
                    $item['data']['type'] === 'individual' ? $item['data']['id'] : null,
                    $item['data']['type'] === 'group' ? $item['data']['id'] : null,
                    $item['data']['points'],
                    $item['data']['timestamp']
                ]);
            } elseif ($item['action'] === 'updateAttendance') {
                $stmt = $pdo->prepare("INSERT INTO attendance (name_id, date, status) VALUES (?, ?, ?) ON CONFLICT (name_id, date) DO UPDATE SET status = EXCLUDED.status");
                $stmt->execute([
                    $item['data']['nameId'],
                    $item['data']['date'],
                    $item['data']['status']
                ]);
            }
            // Add more cases for other types of offline actions as needed
        }

        $pdo->commit();
        echo json_encode(['success' => true, 'message' => 'Offline data synced successfully']);
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'message' => 'Error syncing offline data: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['success' => false, 'message' => 'Invalid request method']);
}
ob_end_clean(); // Clean the output buffer before sending the JSON response
?>