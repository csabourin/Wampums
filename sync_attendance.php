<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// requireLogin();

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
        $pointAdjustments = [];

        foreach ($offlineData as $item) {
            if ($item['action'] === 'updateAttendance') {
                $nameId = $item['data']['nameId'];
                $date = $item['data']['date'];
                $status = $item['data']['status'];
                $previousStatus = $item['data']['previousStatus'];

                // Calculate point adjustment
                $pointAdjustment = calculatePointAdjustment($previousStatus, $status);

                // Update attendance with point adjustment
                $stmt = $pdo->prepare("
                    INSERT INTO attendance (name_id, date, status, point_adjustment)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (name_id, date) DO UPDATE 
                    SET status = EXCLUDED.status, 
                        point_adjustment = attendance.point_adjustment + EXCLUDED.point_adjustment
                    RETURNING point_adjustment
                ");
                $stmt->execute([$nameId, $date, $status, $pointAdjustment]);
                $result = $stmt->fetch(PDO::FETCH_ASSOC);
                $totalPointAdjustment = $result['point_adjustment'];

                // Update points table
                if ($pointAdjustment !== 0) {
                    $pointStmt = $pdo->prepare("
                        INSERT INTO points (name_id, value, created_at)
                        VALUES (?, ?, ?)
                    ");
                    $pointStmt->execute([$nameId, $pointAdjustment, date('Y-m-d H:i:s')]);
                }

                if (!isset($pointAdjustments[$nameId])) {
                    $pointAdjustments[$nameId] = 0;
                }
                $pointAdjustments[$nameId] += $totalPointAdjustment;
            }
            // Add more cases here if you have other types of offline actions
        }

        $pdo->commit();
        echo json_encode([
            'status' => 'success', 
            'message' => 'Offline data synced successfully',
            'point_adjustments' => $pointAdjustments
        ]);
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error syncing offline data: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method']);
}

function calculatePointAdjustment($oldStatus, $newStatus) {
    if ($oldStatus === $newStatus) return 0;

    if ($oldStatus === 'non-motivated' && $newStatus !== 'non-motivated') {
        return 1;  // Give back the point
    } elseif ($oldStatus !== 'non-motivated' && $newStatus === 'non-motivated') {
        return -1; // Take away a point
    }

    return 0;  // No point adjustment for other status changes
}