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

// Fetch all participants with their document status
$query = "
    SELECT p.id, p.first_name, p.last_name, 
           CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END AS has_fiche_sante,
           CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS has_acceptation_risque,
           CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END AS has_inscription
    FROM participants p
    LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
    LEFT JOIN acceptation_risque ar ON p.id = ar.participant_id
    LEFT JOIN inscriptions i ON p.id = i.participant_id
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
    <title><?php echo translate('view_participant_documents'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <style>
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 1em;
        }

        thead {
            display: none;
        }

        tbody, tr, td {
            display: block;
            width: 100%;
        }

        tr {
            margin-bottom: 1em;
            border-bottom: 2px solid #ddd;
        }

        td {
            padding: 0.5em;
            text-align: left;
            border: none;
            position: relative;
            padding-left: 50%;
        }

        td:before {
            content: attr(data-label);
            position: absolute;
            left: 0;
            top: 0;
            padding: 0.5em;
            background: #f5f5f5;
            font-weight: bold;
            width: 45%;
            height: 100%;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
        }

        @media (min-width: 600px) {
            thead {
                display: table-header-group;
            }

            tbody, tr, td {
                display: table-row-group;
                width: auto;
            }

            td {
                padding-left: 0;
            }

            td:before {
                display: none;
            }
        }

    </style>
</head>
<body>
    <h1><?php echo translate('view_participant_documents'); ?></h1>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>

    <table>
        <thead>
            <tr>
                <th><?php echo translate('name'); ?></th>
                <th><?php echo translate('fiche_sante'); ?></th>
                <th><?php echo translate('acceptation_risque'); ?></th>
                <th><?php echo translate('inscription'); ?></th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($participants as $participant): ?>
                <tr>
                    <td data-label="<?php echo translate('name'); ?>">
                        <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?>
                    </td>
                    <td data-label="<?php echo translate('fiche_sante'); ?>">
                        <?php if ($participant['has_fiche_sante']): ?>
                            <a href="view_document.php?type=fiche_sante&id=<?php echo $participant['id']; ?>">
                                <?php echo translate('view'); ?>
                            </a>
                        <?php else: ?>
                            ❌
                        <?php endif; ?>
                    </td>
                    <td data-label="<?php echo translate('acceptation_risque'); ?>">
                        <?php if ($participant['has_acceptation_risque']): ?>
                            <a href="view_document.php?type=acceptation_risque&id=<?php echo $participant['id']; ?>">
                                <?php echo translate('view'); ?>
                            </a>
                        <?php else: ?>
                            ❌
                        <?php endif; ?>
                    </td>
                    <td data-label="<?php echo translate('inscription'); ?>">
                        <?php if ($participant['has_inscription']): ?>
                            <a href="view_document.php?type=inscription&id=<?php echo $participant['id']; ?>">
                                <?php echo translate('view'); ?>
                            </a>
                        <?php else: ?>
                            ❌
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>

</body>
</html>