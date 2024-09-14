<?php
require_once 'config.php';
require_once 'functions.php';
require_once 'jwt_auth.php';

initializeApp();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = $_POST['email'] ?? '';
    $password = $_POST['password'] ?? '';

    $pdo = getDbConnection();
    $stmt = $pdo->prepare("SELECT id, password, role FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user && password_verify($password, $user['password'])) {
        $token = generateJWT($user['id'], $user['role']);
        
        echo json_encode([
            'success' => true,
            'message' => translate('login_successful'),
            'token' => $token,
            'user_role' => $user['role']
        ]);
    } else {
        echo json_encode([
            'success' => false,
            'message' => translate('invalid_credentials')
        ]);
    }
    exit;
}
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('login'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('login'); ?></h1>
    <form id="login-form">
        <input type="email" name="email" placeholder="<?php echo translate('email'); ?>" required>
        <input type="password" name="password" placeholder="<?php echo translate('password'); ?>" required>
        <button type="submit"><?php echo translate('submit_login'); ?></button>
    </form>
    <p><a href="register.php"><?php echo translate('create_account'); ?></a></p>

    <script type="module" src="js/login.js"></script>
</body>
</html>