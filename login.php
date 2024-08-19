<?php
require_once 'config.php';

$error = '';
$message = '';

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $email = sanitizeInput($_POST['email']);
    $password = $_POST['password'];

    $pdo = getDbConnection();
    $stmt = $pdo->prepare("SELECT id, email, password, is_verified FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password'])) {
        if (!$user['is_verified']) {
            $message = translate('account_not_verified_warning');
        } else {
            // Set session to expire next September 1st
            $now = new DateTime();
            $nextSeptember = new DateTime($now->format('Y') . '-09-01');
            if ($now >= $nextSeptember) {
                $nextSeptember->modify('+1 year');
            }
            $sessionDuration = $nextSeptember->getTimestamp() - time();
            
            session_set_cookie_params($sessionDuration);
            session_start();
            
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['last_activity'] = time();
            
            // Redirect admin to admin panel, others to dashboard
            if ($user['email'] === 'info@christisansabourin.com') {
                header('Location: admin.php');
            } else {
                header('Location: dashboard.php');
            }
            exit;
        }
    } else {
        $error = translate('invalid_credentials');
    }
}

// Check if user is already logged in
if (isset($_SESSION['user_id'])) {
    header('Location: dashboard.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
    <title><?php echo translate('login'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <form method="post">
        <h1><?php echo translate('login'); ?></h1>
        <?php if ($error): ?>
            <div class="error"><?php echo $error; ?></div>
        <?php endif; ?>
        <?php if ($message): ?>
            <div class="message"><?php echo $message; ?></div>
        <?php endif; ?>
        <label for="email"><?php echo translate('email'); ?>:</label>
        <input type="email" id="email" name="email" required>
        
        <label for="password"><?php echo translate('password'); ?>:</label>
        <input type="password" id="password" name="password" required>
        
        <input type="submit" value="<?php echo translate('login'); ?>">
    </form>
    <p><a href="register.php"><?php echo translate('create_account'); ?></a></p>
</body>
</html>