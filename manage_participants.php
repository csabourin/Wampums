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

$message = '';

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if (isset($_POST['update_group'])) {
        $participantId = (int)$_POST['participant_id'];
        $groupId = (int)$_POST['group_id'];

        $stmt = $pdo->prepare("UPDATE participants SET group_id = ? WHERE id = ?");
        if ($stmt->execute([$groupId, $participantId])) {
            echo json_encode(['status' => 'success', 'message' => translate('group_updated_successfully')]);
            exit;
        } else {
            echo json_encode(['status' => 'error', 'message' => translate('error_updating_group')]);
            exit;
        }
    }
}

// Fetch all groups
$stmt = $pdo->query("SELECT id, name FROM groups ORDER BY name");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch all participants with their associated group
$query = "
    SELECT p.id, p.first_name, p.last_name, p.group_id, COALESCE(g.name, '" . translate('no_group') . "') AS group_name
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    ORDER BY p.last_name, p.first_name
";
$stmt = $pdo->query($query);
$participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('manage_participants'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
        }
        @media screen and (max-width: 600px) {
            table, thead, tbody, th, td, tr {
                display: block;
            }
            thead tr {
                position: absolute;
                top: -9999px;
                left: -9999px;
            }
            tr {
                margin-bottom: 15px;
            }
            td {
                border: none;
                position: relative;
                padding-left: 50%;
            }
            td:before {
                position: absolute;
                top: 6px;
                left: 6px;
                width: 45%;
                padding-right: 10px;
                white-space: nowrap;
                content: attr(data-label);
                font-weight: bold;
            }
        }
        select {
            width: 100%;
            padding: 5px;
            margin-top: 5px;
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
    <h1><?php echo translate('manage_participants'); ?></h1>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <?php if ($message): ?>
        <div class="message"><?php echo $message; ?></div>
    <?php endif; ?>

    <table>
        <thead>
            <tr>
                <th><?php echo translate('name'); ?></th>
                <th><?php echo translate('group'); ?></th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($participants as $participant): ?>
                <tr>
                    <td data-label="<?php echo translate('name'); ?>">
                        <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?>
                    </td>
                    <td data-label="<?php echo translate('group'); ?>">
                        <select class="group-select" data-participant-id="<?php echo $participant['id']; ?>">
                            <option value="" <?php echo is_null($participant['group_id']) ? 'selected' : ''; ?>><?php echo translate('no_group'); ?></option>
                            <?php foreach ($groups as $group): ?>
                                <option value="<?php echo $group['id']; ?>" <?php echo ($group['id'] == $participant['group_id']) ? 'selected' : ''; ?>>
                                    <?php echo htmlspecialchars($group['name']); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const groupSelects = document.querySelectorAll('.group-select');
            groupSelects.forEach(select => {
                select.addEventListener('change', function() {
                    const participantId = this.getAttribute('data-participant-id');
                    const groupId = this.value;
                    updateGroup(participantId, groupId);
                });
            });
        });

        function updateGroup(participantId, groupId) {
            const formData = new FormData();
            formData.append('update_group', '1');
            formData.append('participant_id', participantId);
            formData.append('group_id', groupId);

            fetch('manage_participants.php', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    console.log(data.message);
                } else {
                    alert(data.message);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred while updating the group.');
            });
        }
    </script>
</body>
</html>