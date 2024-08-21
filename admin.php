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
$stmt = $pdo->prepare("SELECT email, role FROM users WHERE id = ?");
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if ($user['role'] !== 'admin') {
    header('Location: index.php');
    exit;
}

$message = '';

// Handle user verification
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['verify_user'])) {
        $userId = (int)$_POST['user_id'];
        $stmt = $pdo->prepare("UPDATE users SET is_verified = TRUE WHERE id = ?");
        if ($stmt->execute([$userId])) {
            $message = translate('user_verified_successfully');
        } else {
            $message = translate('error_verifying_user');
        }
    } elseif (isset($_POST['update_user'])) {
        $userId = (int)$_POST['user_id'];
        $newRole = $_POST['new_role'];
        $newEmail = $_POST['new_email'];

        // Update role
        $stmt = $pdo->prepare("UPDATE users SET role = ? WHERE id = ?");
        $stmt->execute([$newRole, $userId]);

        // Update email
        $stmt = $pdo->prepare("UPDATE users SET email = ? WHERE id = ?");
        if ($stmt->execute([$newEmail, $userId])) {
            $message = translate('user_updated_successfully');
        } else {
            $message = translate('error_updating_user');
        }
    }
}

// Fetch all users
$stmt = $pdo->query("SELECT id, email, role, is_verified, created_at FROM users ORDER BY created_at DESC");
$users = $stmt->fetchAll(PDO::FETCH_ASSOC);

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

    <h2><?php echo translate('user_management'); ?></h2>
    <table>
        <thead>
            <tr>
                <th><?php echo translate('email'); ?></th>
                <th><?php echo translate('role'); ?></th>
                <th><?php echo translate('verified'); ?></th>
                <th><?php echo translate('registration_date'); ?></th>
                <th><?php echo translate('actions'); ?></th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($users as $user): ?>
                <tr>
                    <td>
                        <form method="post" class="inline-form">
                            <input type="hidden" name="user_id" value="<?php echo $user['id']; ?>">
                            <input type="email" name="new_email" value="<?php echo htmlspecialchars($user['email']); ?>" required>
                    </td>
                    <td>
                            <select name="new_role">
                                <option value="parent" <?php echo $user['role'] === 'parent' ? 'selected' : ''; ?>><?php echo translate('parent'); ?></option>
                                <option value="animation" <?php echo $user['role'] === 'animation' ? 'selected' : ''; ?>><?php echo translate('animation'); ?></option>
                                <option value="admin" <?php echo $user['role'] === 'admin' ? 'selected' : ''; ?>><?php echo translate('admin'); ?></option>
                            </select>
                    </td>
                    <td><?php echo $user['is_verified'] ? '✅' : '❌'; ?></td>
                    <td><?php echo htmlspecialchars($user['created_at']); ?></td>
                    <td>
                            <button type="submit" name="update_user"><?php echo translate('update'); ?></button>
                        </form>
                        <?php if (!$user['is_verified']): ?>
                            <form method="post" class="inline-form">
                                <input type="hidden" name="user_id" value="<?php echo $user['id']; ?>">
                                <button type="submit" name="verify_user"><?php echo translate('verify_user'); ?></button>
                            </form>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>

    <p><a href="logout.php"><?php echo translate('logout'); ?></a></p>

    <style>
        .inline-form {
            display: inline;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
        }
    </style>
</body>
</html>