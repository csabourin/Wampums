<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

// Check if user has animation or admin role
if ($_SESSION['user_role'] !== 'animation' && $_SESSION['user_role'] !== 'admin') {
    header('Location: index.php');
    exit;
}

header('Content-Type: application/json');

$pdo = getDbConnection();

// Get the start and end dates for the report (default to last 30 days if not provided)
$endDate = isset($_GET['end_date']) ? $_GET['end_date'] : date('Y-m-d');
$startDate = isset($_GET['start_date']) ? $_GET['start_date'] : date('Y-m-d', strtotime('-30 days'));

// First, get the total number of days where attendance was taken
$totalDaysQuery = "
    SELECT COUNT(DISTINCT date) as total_days
    FROM attendance
    WHERE date BETWEEN :start_date AND :end_date
";
$stmt = $pdo->prepare($totalDaysQuery);
$stmt->execute([':start_date' => $startDate, ':end_date' => $endDate]);
$totalDays = $stmt->fetchColumn();

// Fetch attendance data
$query = "
    WITH attendance_days AS (
        SELECT DISTINCT date
        FROM attendance
        WHERE date BETWEEN :start_date AND :end_date
    )
    SELECT 
        p.id, 
        p.first_name, 
        p.last_name, 
        g.name AS group_name,
        COUNT(DISTINCT ad.date) AS total_days,
        SUM(CASE WHEN a.status IN ('absent', 'non-motivated') THEN 1 ELSE 0 END) AS days_absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS days_late
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    CROSS JOIN attendance_days ad
    LEFT JOIN attendance a ON p.id = a.name_id AND a.date = ad.date
    GROUP BY p.id, p.first_name, p.last_name, g.name
    ORDER BY g.name, p.last_name, p.first_name
";

$stmt = $pdo->prepare($query);
$stmt->execute([':start_date' => $startDate, ':end_date' => $endDate]);
$attendanceData = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Calculate overall statistics
$overallStats = [
    'total_participants' => count($attendanceData),
    'average_attendance_rate' => 0,
    'total_days' => $totalDays,
];

foreach ($attendanceData as &$participant) {
    $participant['days_present'] = $participant['total_days'] - ($participant['days_absent'] + $participant['days_late']);
    $participant['attendance_rate'] = $participant['total_days'] > 0
        ? round(($participant['days_present'] / $participant['total_days']) * 100, 2)
        : 0;
    $overallStats['average_attendance_rate'] += $participant['attendance_rate'];
}

$overallStats['average_attendance_rate'] = $overallStats['total_participants'] > 0
    ? round($overallStats['average_attendance_rate'] / $overallStats['total_participants'], 2)
    : 0;

// Prepare the final report data
$reportData = [
    'start_date' => $startDate,
    'end_date' => $endDate,
    'overall_stats' => $overallStats,
    'participant_data' => $attendanceData,
];

echo json_encode($reportData);