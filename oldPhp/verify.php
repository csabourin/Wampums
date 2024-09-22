<?php
require_once 'config.php';

$message = '';

if (isset($_GET['token'])) {
    $token = $_GET['token'];
    $pdo = getDbConnection();

    $stmt = $pdo->prepare("SELECT id FROM users WHERE verification_token = ?");
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if ($user) {
        $stmt = $pdo->prepare("UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE id = ?");
        if ($stmt->execute([$user['id']])) {
            $message = translate('email_verified_successfully');
        } else {
            $message = translate('error_verifying_email');
        }
    } else {
        $message = translate('invalid_verification_token');
    }
} else {
    $message = translate('no_verification_token_provided');
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
    <title><?php echo translate('email_verification'); ?></title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f4f4f4;
        }
        .message {
            background-color: #fff;
            border-radius: 5px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
    </style>
</head>
<body>
    <div class="message">
        <h1><?php echo translate('email_verification'); ?></h1>
        <p><?php echo $message; ?></p>
        <p><a href="login.php"><?php echo translate('go_to_login'); ?></a></p>
    </div>
</body>
</html>