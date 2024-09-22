<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $date = $_GET['date'] ?? date('Y-m-d');

    $pdo = getDbConnection();
    $query = "
        SELECT name_id, status
        FROM attendance
        WHERE date = ?
    ";
    $stmt = $pdo->prepare($query);
    $stmt->execute([$date]);
    $attendance = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);

    echo json_encode($attendance);
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method']);
}