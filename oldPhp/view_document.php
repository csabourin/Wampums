<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Check if the user has animation role
$stmt = $pdo->prepare("SELECT role FROM users WHERE id = ?");
$stmt->execute([$_SESSION['user_id']]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);
if ($user['role'] !== 'animation' && $user['role'] !== 'admin') {
    header('Location: index.php');
    exit;
}

$type = $_GET['type'] ?? '';
$id = $_GET['id'] ?? '';

if (!$type || !$id) {
    die(translate('invalid_request'));
}

// Fetch participant info
$stmt = $pdo->prepare("
    SELECT p.*, g.name AS group_name 
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    WHERE p.id = ?
");
$stmt->execute([$id]);
$participant = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$participant) {
    die(translate('participant_not_found'));
}

// Fetch guardians info
$stmt = $pdo->prepare("
    SELECT * FROM parents_guardians 
    WHERE participant_id = ?
    ORDER BY is_primary DESC
");
$stmt->execute([$id]);
$guardians = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch the specific document
$query = '';
switch ($type) {
    case 'fiche_sante':
        $query = "SELECT * FROM fiche_sante WHERE participant_id = ?";
        break;
    case 'acceptation_risque':
        $query = "SELECT * FROM acceptation_risque WHERE participant_id = ?";
        break;
    case 'inscription':
        $query = "SELECT * FROM inscriptions WHERE participant_id = ?";
        break;
    default:
        die(translate('invalid_document_type'));
}

$stmt = $pdo->prepare($query);
$stmt->execute([$id]);
$document = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$document) {
    die(translate('document_not_found'));
}

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate($type); ?> - <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        .info-section {
            margin-bottom: 20px;
            border: 1px solid #ddd;
            padding: 10px;
        }
        .info-section h2 {
            margin-top: 0;
        }
    </style>
</head>
<body>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator" style="display: none;">
      <?php echo translate('you_are_offline'); ?>
    </div>
    <h1><?php echo translate($type); ?> - <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></h1>
    <p><a href="view_participant_documents.php"><?php echo translate('back_to_participant_documents'); ?></a></p>

    <div class="info-section">
        <h2><?php echo translate('participant_info'); ?></h2>
        <p><strong><?php echo translate('name'); ?>:</strong> <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></p>
        <p><strong><?php echo translate('date_of_birth'); ?>:</strong> <?php echo htmlspecialchars($participant['date_naissance']); ?></p>
        <p><strong><?php echo translate('gender'); ?>:</strong> <?php echo htmlspecialchars($participant['sexe']); ?></p>
        <p><strong><?php echo translate('address'); ?>:</strong> <?php echo htmlspecialchars($participant['adresse']); ?></p>
        <p><strong><?php echo translate('city'); ?>:</strong> <?php echo htmlspecialchars($participant['ville']); ?></p>
        <p><strong><?php echo translate('province'); ?>:</strong> <?php echo htmlspecialchars($participant['province']); ?></p>
        <p><strong><?php echo translate('postal_code'); ?>:</strong> <?php echo htmlspecialchars($participant['code_postal']); ?></p>
        <p><strong><?php echo translate('email'); ?>:</strong> <?php echo htmlspecialchars($participant['courriel']); ?></p>
        <p><strong><?php echo translate('phone'); ?>:</strong> <?php echo htmlspecialchars($participant['telephone']); ?></p>
        <p><strong><?php echo translate('group'); ?>:</strong> <?php echo htmlspecialchars($participant['group_name']); ?></p>
    </div>

    <?php foreach ($guardians as $index => $guardian): ?>
        <div class="info-section">
            <h2><?php echo translate('guardian') . ' ' . ($index + 1); ?></h2>
            <p><strong><?php echo translate('name'); ?>:</strong> <?php echo htmlspecialchars($guardian['prenom'] . ' ' . $guardian['nom']); ?></p>
            <p><strong><?php echo translate('relationship'); ?>:</strong> <?php echo htmlspecialchars($guardian['lien']); ?></p>
            <p><strong><?php echo translate('email'); ?>:</strong> <?php echo htmlspecialchars($guardian['courriel']); ?></p>
            <p><strong><?php echo translate('phone_home'); ?>:</strong> <?php echo htmlspecialchars($guardian['telephone_residence']); ?></p>
            <p><strong><?php echo translate('phone_work'); ?>:</strong> <?php echo htmlspecialchars($guardian['telephone_travail']); ?></p>
            <p><strong><?php echo translate('phone_cell'); ?>:</strong> <?php echo htmlspecialchars($guardian['telephone_cellulaire']); ?></p>
        </div>
    <?php endforeach; ?>

    <div class="info-section">
        <h2><?php echo translate($type); ?></h2>
        <?php foreach ($document as $key => $value): ?>
            <?php if ($key !== 'id' && $key !== 'participant_id'): ?>
                <p><strong><?php echo translate($key); ?>:</strong> <?php echo htmlspecialchars($value); ?></p>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>
</body>
</html>