<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = $_GET['id'] ?? null;
$participant = null;

// Check if the participant exists and belongs to the current user
if ($participant_id) {
    $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ? AND user_id = ?");
    $stmt->execute([$participant_id, $_SESSION['user_id']]);
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);

    // If the participant doesn't exist or doesn't belong to the current user, redirect to index.php
    if (!$participant) {
        header('Location: index.php');
        exit;
    }
} else {
    // If no participant_id is provided, redirect to index.php
    header('Location: index.php');
    exit;
}

function getCurrentStars($pdo, $participant_id, $territoire_chasse) {
    $stmt = $pdo->prepare("
        SELECT MAX(etoiles) as current_stars 
        FROM badge_progress 
        WHERE participant_id = ? 
        AND territoire_chasse = ? 
        AND status = 'approved'
    ");
    $stmt->execute([$participant_id, $territoire_chasse]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    return $result['current_stars'] ?? 0;
}

function hasPendingSubmission($pdo, $participant_id, $territoire_chasse) {
    $stmt = $pdo->prepare("
        SELECT COUNT(*) as pending_count 
        FROM badge_progress 
        WHERE participant_id = ? 
        AND territoire_chasse = ? 
        AND status = 'pending'
    ");
    $stmt->execute([$participant_id, $territoire_chasse]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    return $result['pending_count'] > 0;
}

function getTerritoireImage($territoire) {
    $imageMap = [
        'Débrouillard comme Kaa' => 'kaa.jpg',
        'Vrai comme Baloo' => 'baloo.jpg',
        'Respectueux comme Rikki Tikki Tavi' => 'rikki.jpg',
        'Dynamique comme Bagheera' => 'bagheera.jpg',
        'Heureux comme Ferao' => 'ferao.jpg',
        'Solidaire comme Frère Gris' => 'frereGris.jpg'
    ];
    return $imageMap[$territoire] ?? 'default.jpg';
}

function getPendingStars($pdo, $participant_id, $territoire_chasse) {
    $stmt = $pdo->prepare("SELECT COUNT(*) as pending_stars FROM badge_progress WHERE participant_id = ? AND territoire_chasse = ? AND status = 'pending'");
    $stmt->execute([$participant_id, $territoire_chasse]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    return $result['pending_stars'] ?? 0;
}

if ($participant_id) {
    $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ?");
    $stmt->execute([$participant_id]);
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    try {
        $pdo->beginTransaction();

        $currentStars = getCurrentStars($pdo, $participant_id, $_POST['territoire_chasse']);
        $hasPending = hasPendingSubmission($pdo, $participant_id, $_POST['territoire_chasse']);
        $newStars = $currentStars + 1;

        if ($newStars <= 3 && !$hasPending) {
            $badgeData = [
                'participant_id' => $participant_id,
                'territoire_chasse' => $_POST['territoire_chasse'],
                'objectif' => $_POST['objectif'],
                'description' => $_POST['description'],
                'fierte' => isset($_POST['fierte']),
                'raison' => $_POST['raison'],
                'date_obtention' => $_POST['date_obtention'],
                'etoiles' => $newStars,
                'status' => 'pending'
            ];

            $stmt = $pdo->prepare("INSERT INTO badge_progress (
                participant_id, territoire_chasse, objectif, description, fierte, raison, date_obtention, etoiles, status
            ) VALUES (
                :participant_id, :territoire_chasse, :objectif, :description, :fierte, :raison, :date_obtention, :etoiles, :status
            )");
            $stmt->execute($badgeData);

            $pdo->commit();
            $success = translate('badge_progress_submitted_for_approval');
        } elseif ($hasPending) {
            $error = translate('pending_submission_exists');
        } else {
            $error = translate('max_stars_reached');
        }
    } catch (Exception $e) {
        $pdo->rollBack();
        $error = translate('error_saving_badge_progress') . ': ' . $e->getMessage();
    }
}

// Fetch existing badge progress
$stmt = $pdo->prepare("SELECT * FROM badge_progress WHERE participant_id = ? ORDER BY created_at DESC");
$stmt->execute([$participant_id]);
$badgeProgress = $stmt->fetchAll(PDO::FETCH_ASSOC);

$participant_id = isset($participant['id']) ? $participant['id'] : null;
if (!$participant_id) {
    die('Error: No participant ID found.');
}

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('badge_progress_form'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('badge_progress_form'); ?></h1>
    <?php if (isset($success)): ?>
        <div class="success"><?php echo $success; ?></div>
    <?php endif; ?>
    <form method="post">
        <label for="territoire_chasse"><?php echo translate('territoire_chasse'); ?>:</label>
        <select id="territoire_chasse" name="territoire_chasse" required>
            <option value=-1 selected disabled>...</option>
            <option value="Débrouillard comme Kaa">Débrouillard comme Kaa</option>
            <option value="Vrai comme Baloo">Vrai comme Baloo</option>
            <option value="Respectueux comme Rikki Tikki Tavi">Respectueux comme Rikki Tikki Tavi</option>
            <option value="Dynamique comme Bagheera">Dynamique comme Bagheera</option>
            <option value="Heureux comme Ferao">Heureux comme Ferao</option>
            <option value="Solidaire comme Frère Gris">Solidaire comme Frère Gris</option>
        </select>

        <?php
        $currentStars = 0;
        if ($_SERVER['REQUEST_METHOD'] == 'POST') {
            $currentStars = getCurrentStars($pdo, $participant_id, $_POST['territoire_chasse']);
        }
        ?>

        <div id="starInfo">
            <?php echo translate('current_stars'); ?>: <span id="currentStarsDisplay"><?php echo $currentStars; ?></span>
        </div>

        <input type="hidden" id="currentStars" name="currentStars" value="<?php echo $currentStars; ?>">

        <label for="objectif"><?php echo translate('objectif_proie'); ?>:</label>
        <textarea id="objectif" name="objectif" required></textarea>

        <label for="description"><?php echo translate('description'); ?>:</label>
        <textarea id="description" name="description" required></textarea>

        <label for="fierte"><?php echo translate('fierte'); ?>:</label>
        <input type="checkbox" id="fierte" name="fierte">

        <label for="raison"><?php echo translate('raison'); ?>:</label>
        <textarea id="raison" name="raison" required></textarea>

        <label for="date_obtention"><?php echo translate('date_obtention'); ?>:</label>
        <input type="date" id="date_obtention" name="date_obtention" required>

        <input type="hidden" id="etoiles" name="etoiles" value="1">

        <input type="submit" id="submitButton" value="<?php echo translate('save_badge_progress'); ?>">
    </form>

    <h2><?php echo translate('existing_badge_progress'); ?></h2>
    <div class="badge-grid">
        <?php
        $territoires = [
            'Débrouillard comme Kaa',
            'Vrai comme Baloo',
            'Respectueux comme Rikki Tikki Tavi',
            'Dynamique comme Bagheera',
            'Heureux comme Ferao',
            'Solidaire comme Frère Gris'
        ];
                foreach ($territoires as $territoire): 
                    $badge = array_filter($badgeProgress, function($b) use ($territoire) {
                        return $b['territoire_chasse'] === $territoire && $b['status'] === 'approved';
                    });
                    $badge = reset($badge);
                    $stars = $badge ? $badge['etoiles'] : 0;
                    $pendingStars = getPendingStars($pdo, $participant_id, $territoire);
                ?>
                    <div class="badge-item">
                <img src="images/<?php echo getTerritoireImage($territoire); ?>" alt="<?php echo htmlspecialchars($territoire); ?>">
                <h3><?php echo htmlspecialchars($territoire); ?></h3>
                        <div class="stars">
                            <?php 
                            for ($i = 0; $i < 3; $i++) {
                                if ($i < $stars) {
                                    echo '⭐';
                                } elseif ($i < $stars + $pendingStars) {
                                    echo '🕒'; // Pending star
                                } else {
                                    echo '☆';
                                }
                            }
                            ?>
                        </div>
                <?php if ($badge): ?>
                    <p><?php echo translate('date'); ?>: <?php echo htmlspecialchars($badge['date_obtention']); ?></p>
                    <details>
                        <summary><?php echo translate('details'); ?></summary>
                        <p><?php echo translate('objectif'); ?>: <?php echo htmlspecialchars($badge['objectif']); ?></p>
                        <p><?php echo translate('description'); ?>: <?php echo htmlspecialchars($badge['description']); ?></p>
                        <p><?php echo translate('fierte'); ?>: <?php echo $badge['fierte'] ? translate('yes') : translate('no'); ?></p>
                        <p><?php echo translate('raison'); ?>: <?php echo htmlspecialchars($badge['raison']); ?></p>
                    </details>
                <?php endif; ?>
            </div>
        <?php endforeach; ?>
    </div>

    <p><a href="index.php"><?php echo translate('back_to_dashboard'); ?></a></p>
    <script>
    const participantId = <?php echo json_encode($participant_id); ?>;
    </script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const form = document.querySelector('form');
            const fierteCheckbox = document.getElementById('fierte');
            const raisonTextarea = document.getElementById('raison');
            const territoireSelect = document.getElementById('territoire_chasse');
            const currentStarsInput = document.getElementById('currentStars');
            const currentStarsDisplay = document.getElementById('currentStarsDisplay');
            const submitButton = document.getElementById('submitButton');

            fierteCheckbox.addEventListener('change', function() {
                raisonTextarea.required = this.checked;
            });

            territoireSelect.addEventListener('change', function() {
                fetchCurrentStars(this.value);
            });

            function updateSubmitButton(stars, hasPending) {
                if (stars >= 3 || hasPending) {
                    submitButton.disabled = true;
                    submitButton.value = stars >= 3 ? `<?php echo translate("max_stars_reached"); ?>` : `<?php echo translate("pending_submission_exists"); ?>`;
                } else {
                    submitButton.disabled = false;
                    submitButton.value = '<?php echo translate("save_badge_progress"); ?>';
                }
            }

            function fetchCurrentStars(territoire) {
                fetch(`get_current_stars.php?participant_id=${participantId}&territoire=${encodeURIComponent(territoire)}`)
                    .then(response => response.json())
                    .then(data => {
                        if (data.error) {
                            console.error('Error:', data.error);
                            alert('An error occurred while fetching star data. Please try again.');
                        } else {
                            currentStarsInput.value = data.current_stars;
                            currentStarsDisplay.textContent = data.current_stars;
                            updateSubmitButton(data.current_stars, data.has_pending);
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('An error occurred while fetching star data. Please try again.');
                    });
            }


            form.addEventListener('submit', function(e) {
                let isValid = true;
                const errorMessages = [];

                // Validate required fields
                form.querySelectorAll('[required]').forEach(field => {
                    if (!field.value.trim()) {
                        isValid = false;
                        errorMessages.push(`Le champ "${field.previousElementSibling.textContent.replace(':', '')}" est requis.`);
                    }
                });

                if (!isValid) {
                    e.preventDefault();
                    alert(errorMessages.join('\n'));
                }
            });
        });
    </script>
</body>
</html>