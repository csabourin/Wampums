<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

// Check if user has animation or admin role
if ($_SESSION['user_role'] !== 'animation' && $_SESSION['user_role'] !== 'admin') {
    header('Location: index.php');
    exit;
}

$pdo = getDbConnection();

// Fetch all children with their parents/guardians
$query = "
    SELECT 
        p.id, 
        p.first_name, 
        p.last_name,
        COALESCE(g.name, '" . translate('no_group') . "') AS group_name,
        pg.nom, 
        pg.prenom, 
        pg.telephone_residence, 
        pg.telephone_cellulaire, 
        pg.telephone_travail,
        pg.is_emergency_contact
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    LEFT JOIN participant_guardians pgp ON p.id = pgp.participant_id
    LEFT JOIN parents_guardians pg ON pgp.parent_guardian_id = pg.id
    ORDER BY g.name NULLS LAST, p.last_name, p.first_name, pg.is_primary DESC
";
$stmt = $pdo->query($query);
$result = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Organize data by child
$children = [];
foreach ($result as $row) {
    $childId = $row['id'];
    if (!isset($children[$childId])) {
        $children[$childId] = [
            'name' => $row['first_name'] . ' ' . $row['last_name'],
            'group' => $row['group_name'],
            'contacts' => []
        ];
    }
    if ($row['nom'] && $row['prenom']) {
        $children[$childId]['contacts'][] = [
            'name' => $row['prenom'] . ' ' . $row['nom'],
            'phone_home' => $row['telephone_residence'],
            'phone_cell' => $row['telephone_cellulaire'],
            'phone_work' => $row['telephone_travail'],
            'is_emergency' => $row['is_emergency_contact']
        ];
    }
}

// Sort children alphabetically by group then by name
uasort($children, function($a, $b) {
    $groupCompare = strcmp($a['group'], $b['group']);
    if ($groupCompare === 0) {
        return strcmp($a['name'], $b['name']);
    }
    return $groupCompare;
});

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('parent_contact_list'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        .child-list {
            list-style-type: none;
            padding: 0;
        }
        .child-item {
            background-color: #fff;
            margin-bottom: 10px;
            border-radius: 5px;
            overflow: hidden;
        }
        .child-name {
            padding: 15px;
            background-color: var(--primary-color);
            color: white;
            cursor: pointer;
        }
        .contact-details {
            display: none;
            padding: 15px;
        }
        .contact-details.active {
            display: block;
        }
        .contact-info {
            margin-bottom: 10px;
        }
        .contact-info:last-child {
            margin-bottom: 0;
        }
        .phone-number {
            display: block;
            margin-left: 20px;
        }
        .emergency-contact {
            color: red;
            font-weight: bold;
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
    <h1><?php echo translate('parent_contact_list'); ?></h1>
    <ul class="child-list" id="childList">
        <?php 
        $currentGroup = null;
        foreach ($children as $childId => $child): 
            if ($currentGroup !== $child['group']):
                $currentGroup = $child['group'];
        ?>
            <li class="group-header"><?php echo htmlspecialchars($currentGroup); ?></li>
        <?php 
            endif;
        ?>
            <li class="child-item">
                <div class="child-name" onclick="toggleContacts(<?php echo $childId; ?>)">
                    <?php echo htmlspecialchars($child['name']); ?>
                </div>
                <div class="contact-details" id="contacts-<?php echo $childId; ?>">
                    <?php foreach ($child['contacts'] as $contact): ?>
                        <div class="contact-info">
                            <strong><?php echo htmlspecialchars($contact['name']); ?></strong>
                            <?php if ($contact['is_emergency']): ?>
                                <span class="emergency-contact"><?php echo translate('emergency_contact'); ?></span>
                            <?php endif; ?>
                            <?php if ($contact['phone_home']): ?>
                                <span class="phone-number"><?php echo translate('phone_home'); ?>: <?php echo htmlspecialchars($contact['phone_home']); ?></span>
                            <?php endif; ?>
                            <?php if ($contact['phone_cell']): ?>
                                <span class="phone-number"><?php echo translate('phone_cell'); ?>: <?php echo htmlspecialchars($contact['phone_cell']); ?></span>
                            <?php endif; ?>
                            <?php if ($contact['phone_work']): ?>
                                <span class="phone-number"><?php echo translate('phone_work'); ?>: <?php echo htmlspecialchars($contact['phone_work']); ?></span>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </div>
            </li>
        <?php endforeach; ?>
    </ul>
    <script>
        function toggleContacts(childId) {
            const contactsElement = document.getElementById(`contacts-${childId}`);
            contactsElement.classList.toggle('active');
        }
    </script>
    <script src="js/parent_contact_list.js"></script>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
</body>
</html>