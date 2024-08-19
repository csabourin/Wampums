<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $nameId = $_POST['name_id'] ?? null;
    $status = $_POST['status'] ?? null;
    $date = $_POST['date'] ?? date('Y-m-d');
    $previousStatus = $_POST['previous_status'] ?? null;

    if ($nameId && $status) {
        $pdo = getDbConnection();
        $pdo->beginTransaction();

        try {
            // Calculate point adjustment
            $pointAdjustment = calculatePointAdjustment($previousStatus, $status);

            // Update attendance with point adjustment
            $query = "
                INSERT INTO attendance (name_id, date, status, point_adjustment)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (name_id, date) DO UPDATE 
                SET status = EXCLUDED.status, 
                    point_adjustment = attendance.point_adjustment + EXCLUDED.point_adjustment
                RETURNING (SELECT status FROM attendance WHERE name_id = ? AND date = ?) AS old_status,
                          point_adjustment
            ";
            $stmt = $pdo->prepare($query);
            $stmt->execute([$nameId, $date, $status, $pointAdjustment, $nameId, $date]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            $oldStatus = $result['old_status'] ?? $previousStatus;
            $totalPointAdjustment = $result['point_adjustment'];

            // Update points table
            if ($pointAdjustment !== 0) {
                $pointQuery = "
                    INSERT INTO points (name_id, value, created_at)
                    VALUES (?, ?, ?)
                ";
                $pointStmt = $pdo->prepare($pointQuery);
                $pointStmt->execute([$nameId, $pointAdjustment, date('Y-m-d H:i:s')]);
            }

            // Log the change
            $logStmt = $pdo->prepare("INSERT INTO sync_log (action, data) VALUES (?, ?)");
            $logStmt->execute(['update_attendance', json_encode([
                'name_id' => $nameId,
                'date' => $date,
                'old_status' => $oldStatus,
                'new_status' => $status,
                'point_adjustment' => $pointAdjustment
            ])]);

            $pdo->commit();
            echo json_encode([
                'status' => 'success',
                'point_adjustment' => $totalPointAdjustment
            ]);
        } catch (Exception $e) {
            $pdo->rollBack();
            echo json_encode(['status' => 'error', 'message' => 'Failed to update attendance: ' . $e->getMessage()]);
        }
    } else {
        echo json_encode(['status' => 'error', 'message' => 'Invalid input']);
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