<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

try {
    $pdo = getDbConnection();

    $jsonData = file_get_contents('php://input');
    $offlineData = json_decode($jsonData, true);

    if (!is_array($offlineData)) {
        throw new Exception('Invalid data format');
    }

    $pdo->beginTransaction();

    $serverUpdates = [];

    foreach ($offlineData as $item) {
        if ($item['action'] === 'updatePoints') {
            $type = $item['data']['type'];
            $id = (int)$item['data']['id'];
            $points = (int)$item['data']['points'];
            $timestamp = $item['data']['timestamp'];

            if ($type === 'group') {
                // Add points to the group
                $stmt = $pdo->prepare("INSERT INTO points (group_id, value, created_at) VALUES (?, ?, ?)");
                $stmt->execute([$id, $points, $timestamp]);

                // Add the same points to each individual in the group
                $stmt = $pdo->prepare("
                    INSERT INTO points (name_id, value, created_at)
                    SELECT id, ?, ?
                    FROM names
                    WHERE group_id = ?
                ");
                $stmt->execute([$points, $timestamp, $id]);

                // Fetch updated total points for the group
                $stmt = $pdo->prepare("SELECT COALESCE(SUM(value), 0) as total_points FROM points WHERE group_id = ?");
                $stmt->execute([$id]);
                $groupTotalPoints = $stmt->fetchColumn();

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

                $serverUpdates[] = [
                    'action' => 'updatePoints',
                    'data' => [
                        'type' => 'group',
                        'id' => $id,
                        'totalPoints' => $groupTotalPoints,
                        'memberPoints' => $memberPoints
                    ]
                ];
            } else {
                // Individual points
                $stmt = $pdo->prepare("INSERT INTO points (name_id, value, created_at) VALUES (?, ?, ?)");
                $stmt->execute([$id, $points, $timestamp]);

                // Fetch updated total points for the individual
                $stmt = $pdo->prepare("SELECT COALESCE(SUM(value), 0) as total_points FROM points WHERE name_id = ?");
                $stmt->execute([$id]);
                $totalPoints = $stmt->fetchColumn();

                $serverUpdates[] = [
                    'action' => 'updatePoints',
                    'data' => [
                        'type' => 'individual',
                        'id' => $id,
                        'totalPoints' => $totalPoints
                    ]
                ];
            }
        } elseif ($item['action'] === 'updateAttendance') {
            $nameId = $item['data']['nameId'];
            $status = $item['data']['status'];
            $date = $item['data']['date'];

            // Update attendance
            $stmt = $pdo->prepare("
                INSERT INTO attendance (name_id, date, status)
                VALUES (?, ?, ?)
                ON CONFLICT (name_id, date) DO UPDATE SET status = EXCLUDED.status
            ");
            $stmt->execute([$nameId, $date, $status]);

            // Adjust points based on attendance status
            $pointAdjustment = 0;
            if ($status === 'non-motivated') {
                $pointAdjustment = -1;
            } elseif (in_array($status, ['motivated', 'late', 'present'])) {
                $pointAdjustment = 1;
            }

            if ($pointAdjustment !== 0) {
                $stmt = $pdo->prepare("INSERT INTO points (name_id, value, created_at) VALUES (?, ?, ?)");
                $stmt->execute([$nameId, $pointAdjustment, $date]);
            }

            $serverUpdates[] = [
                'action' => 'updateAttendance',
                'data' => [
                    'nameId' => $nameId,
                    'status' => $status,
                    'date' => $date,
                    'pointAdjustment' => $pointAdjustment
                ]
            ];
        }
    }

    $pdo->commit();

    echo json_encode([
        'success' => true,
        'message' => 'Data synced successfully',
        'serverUpdates' => $serverUpdates
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}