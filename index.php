<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

$pdo = getDbConnection();

// Check if user is logged in
if (isLoggedIn()) {
    $user_id = $_SESSION['user_id'];
    $stmt = $pdo->prepare("SELECT role FROM users WHERE id = ?");
    $stmt->execute([$user_id]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    $is_animation = ($user['role'] === 'animation' || $user['role'] === 'admin');

    // Fetch participants
    if ($is_animation) {
        // Fetch all participants for animation role
        $stmt = $pdo->prepare("
            SELECT p.id, p.first_name, p.last_name, 
                   CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END AS has_fiche_sante,
                   CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS has_acceptation_risque
            FROM participants p
            LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
            LEFT JOIN acceptation_risque ar ON p.id = ar.participant_id
        ");
        $stmt->execute();
    } else {
        // Fetch participants for the logged-in user
        $stmt = $pdo->prepare("
            SELECT p.id, p.first_name, p.last_name, 
                   CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END AS has_fiche_sante,
                   CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END AS has_acceptation_risque
            FROM participants p
            LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
            LEFT JOIN acceptation_risque ar ON p.id = ar.participant_id
            WHERE p.user_id = ?
        ");
        $stmt->execute([$user_id]);
    }
    $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
} else {
    // Redirect to login page if not logged in
    header('Location: login.php');
    exit();
}
?>

<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('accueil'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            font-family: Arial, sans-serif;
            color: #333;
        }

        body {
            background-image: url('images/Loups_6eA.png');
            background-repeat: no-repeat;
            background-size: contain;
            background-position: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        h1, h2 {
            text-align: center;
            margin: 0.5em 0;
            font-size: 1.5em;
        }

        nav ul {
            list-style-type: none;
            padding: 0;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        nav ul li {
            margin: 0.5em 0;
        }

        nav ul li a {
            text-decoration: none;
            color: #4c65ae;
            font-size: 1.2em;
            padding: 0.5em;
            border: 1px solid #4c65ae;
            border-radius: 5px;
            display: block;
            width: 100%;
            text-align: center;
            max-width: 300px;
            background-color: #ffffff88;
            transition: background-color 0.3s;
        }

        nav ul li a:hover {
            background-color: #4c65ae;
            color: #fff;
        }

        /* Media queries for larger screens */
        @media (min-width: 600px) {
            h1 {
                font-size: 2em;
            }

            h2 {
                font-size: 1.8em;
            }

            nav ul li a {
                font-size: 1.4em;
            }
        }

    </style>
</head>
<body>
    <h1><?php echo translate('bienvenue'); ?></h1>
    <h2>6e A St-Paul d'Aylmer</h2>

    <nav>
        <ul>
            
                <li><a href="formulaire_inscription.php"><?php echo translate('ajouter_participant'); ?></a></li>
            
            <?php foreach ($participants as $participant): ?>
                <li>
                    <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?>
                    <?php if (!$is_animation): ?>
                        <a href="formulaire_inscription.php?id=<?php echo $participant['id']; ?>"><?php echo translate('modifier'); ?></a>
                    <?php endif; ?>
                    <a href="fiche_sante.php?id=<?php echo $participant['id']; ?>">
                        <?php echo $participant['has_fiche_sante'] ? '✅' : '❌'; ?>
                        <?php echo translate('fiche_sante'); ?>
                    </a>
                    <a href="acceptation_risque.php?id=<?php echo $participant['id']; ?>">
                        <?php echo $participant['has_acceptation_risque'] ? '✅' : '❌'; ?>
                        <?php echo translate('acceptation_risque'); ?>
                    </a>
                </li>
    <li><a href="badge_form.php?id=<?php echo $participant['id']; ?>"><?php echo translate('badge_progress'); ?></a></li>
            <?php endforeach; ?>
            <?php if ($is_animation): ?>
                <li><a href="dashboard.php"><?php echo translate('tableau_de_bord'); ?></a></li>
            <?php endif; ?>
            <li><a href="logout.php"><?php echo translate('deconnexion'); ?></a></li>
        </ul>
    </nav>
    <script src="js/functions.js"></script>
    <script type="module" src="js/app.js"></script>
</body>
</html>