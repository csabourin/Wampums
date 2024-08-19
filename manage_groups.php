<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$message = '';

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if (isset($_POST['add_group'])) {
        $groupName = sanitizeInput($_POST['group_name']);

        $stmt = $pdo->prepare("INSERT INTO groups (name) VALUES (?)");
        if ($stmt->execute([$groupName])) {
            $message = translate('group_added_successfully');
        } else {
            $message = translate('error_adding_group');
        }
    } elseif (isset($_POST['remove_group'])) {
        $groupId = (int)$_POST['group_id'];

        // First, update all names in this group to have no group
        $stmt = $pdo->prepare("UPDATE names SET group_id = NULL WHERE group_id = ?");
        $stmt->execute([$groupId]);

        // Then delete the group
        $stmt = $pdo->prepare("DELETE FROM groups WHERE id = ?");
        if ($stmt->execute([$groupId])) {
            $message = translate('group_removed_successfully');
        } else {
            $message = translate('error_removing_group');
        }
    } elseif (isset($_POST['update_group_name'])) {
        $groupId = (int)$_POST['group_id'];
        $groupName = sanitizeInput($_POST['group_name']);

        $stmt = $pdo->prepare("UPDATE groups SET name = ? WHERE id = ?");
        if ($stmt->execute([$groupName, $groupId])) {
            echo json_encode(['status' => 'success', 'message' => translate('group_name_updated_successfully')]);
            exit;
        } else {
            echo json_encode(['status' => 'error', 'message' => translate('error_updating_group_name')]);
            exit;
        }
    }
}

// Fetch all groups
$stmt = $pdo->query("SELECT id, name FROM groups ORDER BY name");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
    <title><?php echo translate('manage_groups'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        .editable-group:hover {
            background-color: #f0f0f0;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('manage_groups'); ?></h1>

    <?php if ($message): ?>
        <div class="message"><?php echo $message; ?></div>
    <?php endif; ?>

    <form method="post">
        <h2><?php echo translate('add_group'); ?></h2>
        <label for="group_name"><?php echo translate('group_name'); ?>:</label>
        <input type="text" id="group_name" name="group_name" required>

        <input type="submit" name="add_group" value="<?php echo translate('add_group'); ?>">
    </form>

    <h2><?php echo translate('existing_groups'); ?></h2>
    <table>
        <tr>
            <th><?php echo translate('group_name'); ?></th>
            <th><?php echo translate('action'); ?></th>
        </tr>
        <?php foreach ($groups as $group): ?>
            <tr>
                <td>
                    <span class="editable-group" contenteditable="true" data-group-id="<?php echo $group['id']; ?>"><?php echo htmlspecialchars($group['name']); ?></span>
                </td>
                <td>
                    <form method="post" onsubmit="return confirm('<?php echo translate('confirm_delete_group'); ?>');">
                        <input type="hidden" name="group_id" value="<?php echo $group['id']; ?>">
                        <input type="submit" name="remove_group" value="<?php echo translate('remove_group'); ?>" style="background-color: #f44336;">
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
    </table>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const editableGroups = document.querySelectorAll('.editable-group');
            editableGroups.forEach(span => {
                span.addEventListener('blur', function() {
                    const groupId = this.getAttribute('data-group-id');
                    const newName = this.textContent.trim();
                    updateGroupName(groupId, newName);
                });
            });
        });

        function updateGroupName(groupId, newName) {
            const formData = new FormData();
            formData.append('update_group_name', '1');
            formData.append('group_id', groupId);
            formData.append('group_name', newName);

            fetch('manage_groups.php', {
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
                alert('<?php echo translate("error_updating_group_name"); ?>');
            });
        }
    </script>
</body>
</html>