<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    header('Location: login.php');
    exit;
}

// Check if the logged-in user is the admin
$pdo = getDbConnection();
$stmt = $pdo->prepare("SELECT email FROM users WHERE id = ?");
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if ($user['email'] !== 'info@christiansabourin.com') {
    header('Location: dashboard.php');
    exit;
}

$message = '';

// Handle user verification
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['verify_user'])) {
    $userId = (int)$_POST['user_id'];
    $stmt = $pdo->prepare("UPDATE users SET is_verified = TRUE WHERE id = ?");
    if ($stmt->execute([$userId])) {
        $message = translate('user_verified_successfully');
    } else {
        $message = translate('error_verifying_user');
    }
}

// Fetch all unverified users
$stmt = $pdo->query("SELECT id, email, created_at FROM users WHERE is_verified = FALSE ORDER BY created_at DESC");
$unverifiedUsers = $stmt->fetchAll(PDO::FETCH_ASSOC);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('admin_panel'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('admin_panel'); ?></h1>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <?php if ($message): ?>
        <div class="message"><?php echo $message; ?></div>
    <?php endif; ?>

    <h2><?php echo translate('unverified_users'); ?></h2>
    <?php if (empty($unverifiedUsers)): ?>
        <p><?php echo translate('no_unverified_users'); ?></p>
    <?php else: ?>
        <table>
            <thead>
                <tr>
                    <th><?php echo translate('email'); ?></th>
                    <th><?php echo translate('registration_date'); ?></th>
                    <th><?php echo translate('action'); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($unverifiedUsers as $user): ?>
                    <tr>
                        <td><?php echo htmlspecialchars($user['email']); ?></td>
                        <td><?php echo htmlspecialchars($user['created_at']); ?></td>
                        <td>
                            <form method="post">
                                <input type="hidden" name="user_id" value="<?php echo $user['id']; ?>">
                                <button type="submit" name="verify_user"><?php echo translate('verify_user'); ?></button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>

    <p><a href="logout.php"><?php echo translate('logout'); ?></a></p>
</body>
</html>