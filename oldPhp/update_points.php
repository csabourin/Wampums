<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

header('Content-Type: application/json');

$pdo = getDbConnection();

try {
    $pdo->beginTransaction();

    $updateStmt = $pdo->prepare("
        INSERT INTO points (name_id, group_id, value, created_at) 
        VALUES (:name_id, :group_id, :value, :created_at)
    ");

    $getGroupMembersStmt = $pdo->prepare("
        SELECT id FROM participants WHERE group_id = :group_id
    ");

    $data = json_decode(file_get_contents('php://input'), true);
    $responses = [];

    foreach ($data as $update) {
        if ($update['type'] === 'group') {
            // For group updates, add points to the group and all its members
            $updateStmt->execute([
                ':name_id' => null,
                ':group_id' => $update['id'],
                ':value' => $update['points'],
                ':created_at' => $update['timestamp']
            ]);

            $getGroupMembersStmt->execute([':group_id' => $update['id']]);
            $members = $getGroupMembersStmt->fetchAll(PDO::FETCH_COLUMN);

            foreach ($members as $memberId) {
                $updateStmt->execute([
                    ':name_id' => $memberId,
                    ':group_id' => null,
                    ':value' => $update['points'],
                    ':created_at' => $update['timestamp']
                ]);
            }

            // Fetch updated group total
            $groupTotalStmt = $pdo->prepare("
                SELECT COALESCE(SUM(value), 0) as total_points 
                FROM points 
                WHERE group_id = :group_id
            ");
            $groupTotalStmt->execute([':group_id' => $update['id']]);
            $groupTotal = $groupTotalStmt->fetchColumn();

            $responses[] = [
                'type' => 'group',
                'id' => $update['id'],
                'totalPoints' => $groupTotal,
                'memberIds' => $members
            ];
        } else {
            // For individual updates, only add points to the individual
            $updateStmt->execute([
                ':name_id' => $update['id'],
                ':group_id' => null,
                ':value' => $update['points'],
                ':created_at' => $update['timestamp']
            ]);

            // Fetch updated individual total
            $individualTotalStmt = $pdo->prepare("
                SELECT COALESCE(SUM(value), 0) as total_points 
                FROM points 
                WHERE name_id = :name_id
            ");
            $individualTotalStmt->execute([':name_id' => $update['id']]);
            $individualTotal = $individualTotalStmt->fetchColumn();

            $responses[] = [
                'type' => 'individual',
                'id' => $update['id'],
                'totalPoints' => $individualTotal
            ];
        }
    }

    $pdo->commit();

    echo json_encode(['status' => 'success', 'updates' => $responses]);
} catch (Exception $e) {
    $pdo->rollBack();
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}