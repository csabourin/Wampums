<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

// Check if the user has animation role
if ($_SESSION['user_role'] !== 'animation' && $_SESSION['user_role'] !== 'admin') {
    header('Location: index.php');
    exit;
}

$message = '';

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if (isset($_POST['delete_participant'])) {
        $participant_id = (int)$_POST['participant_id'];
        
        $pdo->beginTransaction();
        
        try {
            // Delete associated records
            $stmt = $pdo->prepare("DELETE FROM user_participants WHERE participant_id = ?");
            $stmt->execute([$participant_id]);
            
            $stmt = $pdo->prepare("DELETE FROM fiche_sante WHERE participant_id = ?");
            $stmt->execute([$participant_id]);
            
            $stmt = $pdo->prepare("DELETE FROM acceptation_risque WHERE participant_id = ?");
            $stmt->execute([$participant_id]);
            
            $stmt = $pdo->prepare("DELETE FROM inscriptions WHERE participant_id = ?");
            $stmt->execute([$participant_id]);
            
            // Finally, delete the participant
            $stmt = $pdo->prepare("DELETE FROM participants WHERE id = ?");
            $stmt->execute([$participant_id]);
            
            $pdo->commit();
            $message = translate('participant_deleted_successfully');
        } catch (Exception $e) {
            $pdo->rollBack();
            $message = translate('error_deleting_participant') . ': ' . $e->getMessage();
        }
    } elseif (isset($_POST['associate_user'])) {
        $participant_id = (int)$_POST['participant_id'];
        $user_id = (int)$_POST['user_id'];
        
        $stmt = $pdo->prepare("INSERT INTO user_participants (user_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
        if ($stmt->execute([$user_id, $participant_id])) {
            $message = translate('user_associated_successfully');
        } else {
            $message = translate('error_associating_user');
        }
    }
}

// Fetch all participants
$stmt = $pdo->query("
    SELECT p.id, p.first_name, p.last_name, 
           string_agg(u.full_name, ', ') as associated_users
    FROM participants p
    LEFT JOIN user_participants up ON p.id = up.participant_id
    LEFT JOIN users u ON up.user_id = u.id
    GROUP BY p.id, p.first_name, p.last_name
    ORDER BY p.last_name, p.first_name
");
$participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch all parent users
$stmt = $pdo->query("SELECT id, full_name FROM users WHERE role = 'parent' ORDER BY full_name");
$parent_users = $stmt->fetchAll(PDO::FETCH_ASSOC);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('manage_users_participants'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator" style="display: none;">
      <?php echo translate('you_are_offline'); ?>
    </div>
    <h1><?php echo translate('manage_users_participants'); ?></h1>
    <?php if ($message): ?>
        <div class="message"><?php echo $message; ?></div>
    <?php endif; ?>

    <table>
        <thead>
            <tr>
                <th><?php echo translate('name'); ?></th>
                <th><?php echo translate('associated_users'); ?></th>
                <th><?php echo translate('actions'); ?></th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($participants as $participant): ?>
                <tr>
                    <td><?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></td>
                    <td><?php echo htmlspecialchars($participant['associated_users']); ?></td>
                    <td>
                        <form method="post" onsubmit="return confirm('<?php echo translate('confirm_delete_participant'); ?>');">
                            <input type="hidden" name="participant_id" value="<?php echo $participant['id']; ?>">
                            <button type="submit" name="delete_participant"><?php echo translate('delete'); ?></button>
                        </form>
                        <form method="post">
                            <input type="hidden" name="participant_id" value="<?php echo $participant['id']; ?>">
                            <select name="user_id" required>
                                <option value=""><?php echo translate('select_parent'); ?></option>
                                <?php foreach ($parent_users as $user): ?>
                                    <option value="<?php echo $user['id']; ?>"><?php echo htmlspecialchars($user['full_name']); ?></option>
                                <?php endforeach; ?>
                            </select>
                            <button type="submit" name="associate_user"><?php echo translate('associate_user'); ?></button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
</body>
</html>