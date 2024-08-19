<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

$error = '';
$success = '';

// Account creation password
define('ACCOUNT_CREATION_PASSWORD', 'Aylmer2024-2025');

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    $email = sanitizeInput($_POST['email']);
    $password = $_POST['password'];
    $confirmPassword = $_POST['confirm_password'];
    $accountCreationPassword = $_POST['account_creation_password'];

    if ($accountCreationPassword !== ACCOUNT_CREATION_PASSWORD) {
        $error = translate('invalid_account_creation_password');
    } elseif ($password !== $confirmPassword) {
        $error = translate('passwords_do_not_match');
    } else {
        $pdo = getDbConnection();
        $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            $error = translate('email_already_exists');
        } else {
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            
            $stmt = $pdo->prepare("INSERT INTO users (email, password, is_verified) VALUES (?, ?, FALSE)");
            if ($stmt->execute([$email, $hashedPassword])) {
                $success = translate('registration_successful_await_verification');
            } else {
                $error = translate('error_creating_account');
            }
        }
    }
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
    <title><?php echo translate('register'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <form method="post">
        <h1><?php echo translate('register'); ?></h1>
        <?php if ($error): ?>
            <div class="error"><?php echo $error; ?></div>
        <?php endif; ?>
        <?php if ($success): ?>
            <div class="success"><?php echo $success; ?></div>
        <?php endif; ?>
        <label for="email"><?php echo translate('email'); ?>:</label>
        <input type="email" id="email" name="email" required>
        
        <label for="password"><?php echo translate('password'); ?>:</label>
        <input type="password" id="password" name="password" required>
        
        <label for="confirm_password"><?php echo translate('confirm_password'); ?>:</label>
        <input type="password" id="confirm_password" name="confirm_password" required>
        
        <label for="account_creation_password"><?php echo translate('account_creation_password'); ?>:</label>
        <input type="password" id="account_creation_password" name="account_creation_password" required>
        
        <input type="submit" value="<?php echo translate('register'); ?>">
    </form>
    <p><a href="login.php"><?php echo translate('already_have_account'); ?></a></p>
</body>
</html>