<?php
header('Content-Type: application/json');

require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = isset($_GET['participant_id']) ? intval($_GET['participant_id']) : null;
$territoire = $_GET['territoire'] ?? null;

if ($participant_id && $territoire) {
    try {
        $stmt = $pdo->prepare("
            SELECT MAX(etoiles) as current_stars 
            FROM badge_progress 
            WHERE participant_id = ? 
            AND territoire_chasse = ? 
            AND status = 'approved'
        ");
        $stmt->execute([$participant_id, $territoire]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $current_stars = $result['current_stars'] ?? 0;

        $stmt = $pdo->prepare("
            SELECT COUNT(*) as pending_count 
            FROM badge_progress 
            WHERE participant_id = ? 
            AND territoire_chasse = ? 
            AND status = 'pending'
        ");
        $stmt->execute([$participant_id, $territoire]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $has_pending = $result['pending_count'] > 0;

        echo json_encode(['current_stars' => (int)$current_stars, 'has_pending' => $has_pending]);
    } catch (Exception $e) {
        echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
    }
} else {
    echo json_encode(['error' => 'Invalid parameters']);
}