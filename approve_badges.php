<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

// Check if user has animation role
if ($_SESSION['user_role'] === 'parent') {
    header('Location: dashboard.php');
    exit;
}

$pdo = getDbConnection();

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $badge_id = $_POST['badge_id'];
    $action = $_POST['action'];
    $user_id = $_SESSION['user_id'];

    $stmt = $pdo->prepare("UPDATE badge_progress SET status = ?, approved_by = ?, approval_date = NOW() WHERE id = ?");
    $stmt->execute([$action, $user_id, $badge_id]);

    $success = translate('badge_status_updated');
}

// Fetch pending badge requests
$stmt = $pdo->query("SELECT bp.*, p.first_name, p.last_name 
                     FROM badge_progress bp 
                     JOIN participants p ON bp.participant_id = p.id 
                     WHERE bp.status = 'pending' 
                     ORDER BY bp.date_obtention");
$pending_badges = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>

<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('approve_badges'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('approve_badges'); ?></h1>

    <?php if (isset($success)): ?>
        <div class="success"><?php echo $success; ?></div>
    <?php endif; ?>

    <?php foreach ($pending_badges as $badge): ?>
        <div class="badge-request">
            <h2><?php echo htmlspecialchars($badge['first_name'] . ' ' . $badge['last_name']); ?></h2>
            <p><?php echo translate('territoire'); ?>: <?php echo htmlspecialchars($badge['territoire_chasse']); ?></p>
            <p><?php echo translate('stars'); ?>: <?php echo $badge['etoiles']; ?></p>
            <p><?php echo translate('objectif'); ?>: <?php echo htmlspecialchars($badge['objectif']); ?></p>
            <p><?php echo translate('description'); ?>: <?php echo htmlspecialchars($badge['description']); ?></p>
            <p><?php echo translate('date'); ?>: <?php echo $badge['date_obtention']; ?></p>
            <form method="post">
                <input type="hidden" name="badge_id" value="<?php echo $badge['id']; ?>">
                <button type="submit" name="action" value="approved"><?php echo translate('approve'); ?></button>
                <button type="submit" name="action" value="rejected"><?php echo translate('reject'); ?></button>
            </form>
        </div>
    <?php endforeach; ?>

    <?php if (empty($pending_badges)): ?>
        <p><?php echo translate('no_pending_badges'); ?></p>
    <?php endif; ?>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
</body>
</html>