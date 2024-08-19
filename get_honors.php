<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $date = $_GET['date'] ?? date('Y-m-d');
    $pdo = getDbConnection();

    // Determine the start of the academic year
    $currentMonth = date('n');
    $currentYear = date('Y');
    $academicYearStart = ($currentMonth >= 9) ? "$currentYear-09-01" : ($currentYear - 1) . "-09-01";

    $query = "
        WITH honor_counts AS (
            SELECT name_id, COUNT(*) as total_honors
            FROM honors
            WHERE date >= :academic_year_start AND date <= CURRENT_DATE
            GROUP BY name_id
        )
        SELECT n.id AS name_id, n.first_name, g.id AS group_id, g.name AS group_name,
               COALESCE(hc.total_honors, 0) AS total_honors,
               CASE WHEN h.date IS NOT NULL THEN TRUE ELSE FALSE END AS honored_today
        FROM names n
        JOIN groups g ON n.group_id = g.id
        LEFT JOIN honor_counts hc ON n.id = hc.name_id
        LEFT JOIN honors h ON n.id = h.name_id AND h.date = :date
        WHERE :date = CURRENT_DATE
           OR h.date IS NOT NULL
        ORDER BY g.name, n.first_name
    ";

    $stmt = $pdo->prepare($query);
    $stmt->execute([
        'date' => $date,
        'academic_year_start' => $academicYearStart
    ]);
    $honors = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['status' => 'success', 'data' => $honors]);
} else {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method']);
}