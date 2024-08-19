<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$message = '';

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    if (isset($_POST['add_name'])) {
        $firstName = sanitizeInput($_POST['first_name']);
        $groupId = (int)$_POST['group_id'];

        $stmt = $pdo->prepare("INSERT INTO names (first_name, group_id) VALUES (?, ?)");
        if ($stmt->execute([$firstName, $groupId])) {
            $message = translate('name_added_successfully');
        } else {
            $message = translate('error_adding_name');
        }
    } elseif (isset($_POST['remove_name'])) {
        $nameId = (int)$_POST['name_id'];

        $stmt = $pdo->prepare("DELETE FROM names WHERE id = ?");
        if ($stmt->execute([$nameId])) {
            $message = translate('name_removed_successfully');
        } else {
            $message = translate('error_removing_name');
        }
    } elseif (isset($_POST['update_group'])) {
        $nameId = (int)$_POST['name_id'];
        $groupId = (int)$_POST['group_id'];

        $stmt = $pdo->prepare("UPDATE names SET group_id = ? WHERE id = ?");
        if ($stmt->execute([$groupId, $nameId])) {
            echo json_encode(['status' => 'success', 'message' => translate('group_updated_successfully')]);
            exit;
        } else {
            echo json_encode(['status' => 'error', 'message' => translate('error_updating_group')]);
            exit;
        }
    } elseif (isset($_POST['update_name'])) {
        $nameId = (int)$_POST['name_id'];
        $firstName = sanitizeInput($_POST['first_name']);

        $stmt = $pdo->prepare("UPDATE names SET first_name = ? WHERE id = ?");
        if ($stmt->execute([$firstName, $nameId])) {
            echo json_encode(['status' => 'success', 'message' => translate('name_updated_successfully')]);
            exit;
        } else {
            echo json_encode(['status' => 'error', 'message' => translate('error_updating_name')]);
            exit;
        }
    }
}

// Initialize sorting variables
$sortBy = $_GET['sort'] ?? 'group';
$sortOrder = $_GET['order'] ?? 'asc';

// Fetch all groups
$stmt = $pdo->query("SELECT id, name FROM groups ORDER BY name");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch all names with their associated group
$query = "
    SELECT n.id, n.first_name, n.group_id, COALESCE(g.name, '" . translate('no_group') . "') AS group_name 
    FROM names n 
    LEFT JOIN groups g ON n.group_id = g.id 
    ORDER BY 
    " . ($sortBy == 'name' ? "n.first_name" : "COALESCE(g.name, '" . translate('no_group') . "')") . " " . 
    ($sortOrder == 'desc' ? "DESC" : "ASC");

$stmt = $pdo->query($query);
$names = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Function to generate sort URL
function getSortUrl($column) {
    global $sortBy, $sortOrder;
    $newOrder = ($sortBy === $column && $sortOrder === 'asc') ? 'desc' : 'asc';
    return "?sort={$column}&order={$newOrder}";
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
    <title><?php echo translate('manage_names'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <link href="./css/manage_names.css" rel="stylesheet">
</head>
<body>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <h1><?php echo translate('manage_names'); ?></h1>

    <?php if ($message): ?>
        <div class="message"><?php echo $message; ?></div>
    <?php endif; ?>

    <form method="post">
        <h2><?php echo translate('add_name'); ?></h2>
        <label for="first_name"><?php echo translate('first_name'); ?>:</label>
        <input type="text" id="first_name" name="first_name" required>

        <label for="group_id"><?php echo translate('select_group'); ?>:</label>
        <select id="group_id" name="group_id" required>
            <?php foreach ($groups as $group): ?>
                <option value="<?php echo $group['id']; ?>"><?php echo htmlspecialchars($group['name']); ?></option>
            <?php endforeach; ?>
        </select>

        <input type="submit" name="add_name" value="<?php echo translate('add_name'); ?>">
    </form>

    <h2><?php echo translate('existing_names'); ?></h2>
    <div class="sort-options">
        <a href="<?php echo getSortUrl('name'); ?>"><?php echo translate('sort_by_name'); ?></a>
        <a href="<?php echo getSortUrl('group'); ?>"><?php echo translate('sort_by_group'); ?></a>
    </div>
    <table>
        <tr>
            <th><?php echo translate('first_name'); ?></th>
            <th><?php echo translate('group'); ?></th>
            <th><?php echo translate('action'); ?></th>
        </tr>
        <?php foreach ($names as $name): ?>
            <tr>
                <td data-label="<?php echo translate('first_name'); ?>">
                    <span class="editable" contenteditable="true" data-name-id="<?php echo $name['id']; ?>"><?php echo htmlspecialchars($name['first_name']); ?></span>
                </td>
                <td data-label="<?php echo translate('group'); ?>">
                    <select class="group-select" data-name-id="<?php echo $name['id']; ?>">
                        <option value="" <?php echo is_null($name['group_id']) ? 'selected' : ''; ?>><?php echo translate('no_group'); ?></option>
                        <?php foreach ($groups as $group): ?>
                            <option value="<?php echo $group['id']; ?>" <?php echo ($group['id'] == $name['group_id']) ? 'selected' : ''; ?>>
                                <?php echo htmlspecialchars($group['name']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </td>
                <td data-label="<?php echo translate('action'); ?>">
                    <form method="post" onsubmit="return confirm('<?php echo translate('confirm_delete'); ?>');">
                        <input type="hidden" name="name_id" value="<?php echo $name['id']; ?>">
                        <input type="submit" name="remove_name" value="<?php echo translate('remove_name'); ?>" style="background-color: #f44336;">
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
    </table>

    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const groupSelects = document.querySelectorAll('.group-select');
            groupSelects.forEach(select => {
                select.addEventListener('change', function() {
                    const nameId = this.getAttribute('data-name-id');
                    const groupId = this.value;
                    updateGroup(nameId, groupId);
                });
            });

            const editableNames = document.querySelectorAll('.editable');
            editableNames.forEach(input => {
                input.addEventListener('change', function() {
                    const nameId = this.getAttribute('data-name-id');
                    const newName = this.value.trim();
                    updateName(nameId, newName);
                });
            });
        });

        function updateGroup(nameId, groupId) {
            const formData = new FormData();
            formData.append('update_group', '1');
            formData.append('name_id', nameId);
            formData.append('group_id', groupId);

            fetch('manage_names.php', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    alert(data.message);
                } else {
                    alert(data.message);
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred while updating the group.');
            });
        }

        function updateName(nameId, newName) {
            const formData = new FormData();
            formData.append('update_name', '1');
            formData.append('name_id', nameId);
            formData.append('first_name', newName);

            fetch('manage_names.php', {
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
                alert('An error occurred while updating the name.');
            });
        }
    </script>
</body>
</html>