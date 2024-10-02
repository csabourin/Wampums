<?php
// api.php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

function logDebug($message) {
		error_log(date('[Y-m-d H:i:s] ') . $message . PHP_EOL, 3, 'debug.log');
}
require_once 'config.php';
require_once 'functions.php';
initializeApp();
require_once 'jwt_auth.php';  
header('Content-Type: application/json');

function jsonResponse($success, $data = null, $message = '') {
	echo json_encode([
		'success' => $success,
		'data' => $data,
		'message' => $message
	]);
	exit;
}

function handleError($errno, $errstr, $errfile, $errline) {
	$error = [
		'type' => $errno,
		'message' => $errstr,
		'file' => $errfile,
		'line' => $errline
	];
	echo json_encode(['success' => false, 'error' => $error]);
	exit;
}
set_error_handler('handleError');

function handleException($e) {
	$error = [
		'type' => get_class($e),
		'message' => $e->getMessage(),
		'file' => $e->getFile(),
		'line' => $e->getLine()
	];
	echo json_encode(['success' => false, 'error' => $error]);
	exit;
}
set_exception_handler('handleException');


$action = $_GET['action'] ?? '';
$pdo = getDbConnection();

// Only verify JWT for non-login and non-register actions
if ($action !== 'login' && $action !== 'register' && $action !=="request_reset" && $action!=="reset_password") {
	$headers = getallheaders();
	$token = null;
	if (isset($headers['Authorization'])) {
		$authHeader = $headers['Authorization'];
		$token = str_replace('Bearer ', '', $authHeader);
	}

	$isValidToken = verifyJWT($token);

	if (!$isValidToken) {
		echo json_encode(['success' => false, 'message' => 'Invalid or expired token']);
		exit;
	}
}

try {
	$organization_id = getCurrentOrganizationId();
	$organizationId = $organization_id;
	if (!$organization_id) {
		throw new Exception("Organization ID not found.");
	}
	switch ($action) {
		case 'switch_organization':
		$newOrgId = $_POST['organization_id'] ?? null;
		$userId = getUserIdFromToken($token);
		$userOrgs = getUserOrganizations($userId);

		if ($newOrgId && in_array($newOrgId, array_column($userOrgs, 'organization_id'))) {
				$_SESSION['current_organization_id'] = $newOrgId;
				echo json_encode(['success' => true, 'message' => 'Organization switched successfully']);
		} else {
				echo json_encode(['success' => false, 'message' => 'Invalid organization ID']);
		}
		break;
		case 'get_mailing_list':
		$organizationId = getCurrentOrganizationId();

		// Fetch emails and roles from the user_organizations table for the current organization
		$stmt = $pdo->prepare("
				SELECT u.email, uo.role 
				FROM user_organizations uo
				JOIN users u ON u.id = uo.user_id
				WHERE uo.organization_id = :organization_id
				AND u.email IS NOT NULL 
				AND u.email != ''
		");
		$stmt->execute([':organization_id' => $organizationId]);
		$usersEmails = $stmt->fetchAll(PDO::FETCH_ASSOC);

		$emailsByRole = [];
		foreach ($usersEmails as $user) {
				$role = $user['role'];
				$email = strtolower($user['email']);  // Convert email to lowercase
				if (!isset($emailsByRole[$role])) {
						$emailsByRole[$role] = [];
				}
				$emailsByRole[$role][] = $email;
		}

		// Get guardian emails from form_submissions
		$stmt = $pdo->prepare("
				SELECT 
						LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel, 
						string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
				FROM form_submissions fs
				JOIN participants p ON fs.participant_id = p.id
				WHERE 
						(fs.submission_data->>'guardian_courriel_0') IS NOT NULL 
						AND (fs.submission_data->>'guardian_courriel_0') != ''
						AND fs.organization_id = :organization_id
				GROUP BY fs.submission_data->>'guardian_courriel_0'

				UNION

				SELECT 
						LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel, 
						string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
				FROM form_submissions fs
				JOIN participants p ON fs.participant_id = p.id
				WHERE 
						(fs.submission_data->>'guardian_courriel_1') IS NOT NULL 
						AND (fs.submission_data->>'guardian_courriel_1') != ''
						AND fs.organization_id = :organization_id
				GROUP BY fs.submission_data->>'guardian_courriel_1'
		");
		$stmt->execute([':organization_id' => $organizationId]);
		$parentEmails = $stmt->fetchAll(PDO::FETCH_ASSOC);

		// Format the parent emails with linked participants
		$emailsByRole['parent'] = [];
		foreach ($parentEmails as $parent) {
				$emailsByRole['parent'][] = [
						'email' => $parent['courriel'],
						'participants' => $parent['participants'] ?? ''  // Ensure participants is a string
				];
		}

		// Get emails from participants
		$stmt = $pdo->prepare("
				SELECT LOWER(fs.submission_data->>'courriel') AS courriel
				FROM form_submissions fs
				WHERE 
						(fs.submission_data->>'courriel') IS NOT NULL 
						AND (fs.submission_data->>'courriel') != ''
						AND fs.organization_id = :organization_id
		");
		$stmt->execute([':organization_id' => $organizationId]);
		$participantEmails = $stmt->fetchAll(PDO::FETCH_COLUMN);

		// Collect all unique emails without unpacking
		$allEmails = [];

		// Collect user emails
		foreach ($emailsByRole as $role => $emails) {
				if ($role === 'parent') {
						// For parent role, check if the 'courriel' key exists before using it
						foreach ($emails as $parentEmail) {
								$allEmails[] = strtolower($parentEmail['email']);
						}
				} else {
						// For other roles, add the emails as they are
						$allEmails = array_merge($allEmails, $emails);
				}
		}

		// Add participant emails directly
		$allEmails = array_merge($allEmails, $participantEmails);

		// Get unique email addresses (case-insensitive)
		$uniqueEmails = array_unique($allEmails);

		// Output the result
		echo json_encode([
				'success' => true,
				'emails_by_role' => $emailsByRole,  // User emails grouped by role
				'participant_emails' => array_values($participantEmails),  // Unique participant emails
				'unique_emails' => array_values($uniqueEmails)  // All unique emails combined
		]);
		break;

		case 'get_organization_form_formats':
		// Ensure the user is authenticated
		$user = requireAuth();

		// Get the organization ID from the user's session or JWT
		$organizationId = getCurrentOrganizationId();

		if (!$organizationId) {
				echo json_encode(['success' => false, 'message' => 'No organization selected']);
				exit;
		}

		try {
				// Fetch all form formats associated with the organization
				$stmt = $pdo->prepare("
						SELECT form_type, form_structure 
						FROM organization_form_formats 
						 WHERE organization_id = ?
				");
				$stmt->execute([$organizationId]);
				$formFormats = $stmt->fetchAll(PDO::FETCH_ASSOC);

				// Map the form formats to make them accessible by their form_type
				$formattedData = [];
				foreach ($formFormats as $form) {
						$formattedData[$form['form_type']] = json_decode($form['form_structure'], true);
				}

				echo json_encode([
						'success' => true,
						'formFormats' => $formattedData
				]);
		} catch (PDOException $e) {
				error_log('Database error: ' . $e->getMessage());
				echo json_encode([
						'success' => false,
						'message' => 'Error fetching form formats'
				]);
		}
		break;




		case 'get_organization_settings':
		// Ensure the user is authenticated
		$user = requireAuth();

		// Get the organization ID from the user's session or JWT
		$organizationId = getCurrentOrganizationId();

		if (!$organizationId) {
				echo json_encode(['success' => false, 'message' => 'No organization selected']);
				exit;
		}

		try {
				$stmt = $pdo->prepare("
						SELECT setting_key, setting_value 
						FROM organization_settings 
						WHERE organization_id = ?
				");
			$stmt->execute([$organizationId]);
			$settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
			// Decode JSON-encoded settings and filter form structures
			$formStructures = [];
				foreach ($settings as $key => $value) {
					$decodedValue = json_decode($value, true);
					if (json_last_error() === JSON_ERROR_NONE) {
						$settings[$key] = $decodedValue;
						// Identify form structures by naming convention (e.g., ending in '_structure')
						if (str_ends_with($key, '_structure')) {
							$formStructures[$key] = $decodedValue;
						}
					}
				} // Close the foreach loop here

				echo json_encode([
					'success' => true,
					'settings' => $settings,
					'form_structures' => $formStructures // Include all form structures in the response
				]);
		} catch (PDOException $e) {
				error_log('Database error: ' . $e->getMessage());
				echo json_encode([
						'success' => false, 
						'message' => 'Error fetching organization settings'
				]);
		}
		break;

		case 'get_calendars':
		$stmt = $pdo->query("
				SELECT 
						p.id AS participant_id,
						p.first_name,
						p.last_name,
						COALESCE(c.amount, 0) AS calendar_amount,
						COALESCE(c.amount_paid, 0) AS amount_paid,
						COALESCE(c.paid, FALSE) AS paid,
						c.updated_at
				FROM 
						participants p
				LEFT JOIN 
						calendars c ON p.id = c.participant_id
				ORDER BY 
						p.last_name, p.first_name
		");
				$calendars = $stmt->fetchAll(PDO::FETCH_ASSOC);
				echo json_encode(['success' => true, 'calendars' => $calendars]);
				break;

		case 'update_calendar':
				$data = json_decode(file_get_contents('php://input'), true);
				$participantId = $data['participant_id'];
				$amount = $data['amount'];
		$stmt = $pdo->prepare("
				INSERT INTO calendars (participant_id, amount, amount_paid, paid)
				VALUES (:participant_id, :amount, :amount_paid, FALSE)
				ON CONFLICT (participant_id) 
				DO UPDATE SET 
						amount = EXCLUDED.amount,
						amount_paid = EXCLUDED.amount_paid,
						updated_at = CURRENT_TIMESTAMP
		");
		$result = $stmt->execute([
				':participant_id' => $participantId, 
				':amount' => $amount,
				':amount_paid' => $data['amount_paid'] ?? 0
		]);
				$result = $stmt->execute([':participant_id' => $participantId, ':amount' => $amount]);
				echo json_encode(['success' => $result]);
				break;

		case 'update_calendar_amount_paid':
		$data = json_decode(file_get_contents('php://input'), true);
		$participantId = $data['participant_id'];
		$amountPaid = $data['amount_paid'];
		$stmt = $pdo->prepare("
				UPDATE calendars
				SET 
						amount_paid = :amount_paid,
						updated_at = CURRENT_TIMESTAMP
				WHERE 
						participant_id = :participant_id
		");
		$result = $stmt->execute([':participant_id' => $participantId, ':amount_paid' => $amountPaid]);
		echo json_encode(['success' => $result]);
		break;

		case 'save_guest':
		$data = json_decode(file_get_contents('php://input'), true);
		$guestName = $data['name'];
		$guestEmail = $data['email'] ?? null;
		$attendanceDate = $data['attendance_date'];

		try {
				$stmt = $pdo->prepare("
						INSERT INTO guests (name, email, attendance_date)
						VALUES (:name, :email, :attendance_date)
				");
				$stmt->execute([
						':name' => $guestName,
						':email' => $guestEmail,
						':attendance_date' => $attendanceDate
				]);

				echo json_encode(['success' => true, 'message' => 'Guest added successfully']);
		} catch (PDOException $e) {
				echo json_encode(['success' => false, 'message' => 'Error adding guest: ' . $e->getMessage()]);
		}
		break;
		case 'get_guests_by_date':
		$attendanceDate = $_GET['date'] ?? date('Y-m-d');

		try {
				$stmt = $pdo->prepare("SELECT * FROM guests WHERE attendance_date = :attendance_date");
				$stmt->execute([':attendance_date' => $attendanceDate]);
				$guests = $stmt->fetchAll(PDO::FETCH_ASSOC);

				echo json_encode(['success' => true, 'guests' => $guests]);
		} catch (PDOException $e) {
				echo json_encode(['success' => false, 'message' => 'Error retrieving guests: ' . $e->getMessage()]);
		}
		break;

		case 'request_reset':
		$data = json_decode(file_get_contents('php://input'), true);
		$email = $data['email'];
		$token = bin2hex(random_bytes(32)); // Generate a secure token
		$expiry = date('Y-m-d H:i:s', strtotime('+24 hour')); // Token expires in 24 hour

		try {
				// Check if the email exists in the database
				$checkStmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
				$checkStmt->execute([$email]);
				$user = $checkStmt->fetch();

				if (!$user) {
						throw new Exception('User not found');
				}

				// Save the token in the database
				$stmt = $pdo->prepare("UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?");
				$updateResult = $stmt->execute([$token, $expiry, $email]);

				if (!$updateResult) {
						throw new Exception('Failed to update user with reset token');
				}

				// Send email with reset link
				$resetLink = "https://meute6a.app/reset_password?token=" . $token;
				$to = $email;
				$subject = "Réinitialisation de votre mot de passe";
				$message = "Cliquez sur ce lien pour réinitialiser votre mot de passe: $resetLink";

				$emailResult = sendResetEmail($to, $subject, $message);

				if (!$emailResult) {
						throw new Exception('Failed to send reset email');
				}

				echo json_encode(['success' => true, 'message' => 'Email de réinitialisation envoyé']);
		} catch (Exception $e) {
				error_log('Password reset error: ' . $e->getMessage());
				echo json_encode(['success' => false, 'message' => 'Erreur lors de l\'envoi du lien de réinitialisation: ' . $e->getMessage()]);
		}
		break;

		case 'reset_password':
		$data = json_decode(file_get_contents('php://input'), true);
		$token = $data['token'] ?? '';
		$newPassword = $data['new_password'] ?? '';

		logDebug("Attempting password reset with token: " . substr($token, 0, 10) . "...");

		try {
				if (empty($token) || empty($newPassword)) {
						throw new Exception('Token or new password is missing');
				}

				// Verify token and update password
				$stmt = $pdo->prepare("SELECT id, reset_token, reset_token_expiry FROM users WHERE reset_token = ?");
				$stmt->execute([$token]);
				$user = $stmt->fetch(PDO::FETCH_ASSOC);

				logDebug("User fetch result: " . json_encode($user));

				if (!$user) {
						logDebug("No user found with the provided token.");
						throw new Exception('Invalid token');
				}

				// Get the current time in UTC
				$now = new DateTime('now', new DateTimeZone('UTC'));
				$expiry = new DateTime($user['reset_token_expiry'], new DateTimeZone('UTC'));

				logDebug("Current time (UTC): " . $now->format('Y-m-d H:i:s'));
				logDebug("Token expiry (UTC): " . $expiry->format('Y-m-d H:i:s'));
				logDebug("Time difference: " . $now->diff($expiry)->format('%R%a days %H hours %I minutes %S seconds'));

				if ($now > $expiry) {
						logDebug("Token has expired.");
						throw new Exception('Token has expired');
				}

				$hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
				$updateStmt = $pdo->prepare("UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?");
				if (!$updateStmt->execute([$hashedPassword, $user['id']])) {
						logDebug("Failed to update password for user ID: " . $user['id']);
						throw new Exception('Failed to update password');
				}

				logDebug("Password reset successful for user ID: " . $user['id']);
				echo json_encode(['success' => true, 'message' => 'Mot de passe réinitialisé avec succès']);
		} catch (Exception $e) {
				logDebug('Password reset error: ' . $e->getMessage());
				echo json_encode(['success' => false, 'message' => 'Erreur lors de la réinitialisation du mot de passe: ' . $e->getMessage()]);
		}
		break;

		case 'update_calendar_paid':
				$data = json_decode(file_get_contents('php://input'), true);
				$participantId = $data['participant_id'];
				$paidStatus = $data['paid_status'];
				$stmt = $pdo->prepare("
						UPDATE calendars
						SET 
								paid = :paid_status,
								updated_at = CURRENT_TIMESTAMP
						WHERE 
								participant_id = :participant_id
				");
				$result = $stmt->execute([':participant_id' => $participantId, ':paid_status' => $paidStatus]);
				echo json_encode(['success' => $result]);
				break;

		case 'get_participant_calendar':
				$participantId = $_GET['participant_id'];
				$stmt = $pdo->prepare("
						SELECT 
								p.id AS participant_id,
								p.first_name,
								p.last_name,
								COALESCE(c.amount, 0) AS calendar_amount,
								COALESCE(c.paid, FALSE) AS paid,
								c.updated_at
						FROM 
								participants p
						LEFT JOIN 
								calendars c ON p.id = c.participant_id
						WHERE 
								p.id = :participant_id
				");
				$stmt->execute([':participant_id' => $participantId]);
				$calendar = $stmt->fetch(PDO::FETCH_ASSOC);
				echo json_encode(['success' => true, 'calendar' => $calendar]);
				break;

		case 'approve_user':
		$data = json_decode(file_get_contents('php://input'), true);
		$userId = $data['user_id'];
		$stmt = $pdo->prepare("UPDATE users SET is_verified = TRUE WHERE id = ?");
		if ($stmt->execute([$userId])) {
			echo json_encode(['success' => true, 'message' => 'User approved successfully']);
		} else {
			echo json_encode(['success' => false, 'message' => 'Failed to approve user']);
		}
		break;

		case 'get_users':
		$stmt = $pdo->query("
			SELECT id, email, is_verified, role, full_name, created_at
			FROM users
			ORDER BY role DESC
		");
		$users = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode($users);
		break;

		case 'get_subscribers':
		$stmt = $pdo->query("
			SELECT s.id, s.user_id, u.email 
			FROM subscribers s 
			LEFT JOIN users u ON s.user_id = u.id
		");
		$subscribers = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode($subscribers);
		break;

		case 'login':
		try {
			$email = $_POST['email'] ?? '';
			$password = $_POST['password'] ?? '';

			error_log("Login attempt for email: $email");

			$stmt = $pdo->prepare("SELECT id, email, password, is_verified, role, full_name FROM users WHERE email = ?");
			$stmt->execute([$email]);
			$user = $stmt->fetch(PDO::FETCH_ASSOC);

			if ($user && password_verify($password, $user['password'])) {
				if (!$user['is_verified']) {
					echo json_encode(['success' => false, 'message' => 'Your account is not yet verified. Please wait for admin verification.']);
				} else {
					$_SESSION['user_id'] = $user['id'];
					$_SESSION['user_role'] = $user['role'];
					$_SESSION['user_full_name'] = $user['full_name'];

					$token = generateJWT($user['id'], $user['role']);
					if ($token === null) {
						throw new Exception('Failed to generate JWT');
					}
					

					$response = [
						'success' => true,
						'message' => 'login_successful',
						'token' => $token,
						'user_role' => $user['role'],
						'user_full_name' => $user['full_name']
					];
					error_log("Login response: " . json_encode($response));
					echo json_encode($response);
				}
			} else {
				echo json_encode(['success' => false, 'message' => 'Invalid email or password.']);
			}
		} catch (Exception $e) {
			error_log("Login error: " . $e->getMessage());
			echo json_encode(['success' => false, 'message' => 'An error occurred during login: ' . $e->getMessage()]);
		}
		break;

		case 'get_attendance_dates':
		try {
			$stmt = $pdo->query("
				SELECT DISTINCT date 
				FROM attendance 
				WHERE date <= CURRENT_DATE 
				ORDER BY date DESC
			");
			$dates = $stmt->fetchAll(PDO::FETCH_COLUMN);
			echo json_encode(['success' => true, 'dates' => $dates]);
		} catch (PDOException $e) {
			echo json_encode(['success' => false, 'message' => 'Error fetching attendance dates: ' . $e->getMessage()]);
		}
		break;
		
					case 'getAvailableDates':
		$stmt = $pdo->prepare("SELECT DISTINCT date::date AS date FROM honors ORDER BY date DESC");
		$stmt->execute();
		$dates = $stmt->fetchAll(PDO::FETCH_COLUMN);
		echo json_encode($dates);
					break;

		case 'remove_group':
			$data = json_decode(file_get_contents('php://input'), true);
			$groupId = (int)$data['group_id'];

			$pdo->beginTransaction();

			try {
				// First, update all participants in this group to have no group
				$stmt = $pdo->prepare("UPDATE participants SET group_id = NULL WHERE group_id = ?");
				$stmt->execute([$groupId]);

				// Then delete the group
				$stmt = $pdo->prepare("DELETE FROM groups WHERE id = ?");
				if ($stmt->execute([$groupId])) {
					$pdo->commit();
					echo json_encode(['status' => 'success', 'message' => translate('group_removed_successfully')]);
				} else {
					throw new Exception(translate('error_removing_group'));
				}
			} catch (Exception $e) {
				$pdo->rollBack();
				echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
			}
			break;

		case 'add_group':
				$data = json_decode(file_get_contents('php://input'), true);
		$groupName = sanitizeInput($data['group_name']);

		$stmt = $pdo->prepare("INSERT INTO groups (name, organization_id) VALUES (?, ?)");

			if ($stmt->execute([$groupName, $organization_id])) {
					echo json_encode(['status' => 'success', 'message' => translate('group_added_successfully')]);
			} else {
					echo json_encode(['status' => 'error', 'message' => translate('error_adding_group')]);
			}
			break;

		case 'update_group_name':
			$data = json_decode(file_get_contents('php://input'), true);
			$groupId = (int)$data['group_id'];
			$groupName = sanitizeInput($data['group_name']);

			$stmt = $pdo->prepare("UPDATE groups SET name = ? WHERE id = ?");
			if ($stmt->execute([$groupName, $groupId])) {
				echo json_encode(['status' => 'success', 'message' => translate('group_name_updated_successfully')]);
			} else {
				echo json_encode(['status' => 'error', 'message' => translate('error_updating_group_name')]);
			}
			break;
		case 'get_badge_progress':
			$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
			if (!$participantId) {
				echo json_encode(['error' => 'Invalid participant ID']);
				exit;
			}

			$stmt = $pdo->prepare("
				SELECT * FROM badge_progress 
				WHERE participant_id = ? 
				ORDER BY created_at DESC
			");
			$stmt->execute([$participantId]);
			$badgeProgress = $stmt->fetchAll(PDO::FETCH_ASSOC);
			echo json_encode($badgeProgress);
			break;

						case 'get_current_stars':
			$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
			$territoire = filter_input(INPUT_GET, 'territoire', FILTER_SANITIZE_STRING);

			if (!$participantId || !$territoire) {
				echo json_encode(['error' => 'Invalid input data']);
				exit;
			}

			$stmt = $pdo->prepare("
				SELECT MAX(etoiles) as current_stars,
								COUNT(*) as pending_count
				FROM badge_progress
				WHERE participant_id = ? AND territoire_chasse = ? AND status IN ('approved', 'pending')
			");
			$stmt->execute([$participantId, $territoire]);
			$result = $stmt->fetch(PDO::FETCH_ASSOC);

			echo json_encode([
				'current_stars' => $result['current_stars'] ?? 0,
				'has_pending' => $result['pending_count'] > 0
			]);
			break;

		case 'get_participants':
		$organizationId = getCurrentOrganizationId();
		if (!$organizationId) {
			echo json_encode(['success' => false, 'message' => 'No organization selected']);
			break;
		}

		$stmt = $pdo->prepare("
			SELECT 
				p.id, 
				p.first_name, 
				p.last_name, 
				COALESCE(SUM(pt.value), 0) AS total_points,
				pg.group_id,
				g.name AS group_name,
				pg.is_leader,
				pg.is_second_leader
			FROM participants p
			LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organizationId
			LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organizationId
			LEFT JOIN points pt ON p.id = pt.name_id AND pt.organization_id = :organizationId
			WHERE p.organization_id = :organizationId
			GROUP BY p.id, pg.group_id, g.name, pg.is_leader, pg.is_second_leader
			ORDER BY g.name, p.last_name, p.first_name
		");

		$stmt->execute(['organizationId' => $organizationId]);
		$participants = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode(['success' => true, 'participants' => $participants]);
		break;

		case 'remove_participant_from_group':
		$data = json_decode(file_get_contents('php://input'), true);
		$participantId = (int)$data['participant_id'];
		$groupId = (int)$data['group_id'];
		$organizationId = getCurrentOrganizationId();

		$stmt = $pdo->prepare("DELETE FROM participant_groups WHERE participant_id = ? AND group_id = ? AND organization_id = ?");
		if ($stmt->execute([$participantId, $groupId, $organizationId])) {
				echo json_encode(['status' => 'success', 'message' => 'Participant removed from group successfully']);
		} else {
				echo json_encode(['status' => 'error', 'message' => 'Error removing participant from group']);
		}
		break;


		case 'get_participants_with_documents':
		try {
				// Retrieve form structures from organization_settings
				$organizationId = getCurrentOrganizationId();

				$settingsQuery = "
						SELECT form_type 
						FROM organization_form_formats 
						WHERE organization_id = :organization_id
				";

				$settingsStmt = $pdo->prepare($settingsQuery);
				$settingsStmt->execute(['organization_id' => $organizationId]);
				$formStructures = $settingsStmt->fetchAll(PDO::FETCH_COLUMN);

				// Build dynamic SELECT fields and JOIN statements
				$selectFields = "p.id, p.first_name, p.last_name";
				$joinClauses = "";
				$params = ['organization_id' => $organizationId];

			$usedAliases = []; // Track used aliases

			foreach ($formStructures as $formStructure) {
					$formType = str_replace('_structure', '', $formStructure); // Extract the form type
					$baseAlias = 'fs_' . preg_replace('/[^a-zA-Z0-9]/', '', $formType);

					// Ensure the alias is unique
					$tableAlias = $baseAlias;
					$counter = 1;
					while (in_array($tableAlias, $usedAliases)) {
							$tableAlias = $baseAlias . $counter;
							$counter++;
					}
					$usedAliases[] = $tableAlias; // Store the alias to prevent future collisions

					// Add the dynamic SELECT field
					$selectFields .= ", CASE WHEN {$tableAlias}.id IS NOT NULL THEN 1 ELSE 0 END AS has_{$formType}";

					// Add the LEFT JOIN clause and parameter placeholders
					$joinClauses .= " 
							LEFT JOIN form_submissions {$tableAlias} 
							ON p.id = {$tableAlias}.participant_id 
							AND {$tableAlias}.form_type = :form_type_{$formType} 
							AND {$tableAlias}.organization_id = :organization_id";

					// Bind the form_type parameter for this specific form structure
					$params["form_type_{$formType}"] = $formType;
			}


				// Construct the final query
				$query = "
						SELECT {$selectFields}
						FROM participants p
						{$joinClauses}
						WHERE p.organization_id = :organization_id
						ORDER BY p.last_name, p.first_name
				";

			error_log(print_r($query, true));
			error_log(print_r($params, true));


				$stmt = $pdo->prepare($query);
				$stmt->execute($params);
				$participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

				if ($participants === false) {
						throw new Exception("Error fetching participants");
				}

				echo json_encode(['success' => true, 'participants' => $participants]);
		} catch (Exception $e) {
				error_log('Error in get_participants_with_documents: ' . $e->getMessage());
				echo json_encode(['success' => false, 'message' => 'Error fetching participants with documents: ' . $e->getMessage()]);
		}
		break;

		case 'get_parent_contact_list':
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
						pg.is_emergency_contact,
						pg.is_primary
				FROM participants p
				LEFT JOIN participant_groups pgroups ON p.id = pgroups.participant_id 
						AND pgroups.organization_id = :organization_id
				LEFT JOIN groups g ON pgroups.group_id = g.id
				LEFT JOIN participant_guardians pgp ON p.id = pgp.participant_id
				LEFT JOIN parents_guardians pg ON pgp.parent_guardian_id = pg.id
				WHERE pgroups.organization_id = :organization_id
				ORDER BY p.first_name, p.last_name, pg.is_primary DESC
		";

		$stmt = $pdo->prepare($query);
		$stmt->execute(['organization_id' => $organization_id]);
		$result = $stmt->fetchAll(PDO::FETCH_ASSOC);

		// Organize data by child
		$children = [];
		foreach ($result as $row) {
				$childId = $row['id'];
				if (!isset($children[$childId])) {
						$children[$childId] = [
								'name' => $row['first_name'] . ' ' . $row['last_name'],
								'groups' => [],
								'contacts' => []
						];
				}

				// Add group if not already present
				if (!in_array($row['group_name'], $children[$childId]['groups'])) {
						$children[$childId]['groups'][] = $row['group_name'];
				}

				// Only add unique contact entries
				$contactEntry = [
						'name' => $row['prenom'] . ' ' . $row['nom'],
						'phone_home' => $row['telephone_residence'],
						'phone_cell' => $row['telephone_cellulaire'],
						'phone_work' => $row['telephone_travail'],
						'is_emergency' => $row['is_emergency_contact']
				];

				if ($row['nom'] && $row['prenom'] && !in_array($contactEntry, $children[$childId]['contacts'])) {
						$children[$childId]['contacts'][] = $contactEntry;
				}
		}

		// Send back JSON response
		echo json_encode($children);
		break;



		case 'get_pending_badges':
		$organizationId = getCurrentOrganizationId();
		$stmt = $pdo->prepare("
				SELECT bp.*, p.first_name, p.last_name 
				FROM badge_progress bp 
				JOIN participants p ON bp.participant_id = p.id 
				WHERE bp.status = 'pending' 
				AND p.organization_id = :organization_id
				ORDER BY bp.date_obtention
		");
		$stmt->execute([':organization_id' => $organizationId]);
		$pending_badges = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode($pending_badges);
		break;


		case 'update_badge_status':
		$data = json_decode(file_get_contents('php://input'), true);
		$badge_id = $data['badge_id'];
		$action = $data['action'];
		$user_id = getUserIdFromToken($token); // Ensure proper token handling
		$organization_id = getCurrentOrganizationId(); // Assuming this function fetches the correct organization_id

		$stmt = $pdo->prepare("UPDATE badge_progress 
													 SET status = ?, approved_by = ?, approval_date = NOW() 
													 WHERE id = ? AND organization_id = ?");
		$result = $stmt->execute([$action, $user_id, $badge_id, $organization_id]);

		if ($result) {
				echo json_encode(['success' => true, 'message' => translate('badge_status_updated')]);
		} else {
				echo json_encode(['success' => false, 'message' => translate('error_updating_badge_status')]);
		}
			break;

		case 'get_groups':
		$organizationId = getCurrentOrganizationId();
		$stmt = $pdo->prepare("
				SELECT DISTINCT g.id, g.name
FROM groups g
WHERE g.organization_id = :organization_id;
");
		$stmt->execute([':organization_id' => $organizationId]);
		$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode(['success' => true, 'groups' => $groups]);
		break;



	case 'get_attendance':
    $date = $_GET['date'] ?? date('Y-m-d');
    $organizationId = getCurrentOrganizationId();
    $stmt = $pdo->prepare("
        SELECT a.name_id, a.status
        FROM attendance a
        JOIN participants p ON a.name_id = p.id 
        WHERE a.date = ? AND p.organization_id = ?
    ");
    $stmt->execute([$date, $organizationId]);
    $attendance = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    echo json_encode($attendance);
    break;


case 'update_attendance':
    $data = json_decode(file_get_contents('php://input'), true);
    $nameId = $data['name_id'];
    $newStatus = $data['status'];
    $date = $data['date'];
    $previousStatus = $data['previous_status'];
    $organizationId = getCurrentOrganizationId();

    try {
        $pdo->beginTransaction();

        // Ensure the participant is part of the organization
        $stmt = $pdo->prepare("
            SELECT id FROM participants 
            WHERE id = :name_id AND organization_id = :organization_id
        ");
        $stmt->execute([':name_id' => $nameId, ':organization_id' => $organizationId]);
        if (!$stmt->fetch()) {
            throw new Exception('Participant not found in the current organization');
        }

        // Update attendance
        $stmt = $pdo->prepare("
            INSERT INTO attendance (name_id, date, status, organization_id)
            VALUES (:name_id, :date, :status, :organization_id)
            ON CONFLICT (name_id, date) DO UPDATE SET status = EXCLUDED.status
        ");
        $stmt->execute([
            ':name_id' => $nameId,
            ':date' => $date,
            ':status' => $newStatus,
            ':organization_id' => $organizationId
        ]);

        // Point adjustment logic
        $pointAdjustment = 0;
        if ($previousStatus !== 'absent' && $newStatus === 'absent') {
            $pointAdjustment = -1;
        } elseif ($previousStatus === 'absent' && $newStatus !== 'absent') {
            $pointAdjustment = 1;
        }

        if ($pointAdjustment !== 0) {
            // Insert individual point adjustment
            $stmt = $pdo->prepare("
                INSERT INTO points (name_id, value, created_at, organization_id)
                VALUES (:name_id, :value, CURRENT_TIMESTAMP, :organization_id)
            ");
            $stmt->execute([
                ':name_id' => $nameId,
                ':value' => $pointAdjustment,
                ':organization_id' => $organizationId
            ]);
        }

        $pdo->commit();
        echo json_encode(['status' => 'success', 'point_adjustment' => $pointAdjustment]);
    } catch (PDOException $e) {
        $pdo->rollBack();
        echo json_encode(['status' => 'error', 'message' => 'Error updating attendance: ' . $e->getMessage()]);
    }
    break;



		case 'get_honors':
		$organizationId = getCurrentOrganizationId();
		$date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');
		$academicYearStart = (date('n') >= 9) ? date('Y-09-01') : date('Y-09-01', strtotime('-1 year'));

		// Fetch participants with their group information
		$participantsStmt = $pdo->prepare("
				SELECT p.id AS name_id, p.first_name, p.last_name, 
							 pg.group_id, COALESCE(g.name, 'no_group') AS group_name
				FROM participants p
				LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
				LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
				WHERE p.organization_id = :organization_id
				ORDER BY g.name, p.last_name, p.first_name
		");
		$participantsStmt->execute([':organization_id' => $organizationId]);
		$participants = $participantsStmt->fetchAll(PDO::FETCH_ASSOC);

		// Fetch honors for the academic year
		$honorsStmt = $pdo->prepare("
				SELECT name_id, date
				FROM honors
				WHERE date >= :academic_year_start 
				AND date <= :current_date
				AND organization_id = :organization_id
		");
		$honorsStmt->execute([
				':academic_year_start' => $academicYearStart,
				':current_date' => $date,
				':organization_id' => $organizationId
		]);
		$honors = $honorsStmt->fetchAll(PDO::FETCH_ASSOC);

		// Fetch available dates
		$datesStmt = $pdo->prepare("
				SELECT DISTINCT date
				FROM honors
				WHERE organization_id = :organization_id
				AND date >= :academic_year_start AND date <= CURRENT_DATE
				ORDER BY date DESC
		");
		$datesStmt->execute([
				':organization_id' => $organizationId,
				':academic_year_start' => $academicYearStart
		]);
		$availableDates = $datesStmt->fetchAll(PDO::FETCH_COLUMN);

		echo json_encode([
				'participants' => $participants,
				'honors' => $honors,
				'availableDates' => $availableDates
		]);
		break;


		case 'award_honor':
		$honors = json_decode(file_get_contents('php://input'), true);
		$organizationId = getCurrentOrganizationId();
		$pdo->beginTransaction();
		$awards = [];

		foreach ($honors as $honor) {
				$nameId = $honor['nameId'];
				$date = $honor['date'];

				// Ensure the participant belongs to the current organization
				$stmt = $pdo->prepare("
						INSERT INTO honors (name_id, date, organization_id)
						VALUES (?, ?, ?)
						ON CONFLICT (name_id, date, organization_id) DO NOTHING
						RETURNING id
				");
				$stmt->execute([$nameId, $date, $organizationId]);
				$result = $stmt->fetch(PDO::FETCH_ASSOC);

				if ($result !== false) {
						$pointStmt = $pdo->prepare("
								INSERT INTO points (name_id, value, created_at, organization_id)
								VALUES (?, 5, ?, ?)
						");
						$pointStmt->execute([$nameId, $date, $organizationId]);

						$awards[] = ['nameId' => $nameId, 'awarded' => true];
				} else {
						$awards[] = [
								'nameId' => $nameId,
								'awarded' => false,
								'message' => 'Honor already awarded for this date'
						];
				}
		}

		$pdo->commit();
		echo json_encode(['status' => 'success', 'awards' => $awards]);
		break;


		case 'get_badge_progress':
		$participantId = $_GET['participant_id'] ?? null;
		$organizationId = getCurrentOrganizationId();

		if ($participantId) {
				$stmt = $pdo->prepare("
						SELECT * FROM badge_progress 
						WHERE participant_id = ? 
						AND organization_id = ?
						ORDER BY created_at DESC
				");
				$stmt->execute([$participantId, $organizationId]);
				$badgeProgress = $stmt->fetchAll(PDO::FETCH_ASSOC);
				echo json_encode($badgeProgress);
		} else {
				echo json_encode(['error' => 'Invalid participant ID']);
		}
		break;

		case 'get_form_submission':
		// Verify JWT token and get user ID
		$token = getJWTFromHeader();
		if (!$token || !verifyJWT($token)) {
				echo json_encode(['success' => false, 'message' => 'Invalid or missing token']);
				exit;
		}
		$userId = getUserIdFromToken($token);

		$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
		$formType = filter_input(INPUT_GET, 'form_type', FILTER_UNSAFE_RAW);
		$formType = trim(htmlspecialchars($formType, ENT_QUOTES, 'UTF-8'));

		if (!$participantId || !$formType) {
				echo json_encode(['success' => false, 'message' => 'Invalid participant ID or form type']);
				exit;
		}

		try {
				// Ensure the user has permission to access this participant's data
				if (!userHasAccessToParticipant($pdo, $userId, $participantId)) {
						echo json_encode(['success' => false, 'message' => 'You do not have permission to access this participant\'s data']);
						exit;
				}

				$stmt = $pdo->prepare("
						SELECT fs.submission_data
						FROM form_submissions fs
						WHERE fs.participant_id = :participant_id AND fs.form_type = :form_type
						ORDER BY fs.created_at DESC
						LIMIT 1
				");
				$stmt->execute([
						':participant_id' => $participantId,
						':form_type' => $formType
				]);

				$result = $stmt->fetch(PDO::FETCH_ASSOC);

			if ($result) {
					$formData = json_decode($result['submission_data'], true);
					// Include form_type in the response
					echo json_encode([
							'success' => true,
							'form_data' => $formData,
							'form_type' => $formType // Include the form type here
					]);
			} else {
					echo json_encode(['success' => false, 'message' => 'Form submission not found']);
			}

		} catch (PDOException $e) {
				error_log('Database error: ' . $e->getMessage());
				echo json_encode(['success' => false, 'message' => 'An error occurred while fetching the form submission']);
		}
		break;


	case 'get_parent_dashboard_data':
    $userId = getUserIdFromToken($token);
    if (!$userId) {
        echo json_encode(['success' => false, 'message' => 'Invalid user']);
        exit;
    }

    $organizationId = getCurrentOrganizationId();
    error_log("User ID: $userId, Organization ID: $organizationId");

    $stmt = $pdo->prepare("
        SELECT role 
        FROM user_organizations 
        WHERE user_id = ? 
        AND organization_id = ?
    ");
    $stmt->execute([$userId, $organizationId]);
    $userRole = $stmt->fetchColumn();
    error_log("User Role: $userRole");

    if ($userRole === 'animation' || $userRole === 'admin') {
        $query = "
            SELECT p.*, 
                CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END as has_fiche_sante,
                CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END as has_acceptation_risque
            FROM participants p
            LEFT JOIN (
                SELECT DISTINCT participant_id, id 
                FROM form_submissions 
                WHERE form_type = 'fiche_sante' AND organization_id = :organization_id
            ) fs ON p.id = fs.participant_id
            LEFT JOIN (
                SELECT DISTINCT participant_id, id 
                FROM form_submissions 
                WHERE form_type = 'acceptation_risque' AND organization_id = :organization_id
            ) ar ON p.id = ar.participant_id
            WHERE p.organization_id = :organization_id
        ";
        $params = [':organization_id' => $organizationId];
    } else {
        $query = "
            SELECT p.*, 
                CASE WHEN fs.id IS NOT NULL THEN 1 ELSE 0 END as has_fiche_sante,
                CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END as has_acceptation_risque
            FROM participants p
            LEFT JOIN user_participants up ON p.id = up.participant_id
            LEFT JOIN (
                SELECT DISTINCT participant_id, id 
                FROM form_submissions 
                WHERE form_type = 'fiche_sante' AND organization_id = :organization_id
            ) fs ON p.id = fs.participant_id
            LEFT JOIN (
                SELECT DISTINCT participant_id, id 
                FROM form_submissions 
                WHERE form_type = 'acceptation_risque' AND organization_id = :organization_id
            ) ar ON p.id = ar.participant_id
            WHERE p.organization_id = :organization_id
                AND (up.user_id = :user_id 
                    OR EXISTS (
                        SELECT 1 
                        FROM form_submissions fs 
                        WHERE fs.participant_id = p.id 
                        AND fs.form_type = 'participant_registration'
                        AND fs.submission_data->>'courriel' = (SELECT email FROM users WHERE id = :user_id)
                    ))
        ";
        $params = [':organization_id' => $organizationId, ':user_id' => $userId];
    }

    error_log("Query: " . $query);
    error_log("Params: " . json_encode($params));

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

    error_log("Participants count: " . count($participants));

    if (count($participants) === 0) {
        $checkStmt = $pdo->prepare("SELECT COUNT(*) FROM participants WHERE organization_id = ?");
        $checkStmt->execute([$organizationId]);
        $totalParticipants = $checkStmt->fetchColumn();
        error_log("Total participants in organization: " . $totalParticipants);
    }

    echo json_encode(['success' => true, 'participants' => $participants]);
    break;

		case 'save_badge_progress':
		$data = json_decode(file_get_contents('php://input'), true);

		// Fetch the current max stars for the given participant and territoire_chasse
		$stmt = $pdo->prepare("
				SELECT MAX(etoiles) as max_stars
				FROM badge_progress
				WHERE participant_id = ? AND territoire_chasse = ?
		");
		$stmt->execute([$data['participant_id'], $data['territoire_chasse']]);
		$maxStarsResult = $stmt->fetch(PDO::FETCH_ASSOC);

		// Calculate the next star
		$nextStar = $maxStarsResult['max_stars'] ? $maxStarsResult['max_stars'] + 1 : 1;

		// Ensure it doesn't exceed 3
		if ($nextStar > 3) {
				echo json_encode(['status' => 'error', 'message' => 'Maximum stars already reached for this badge.']);
				exit;
		}

		// Insert the badge progress with the correct star count
		$stmt = $pdo->prepare("
				INSERT INTO badge_progress (
						participant_id, territoire_chasse, objectif, description, 
						fierte, raison, date_obtention, etoiles, status, organization_id
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		");

		$result = $stmt->execute([
				$data['participant_id'], 
				$data['territoire_chasse'], 
				$data['objectif'],
				$data['description'], 
				isset($data['fierte']) && $data['fierte'] ? 't' : 'f',
				$data['raison'],
				$data['date_obtention'], 
				$nextStar, 
				'pending',
				$organization_id
		]);

		if ($result) {
				echo json_encode(['status' => 'success', 'message' => 'Badge progress saved successfully', 'etoiles' => $nextStar]);
		} else {
				$errorInfo = $stmt->errorInfo();
				echo json_encode(['status' => 'error', 'message' => 'Failed to save badge progress', 'error' => $errorInfo[2]]);
		}
		break;


		case 'get_health_contact_report':
			$stmt = $pdo->query("
				SELECT 
					p.id AS participant_id,
					p.first_name,
					p.last_name,
					p.date_naissance,
					g.name AS group_name,
					fs.*
				FROM participants p
				LEFT JOIN groups g ON p.group_id = g.id
				LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
				ORDER BY g.name, p.last_name, p.first_name
			");
			$healthContactData = $stmt->fetchAll(PDO::FETCH_ASSOC);
			echo json_encode($healthContactData);
			break;

		case 'get_attendance_report':
		try {
				$endDate = $_GET['end_date'] ?? date('Y-m-d');
				$startDate = $_GET['start_date'] ?? date('Y-m-d', strtotime('-30 days'));

				// Get total days
				$stmt = $pdo->prepare("
						SELECT COUNT(DISTINCT date) as total_days
						FROM attendance
						WHERE date BETWEEN :start_date AND :end_date
						AND organization_id = :organization_id
				");
				$stmt->execute([
						':start_date' => $startDate,
						':end_date' => $endDate,
						':organization_id' => $organizationId
				]);
				$totalDays = $stmt->fetchColumn();

				// Get attendance data
				$stmt = $pdo->prepare("
						WITH attendance_days AS (
								SELECT DISTINCT date
								FROM attendance
								WHERE date BETWEEN :start_date AND :end_date
								AND organization_id = :organization_id
						)
						SELECT 
								p.id, 
								p.first_name, 
								p.last_name, 
								g.name AS group_name,
								COUNT(DISTINCT ad.date) AS total_days,
								SUM(CASE WHEN a.status IN ('absent', 'non-motivated') THEN 1 ELSE 0 END) AS days_absent,
								SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS days_late
						FROM participants p
						LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
						LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
						CROSS JOIN attendance_days ad
						LEFT JOIN attendance a ON p.id = a.name_id AND a.date = ad.date AND a.organization_id = :organization_id
						WHERE p.organization_id = :organization_id
						GROUP BY p.id, p.first_name, p.last_name, g.name
						ORDER BY g.name, p.last_name, p.first_name
				");
				$stmt->execute([
						':start_date' => $startDate,
						':end_date' => $endDate,
						':organization_id' => $organizationId
				]);
				$attendanceData = $stmt->fetchAll(PDO::FETCH_ASSOC);

				$reportData = [
						'success' => true,
						'start_date' => $startDate,
						'end_date' => $endDate,
						'total_days' => $totalDays,
						'attendance_data' => $attendanceData
				];
				echo json_encode($reportData);
		} catch (PDOException $e) {
				error_log("Database error in get_attendance_report: " . $e->getMessage());
				echo json_encode([
						'success' => false,
						'error' => 'An error occurred while fetching the attendance report'
				]);
		}
		break;

		case 'get_health_contact_report':
			$stmt = $pdo->query("
				SELECT 
					p.id AS participant_id,
					p.first_name,
					p.last_name,
					p.date_naissance,
					g.name AS group_name,
					fs.*
				FROM participants p
				LEFT JOIN groups g ON p.group_id = g.id
				LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
				ORDER BY g.name, p.last_name, p.first_name
			");
			$healthContactData = $stmt->fetchAll(PDO::FETCH_ASSOC);
			echo json_encode($healthContactData);
			break;

		// Update these queries in your api.php file

		case 'get_allergies_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										fs.submission_data->>'allergie' AS allergies,
										(fs.submission_data->>'epipen')::boolean AS epipen
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = :organization_id
								WHERE fs.form_type = 'fiche_sante'
								AND p.organization_id = :organization_id
								AND (fs.submission_data->>'allergie' IS NOT NULL AND fs.submission_data->>'allergie' != '')
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_allergies_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the allergies report']);
				}
				break;

		case 'get_medication_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										fs.submission_data->>'medicament' AS medication
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = :organization_id
								WHERE fs.form_type = 'fiche_sante'
								AND p.organization_id = :organization_id
								AND (fs.submission_data->>'medicament' IS NOT NULL AND fs.submission_data->>'medicament' != '')
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_medication_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the medication report']);
				}
				break;

		case 'get_vaccine_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										(fs.submission_data->>'vaccins_a_jour')::boolean AS vaccines_up_to_date
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = :organization_id
								WHERE fs.form_type = 'fiche_sante'
								AND p.organization_id = :organization_id
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_vaccine_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the vaccine report']);
				}
				break;

		case 'get_leave_alone_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										(fs.submission_data->>'peut_partir_seul')::boolean AS can_leave_alone
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = :organization_id
								WHERE fs.form_type = 'participant_registration'
								AND p.organization_id = :organization_id
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_leave_alone_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the leave alone report']);
				}
				break;

		case 'get_media_authorization_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										(fs.submission_data->>'consentement_photos_videos')::boolean AS media_authorized
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = :organization_id
								WHERE fs.form_type = 'participant_registration'
								AND p.organization_id = :organization_id
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_media_authorization_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the media authorization report']);
				}
				break;

		case 'get_missing_documents_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										CASE WHEN fs_fiche.id IS NULL THEN 'Fiche Santé' ELSE NULL END AS missing_fiche_sante,
										CASE WHEN fs_risque.id IS NULL THEN 'Acceptation Risque' ELSE NULL END AS missing_acceptation_risque
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN form_submissions fs_fiche ON p.id = fs_fiche.participant_id AND fs_fiche.form_type = 'fiche_sante' AND fs_fiche.organization_id = :organization_id
								LEFT JOIN form_submissions fs_risque ON p.id = fs_risque.participant_id AND fs_risque.form_type = 'acceptation_risque' AND fs_risque.organization_id = :organization_id
								WHERE p.organization_id = :organization_id
								AND (fs_fiche.id IS NULL OR fs_risque.id IS NULL)
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						$results = $stmt->fetchAll(PDO::FETCH_ASSOC);
						foreach ($results as &$result) {
								$result['missing_documents'] = array_filter([$result['missing_fiche_sante'], $result['missing_acceptation_risque']]);
								unset($result['missing_fiche_sante'], $result['missing_acceptation_risque']);
						}
						echo json_encode(['success' => true, 'data' => $results]);
				} catch (PDOException $e) {
						error_log("Database error in get_missing_documents_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the missing documents report']);
				}
				break;


		case 'get_honors_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										p.first_name || ' ' || p.last_name AS name,
										g.name AS group_name,
										COUNT(h.id) AS honors_count
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN honors h ON p.id = h.name_id AND h.organization_id = :organization_id
								WHERE p.organization_id = :organization_id
								GROUP BY p.id, g.name
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
				} catch (PDOException $e) {
						error_log("Database error in get_honors_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the honors report']);
				}
				break;

		case 'get_points_report':
				try {
						$stmt = $pdo->prepare("
								SELECT 
										g.name AS group_name,
										p.first_name || ' ' || p.last_name AS name,
										COALESCE(SUM(pt.value), 0) AS points
								FROM participants p
								LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = :organization_id
								LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = :organization_id
								LEFT JOIN points pt ON p.id = pt.name_id AND pt.organization_id = :organization_id
								WHERE p.organization_id = :organization_id
								GROUP BY g.id, p.id
								ORDER BY g.name, p.last_name, p.first_name
						");
						$stmt->execute([':organization_id' => $organizationId]);
						$results = $stmt->fetchAll(PDO::FETCH_ASSOC);
						$groupedResults = [];
						foreach ($results as $result) {
								$groupedResults[$result['group_name']][] = [
										'name' => $result['name'],
										'points' => $result['points']
								];
						}
						echo json_encode(['success' => true, 'data' => $groupedResults]);
				} catch (PDOException $e) {
						error_log("Database error in get_points_report: " . $e->getMessage());
						echo json_encode(['success' => false, 'error' => 'An error occurred while fetching the points report']);
				}
				break;

					case 'logout':
				// Unset all of the session variables
				$_SESSION = array();

				// If it's desired to kill the session, also delete the session cookie
				if (ini_get("session.use_cookies")) {
					$params = session_get_cookie_params();
					setcookie(session_name(), '', time() - 42000,
						$params["path"], $params["domain"],
						$params["secure"], $params["httponly"]
					);
				}

				// Destroy the session
				session_destroy();

				echo json_encode(['success' => true, 'message' => 'Logged out successfully']);
				break;

			default:
				echo json_encode(['error' => 'Invalid action']);
				break;
   case 'get_participant':
        $participantId = $_GET['id'] ?? null;
        if ($participantId) {
            $stmt = $pdo->prepare("
                SELECT p.*, fs.submission_data
                FROM participants p
                LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'participant_registration'
                WHERE p.id = ?");
            $stmt->execute([$participantId]);
            $participant = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($participant) {
                $participant = array_merge($participant, json_decode($participant['submission_data'], true));
                unset($participant['submission_data']);
                echo json_encode(['success' => true, 'participant' => $participant]);
            } else {
                echo json_encode(['success' => false, 'message' => "Participant not found"]);
            }
        } else {
            echo json_encode(['success' => false, 'message' => "Participant ID missing"]);
        }
        break;

		case 'save_form_submission':
		$data = json_decode(file_get_contents('php://input'), true);
		$formType = $data['form_type'];
		$participantId = $data['participant_id'];
		$submissionData = $data['submission_data'];
		$userId = getUserIdFromToken($token);

		try {
			$stmt = $pdo->prepare("
				INSERT INTO form_submissions (organization_id, user_id, participant_id, form_type, submission_data)
				VALUES (:organization_id, :user_id, :participant_id, :form_type, :submission_data)
				ON CONFLICT (participant_id, form_type, organization_id) 
				DO UPDATE SET submission_data = EXCLUDED.submission_data, updated_at = CURRENT_TIMESTAMP
			");

			$result = $stmt->execute([
				':organization_id' => $organization_id,
				':user_id' => $userId,
				':participant_id' => $participantId,
				':form_type' => $formType,
				':submission_data' => json_encode($submissionData),
			]);

			if ($result) {
				echo json_encode(['success' => true, 'message' => 'Form submission saved successfully']);
			} else {
				throw new Exception('Failed to save form submission');
			}
		} catch (Exception $e) {
			echo json_encode(['success' => false, 'message' => 'Error saving form submission: ' . $e->getMessage()]);
		}
		break;


		case 'save_participant':
		$data = json_decode(file_get_contents('php://input'), true);

		// Log incoming data for debugging
		error_log("Received data for save_participant: " . json_encode($data));

		$userId = getUserIdFromToken($token);  // Retrieve the current user ID
		

		if (!$userId || !$organizationId) {
				echo json_encode(['success' => false, 'message' => 'Unauthorized access']);
				exit;
		}

		$pdo->beginTransaction();
		try {
				// Prepare basic participant data, including organization_id
				$participantData = [
						'first_name' => $data['first_name'],
						'last_name' => $data['last_name'],
						'date_naissance' => $data['date_naissance'],
						'organization_id' => $organizationId
				];

				if (isset($data['id']) && !empty($data['id'])) {
						// Check if the participant exists in the database
						$checkStmt = $pdo->prepare("SELECT id FROM participants WHERE id = :id AND organization_id = :organization_id");
						$checkStmt->execute([':id' => $data['id'], ':organization_id' => $organizationId]);
						$existingParticipant = $checkStmt->fetch(PDO::FETCH_ASSOC);

						if ($existingParticipant) {
								// Update existing participant
								$participantData['id'] = $data['id'];
								$stmt = $pdo->prepare("UPDATE participants SET 
																first_name = :first_name, last_name = :last_name, 
																date_naissance = :date_naissance
																WHERE id = :id AND organization_id = :organization_id");
								$stmt->execute($participantData);
								$participantId = $data['id'];
						} else {
								throw new Exception("Participant not found or does not belong to this organization.");
						}
				} else {
						// Insert new participant
						$stmt = $pdo->prepare("INSERT INTO participants 
														(first_name, last_name, date_naissance, organization_id) 
														VALUES (:first_name, :last_name, :date_naissance, :organization_id)");
						$stmt->execute($participantData);
						$participantId = $pdo->lastInsertId();
				}

				// Log successful participant insertion
				error_log("Participant inserted/updated with ID: " . $participantId);

				// Link the participant to the current user in the user_participants table
				$linkStmt = $pdo->prepare("INSERT INTO user_participants (user_id, participant_id) VALUES (:user_id, :participant_id)
																	 ON CONFLICT (user_id, participant_id) DO NOTHING");
				$linkStmt->execute([
						':user_id' => $userId,
						':participant_id' => $participantId
				]);

				// Log successful user-participant linking
				error_log("Linked participant ID $participantId to user ID $userId");

				// Handle form submission data as before
				$formSubmissionData = [
						'organization_id' => $organizationId,
						'user_id' => $userId,
						'participant_id' => $participantId,
						'form_type' => 'participant_registration',
						'submission_data' => json_encode($data),
				];

				// Insert or update form submission
				$stmt = $pdo->prepare("INSERT INTO form_submissions 
												(organization_id, user_id, participant_id, form_type, submission_data, created_at, updated_at) 
												VALUES (:organization_id, :user_id, :participant_id, :form_type, :submission_data, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
												ON CONFLICT (participant_id, form_type, organization_id) DO UPDATE SET
																submission_data = EXCLUDED.submission_data,
																updated_at = CURRENT_TIMESTAMP");
				$stmt->execute($formSubmissionData);

				$pdo->commit();
				echo json_encode(['success' => true, 'participant_id' => $participantId]);
		} catch (Exception $e) {
				$pdo->rollBack();
				error_log("Error in save_participant: " . $e->getMessage());
				echo json_encode(['success' => false, 'message' => $e->getMessage()]);
		}
		break;
;




		case 'remove_guardians':
		$data = json_decode(file_get_contents('php://input'), true);
		$participantId = $data['participant_id'] ?? null;
		$guardianIds = $data['guardian_ids'] ?? [];

		if (!$participantId || empty($guardianIds)) {
			echo json_encode(['success' => false, 'message' => 'Invalid data for removing guardians']);
			break;
		}

		try {
			$pdo->beginTransaction();

			// Remove the links between participant and guardians
			$stmt = $pdo->prepare("
				DELETE FROM participant_guardians 
				WHERE participant_id = :participant_id AND parent_guardian_id IN (" . implode(',', array_fill(0, count($guardianIds), '?')) . ")
			");
			$stmt->execute(array_merge([$participantId], $guardianIds));

			// Remove the guardians if they're not linked to any other participants
			$stmt = $pdo->prepare("
				DELETE FROM parents_guardians 
				WHERE id IN (" . implode(',', array_fill(0, count($guardianIds), '?')) . ")
				AND NOT EXISTS (
					SELECT 1 FROM participant_guardians 
					WHERE parent_guardian_id = parents_guardians.id
				)
			");
			$stmt->execute($guardianIds);

			$pdo->commit();
			echo json_encode(['success' => true, 'message' => 'Guardians removed successfully']);
		} catch (Exception $e) {
			$pdo->rollBack();
			error_log("Error removing guardians: " . $e->getMessage());
			echo json_encode(['success' => false, 'message' => 'Error removing guardians: ' . $e->getMessage()]);
		}
		break;

		case 'save_parent':
		$inputData = file_get_contents('php://input');
		$data = json_decode($inputData, true);
		$participantId = $data['participant_id'] ?? null;

		try {
			$pdo->beginTransaction();

			// Helper function to convert various inputs to PostgreSQL boolean
			function toBool($value) {
				if (is_bool($value)) {
					return $value ? 't' : 'f';
				}
				if (is_string($value)) {
					$lower = strtolower($value);
					if ($lower === 'true' || $lower === '1' || $lower === 'yes' || $lower === 'on') {
						return 't';
					}
				}
				if (is_numeric($value)) {
					return $value ? 't' : 'f';
				}
				return 'f'; // Default to false for any other input
			}

			// Convert boolean values to PostgreSQL format
			$isPrimary = toBool($data['is_primary'] ?? false);
			$isEmergencyContact = toBool($data['is_emergency_contact'] ?? false);

			$stmt = $pdo->prepare("
				INSERT INTO parents_guardians 
				(participant_id, nom, prenom, lien, courriel, telephone_residence, telephone_travail, telephone_cellulaire, is_primary, is_emergency_contact) 
				VALUES (:participant_id, :nom, :prenom, :lien, :courriel, :telephone_residence, :telephone_travail, :telephone_cellulaire, :is_primary, :is_emergency_contact)
				ON CONFLICT (participant_id, courriel) DO UPDATE SET
				nom = EXCLUDED.nom, prenom = EXCLUDED.prenom, lien = EXCLUDED.lien,
				telephone_residence = EXCLUDED.telephone_residence, telephone_travail = EXCLUDED.telephone_travail,
				telephone_cellulaire = EXCLUDED.telephone_cellulaire, is_primary = EXCLUDED.is_primary,
				is_emergency_contact = EXCLUDED.is_emergency_contact
				RETURNING id
			");

			$params = [
				':participant_id' => $participantId,
				':nom' => $data['nom'] ?? '',
				':prenom' => $data['prenom'] ?? '',
				':lien' => $data['lien'] ?? '',
				':courriel' => $data['courriel'] ?? '',
				':telephone_residence' => $data['telephone_residence'] ?? '',
				':telephone_travail' => $data['telephone_travail'] ?? '',
				':telephone_cellulaire' => $data['telephone_cellulaire'] ?? '',
				':is_primary' => $isPrimary,
				':is_emergency_contact' => $isEmergencyContact
			];

			
			$stmt->execute($params);
			$result = $stmt->fetch(PDO::FETCH_ASSOC);
			$parentId = $result['id'];
			

			if ($participantId) {
				$linkStmt = $pdo->prepare("
					INSERT INTO participant_guardians (participant_id, parent_guardian_id)
					VALUES (:participant_id, :parent_guardian_id)
					ON CONFLICT (participant_id, parent_guardian_id) DO NOTHING
				");
				$linkResult = $linkStmt->execute([
					':participant_id' => $participantId,
					':parent_guardian_id' => $parentId
				]);
				error_log("Linking participant and guardian result: " . ($linkResult ? "success" : "failure"));
			}

			$pdo->commit();
			$response = json_encode(['success' => true, 'message' => 'Parent saved successfully', 'parent_id' => $parentId]);
			
			echo $response;
		} catch (Exception $e) {
			$pdo->rollBack();
			$errorResponse = json_encode(['success' => false, 'message' => 'Error saving parent: ' . $e->getMessage()]);
			error_log("Error occurred: " . $errorResponse);
			echo $errorResponse;
		}
		break;
		case 'save_fiche_sante':
		$data = json_decode(file_get_contents('php://input'), true);
		
		if (!isset($data['participant_id'])) {
			error_log('Error: Missing participant_id');
			echo json_encode(['success' => false, 'message' => 'Missing participant_id']);
			exit;
		}

		try {
			$pdo->beginTransaction();
			

			// Check if fiche sante already exists for this participant
			$stmt = $pdo->prepare("SELECT id FROM fiche_sante WHERE participant_id = ?");
			$stmt->execute([$data['participant_id']]);
			$existingFicheSante = $stmt->fetch(PDO::FETCH_ASSOC);

			if ($existingFicheSante) {
				
				$stmt = $pdo->prepare("UPDATE fiche_sante SET 
					nom_fille_mere = :nom_fille_mere, 
					medecin_famille = :medecin_famille, 
					nom_medecin = :nom_medecin, 
					probleme_sante = :probleme_sante,
					allergie = :allergie, 
					epipen = :epipen, 
					medicament = :medicament, 
					limitation = :limitation, 
					vaccins_a_jour = :vaccins_a_jour,
					blessures_operations = :blessures_operations, 
					niveau_natation = :niveau_natation, 
					doit_porter_vfi = :doit_porter_vfi,
					regles = :regles, 
					renseignee = :renseignee
					WHERE participant_id = :participant_id");
			} else {
				
				$stmt = $pdo->prepare("INSERT INTO fiche_sante 
					(nom_fille_mere, medecin_famille, nom_medecin, probleme_sante, allergie, epipen,
					medicament, limitation, vaccins_a_jour, blessures_operations, niveau_natation,
					doit_porter_vfi, regles, renseignee, participant_id)
					VALUES (:nom_fille_mere, :medecin_famille, :nom_medecin, :probleme_sante, :allergie, :epipen,
					:medicament, :limitation, :vaccins_a_jour, :blessures_operations, :niveau_natation,
					:doit_porter_vfi, :regles, :renseignee, :participant_id)");
			}

			$result = $stmt->execute([
				':nom_fille_mere' => $data['nom_fille_mere'],
				':medecin_famille' => $data['medecin_famille'],
				':nom_medecin' => $data['nom_medecin'],
				':probleme_sante' => $data['probleme_sante'],
				':allergie' => $data['allergie'],
				':epipen' => $data['epipen'],
				':medicament' => $data['medicament'],
				':limitation' => $data['limitation'],
				':vaccins_a_jour' => $data['vaccins_a_jour'],
				':blessures_operations' => $data['blessures_operations'],
				':niveau_natation' => $data['niveau_natation'],
				':doit_porter_vfi' => $data['doit_porter_vfi'],
				':regles' => $data['regles'],
				':renseignee' => $data['renseignee'],
				':participant_id' => $data['participant_id']
			]);

			error_log('Fiche sante query executed. Result: ' . ($result ? 'true' : 'false'));

			if (!$result) {
				throw new Exception('Failed to save fiche sante: ' . implode(', ', $stmt->errorInfo()));
			}

			// Update emergency contacts
			$stmt = $pdo->prepare("UPDATE parents_guardians SET is_emergency_contact = FALSE WHERE id IN (SELECT parent_guardian_id FROM participant_guardians WHERE participant_id = ?)");
			$stmt->execute([$data['participant_id']]);
			

			if (!empty($data['emergency_contacts'])) {
				$stmt = $pdo->prepare("UPDATE parents_guardians SET is_emergency_contact = TRUE WHERE id = ? AND id IN (SELECT parent_guardian_id FROM participant_guardians WHERE participant_id = ?)");
				foreach ($data['emergency_contacts'] as $contactId) {
					$stmt->execute([$contactId, $data['participant_id']]);
					
				}
			}

			$pdo->commit();
			
			echo json_encode(['success' => true, 'message' => 'Fiche sante saved successfully']);
		} catch (Exception $e) {
			$pdo->rollBack();
			error_log('Error saving fiche sante: ' . $e->getMessage());
			echo json_encode(['success' => false, 'message' => 'Error saving fiche sante: ' . $e->getMessage()]);
		}
		break;

		
		case 'update_participant_group':
		$data = json_decode(file_get_contents('php://input'), true);
		$participantId = (int)$data['participant_id'];
		$groupId = isset($data['group_id']) ? (int)$data['group_id'] : null;
		$isLeader = isset($data['is_leader']) && $data['is_leader'] !== '' ? (bool)$data['is_leader'] : false;
		$isSecondLeader = isset($data['is_second_leader']) && $data['is_second_leader'] !== '' ? (bool)$data['is_second_leader'] : false;
		$organizationId = getCurrentOrganizationId();

		try {
				$pdo->beginTransaction();

				if ($groupId !== null) {
						// Use UPSERT to update if exists or insert if not
						$upsertStmt = $pdo->prepare("
								INSERT INTO participant_groups 
								(participant_id, group_id, organization_id, is_leader, is_second_leader)
								VALUES (:participant_id, :group_id, :organization_id, :is_leader, :is_second_leader)
								ON CONFLICT (participant_id, organization_id)
								DO UPDATE SET 
										group_id = EXCLUDED.group_id,
										is_leader = EXCLUDED.is_leader,
										is_second_leader = EXCLUDED.is_second_leader
						");
						$upsertStmt->execute([
								':participant_id' => $participantId,
								':group_id' => $groupId,
								':organization_id' => $organizationId,
								':is_leader' => $isLeader,
								':is_second_leader' => $isSecondLeader
						]);
				} else {
						// If no groupId is provided, just delete the entry
						$deleteStmt = $pdo->prepare("
								DELETE FROM participant_groups 
								WHERE participant_id = :participant_id AND organization_id = :organization_id
						");
						$deleteStmt->execute([
								':participant_id' => $participantId,
								':organization_id' => $organizationId
						]);
				}

				$pdo->commit();

				echo json_encode([
						'status' => 'success', 
						'message' => translate('group_updated_successfully')
				]);
		} catch (Exception $e) {
				$pdo->rollBack();
				error_log('Error in update_participant_group: ' . $e->getMessage());
				echo json_encode([
						'status' => 'error', 
						'message' => translate('error_updating_group') . ': ' . $e->getMessage()
				]);
		}
		break;



		
		// In api.php

		case 'get_fiche_sante':
			$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
			if (!$participantId) {
				echo json_encode(['success' => false, 'message' => 'Invalid participant ID']);
				exit;
			}

			try {
				// Fetch the fiche_sante data
				$stmt = $pdo->prepare("
					SELECT * FROM fiche_sante
					WHERE participant_id = ?
				");
				$stmt->execute([$participantId]);
				$ficheSante = $stmt->fetch(PDO::FETCH_ASSOC);

				if ($ficheSante) {
					// Fetch emergency contacts
					$stmtContacts = $pdo->prepare("
						SELECT pg.id, pg.is_emergency_contact
						FROM parents_guardians pg
						JOIN participant_guardians pgp ON pg.id = pgp.parent_guardian_id
						WHERE pgp.participant_id = ?
					");
					$stmtContacts->execute([$participantId]);
					$emergencyContacts = $stmtContacts->fetchAll(PDO::FETCH_ASSOC);

					$ficheSante['emergency_contacts'] = array_filter($emergencyContacts, function($contact) {
						return $contact['is_emergency_contact'];
					});

					echo json_encode([
						'success' => true,
						'fiche_sante' => $ficheSante
					]);
				} else {
					echo json_encode([
						'success' => false,
						'message' => 'Fiche sante not found for this participant'
					]);
				}
			} catch (PDOException $e) {
				error_log('Database error in get_fiche_sante: ' . $e->getMessage());
				echo json_encode([
					'success' => false,
					'message' => 'Database error occurred'
				]);
			}
			break;
		case 'get_parents_guardians':
		$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
		if (!$participantId) {
			echo json_encode(['success' => false, 'message' => 'Invalid participant ID']);
			break;
		}

		try {
			$stmt = $pdo->prepare("
				SELECT pg.* 
				FROM parents_guardians pg
				JOIN participant_guardians pgp ON pg.id = pgp.parent_guardian_id
				WHERE pgp.participant_id = ?
				ORDER BY pg.is_primary DESC
			");
			$stmt->execute([$participantId]);
			$parentsGuardians = $stmt->fetchAll(PDO::FETCH_ASSOC);

			echo json_encode(['success' => true, 'parents_guardians' => $parentsGuardians]);
		} catch (PDOException $e) {
			echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
		}
		break;
		case 'associate_user':
			$data = json_decode(file_get_contents('php://input'), true);
			$participant_id = (int)$data['participant_id'];
			$user_id = (int)$data['user_id'];

			$stmt = $pdo->prepare("INSERT INTO user_participants (user_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
			if ($stmt->execute([$user_id, $participant_id])) {
				echo json_encode(['status' => 'success', 'message' => translate('user_associated_successfully')]);
			} else {
				echo json_encode(['status' => 'error', 'message' => translate('error_associating_user')]);
			}
			break;

	case 'get_participants_with_users':
		$stmt = $pdo->query("
			SELECT p.id, p.first_name, p.last_name, 
							string_agg(u.full_name, ', ') as associated_users
			FROM participants p
			LEFT JOIN user_participants up ON p.id = up.participant_id
			LEFT JOIN users u ON up.user_id = u.id
			GROUP BY p.id, p.first_name, p.last_name
			ORDER BY p.last_name, p.first_name
		");
		echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
		break;

	case 'get_parent_users':
		$stmt = $pdo->query("SELECT id, full_name FROM users WHERE role = 'parent' ORDER BY full_name");
		echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));
		break;

		case 'delete_participant':
		$data = json_decode(file_get_contents('php://input'), true);
		$participantId = $data['participant_id'] ?? null;

		if (!$participantId) {
				echo json_encode(['success' => false, 'message' => 'Missing participant ID']);
				break;
		}

		$pdo->beginTransaction();
		try {
				// Delete from form_submissions first
				$stmt = $pdo->prepare("DELETE FROM form_submissions WHERE participant_id = ?");
				$stmt->execute([$participantId]);

				// Then delete from participants
				$stmt = $pdo->prepare("DELETE FROM participants WHERE id = ?");
				$stmt->execute([$participantId]);

				$pdo->commit();
				echo json_encode(['status' => 'success', 'message' => 'Participant deleted successfully']);
		} catch (Exception $e) {
				$pdo->rollBack();
				echo json_encode(['status' => 'error', 'message' => 'Error deleting participant: ' . $e->getMessage()]);
		}
		break;

		case 'get_acceptation_risque':
			$participantId = filter_input(INPUT_GET, 'participant_id', FILTER_VALIDATE_INT);
			if ($participantId) {
				$stmt = $pdo->prepare("SELECT * FROM acceptation_risque WHERE participant_id = ?");
				$stmt->execute([$participantId]);
				$acceptationRisque = $stmt->fetch(PDO::FETCH_ASSOC);
				if ($acceptationRisque) {
					echo json_encode(['success' => true, 'acceptation_risque' => $acceptationRisque]);
				} else {
					echo json_encode(['success' => false, 'message' => 'Acceptation risque not found']);
				}
			} else {
				echo json_encode(['success' => false, 'message' => 'Invalid participant ID']);
			}
			break;

		case 'save_acceptation_risque':
		$data = json_decode(file_get_contents('php://input'), true);
		$stmt = $pdo->prepare("
			INSERT INTO acceptation_risque 
			(participant_id, groupe_district, accepte_risques, accepte_covid19, 
			participation_volontaire, declaration_sante, declaration_voyage, 
			nom_parent_tuteur, date_signature) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
			ON CONFLICT (participant_id) DO UPDATE SET 
			groupe_district = EXCLUDED.groupe_district, 
			accepte_risques = EXCLUDED.accepte_risques, 
			accepte_covid19 = EXCLUDED.accepte_covid19, 
			participation_volontaire = EXCLUDED.participation_volontaire, 
			declaration_sante = EXCLUDED.declaration_sante, 
			declaration_voyage = EXCLUDED.declaration_voyage, 
			nom_parent_tuteur = EXCLUDED.nom_parent_tuteur, 
			date_signature = EXCLUDED.date_signature
		");
		$result = $stmt->execute([
			$data['participant_id'], $data['groupe_district'], $data['accepte_risques'], 
			$data['accepte_covid19'], $data['participation_volontaire'], $data['declaration_sante'], 
			$data['declaration_voyage'], $data['nom_parent_tuteur'], $data['date_signature']
		]);
		if ($result) {
			echo json_encode(['success' => true, 'message' => 'Acceptation risque saved successfully']);
		} else {
			echo json_encode(['success' => false, 'message' => 'Failed to save acceptation risque']);
		}
		break;

		case 'register':
		$data = json_decode(file_get_contents('php://input'), true);
		$email = sanitizeInput($data['email']);
		$fullName = sanitizeInput($data['full_name']);
		$password = $data['password'];
		$accountCreationPassword = $data['account_creation_password'];
		$userType = $data['user_type'];

		if ($accountCreationPassword !== ACCOUNT_CREATION_PASSWORD) {
			echo json_encode(['success' => false, 'message' => translate('invalid_account_creation_password')]);
			exit;
		}

		$stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
		$stmt->execute([$email]);
		if ($stmt->fetch()) {
			echo json_encode(['success' => false, 'message' => translate('email_already_exists')]);
			exit;
		}

		$hashedPassword = password_hash($password, PASSWORD_DEFAULT);
		$isVerified = ($userType === 'parent') ? 'TRUE' : 'FALSE';

		$stmt = $pdo->prepare("INSERT INTO users (email, password, is_verified, role, full_name) VALUES (?, ?, ?, ?, ?)");
		if ($stmt->execute([$email, $hashedPassword, $isVerified, $userType, $fullName])) {
			$message = ($isVerified === 'TRUE') ? translate('registration_successful_parent') : translate('registration_successful_await_verification');
			echo json_encode(['success' => true, 'message' => $message]);
		} else {
			echo json_encode(['success' => false, 'message' => translate('error_creating_account')]);
		}
		break;

		case 'link_parent_to_participant':
		$data = json_decode(file_get_contents('php://input'), true);
		$parentId = $data['parent_id'] ?? null;
		$participantId = $data['participant_id'] ?? null;

		if (!$parentId || !$participantId) {
			echo json_encode(['success' => false, 'message' => 'Missing parent ID or participant ID']);
			break;
		}

		try {
			$stmt = $pdo->prepare("INSERT INTO participant_guardians (participant_id, parent_guardian_id) VALUES (?, ?)");
			$result = $stmt->execute([$participantId, $parentId]);

			if ($result) {
				echo json_encode(['success' => true, 'message' => 'Parent linked to participant successfully']);
			} else {
				echo json_encode(['success' => false, 'message' => 'Failed to link parent to participant']);
			}
		} catch (PDOException $e) {
			// Check if the error is due to a duplicate entry
			if ($e->getCode() == '23000') {
				echo json_encode(['success' => false, 'message' => 'This parent is already linked to the participant']);
			} else {
				echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
			}
		}
		break;

		case 'update_user_role':
		$data = json_decode(file_get_contents('php://input'), true);
		$userId = $data['user_id'];
		$newRole = $data['new_role'];

		// Validate the new role
		$validRoles = ['parent', 'animation', 'admin'];
		if (!in_array($newRole, $validRoles)) {
			echo json_encode(['success' => false, 'message' => 'Invalid role']);
			break;
		}

		$stmt = $pdo->prepare("UPDATE users SET role = ? WHERE id = ?");
		if ($stmt->execute([$newRole, $userId])) {
			echo json_encode(['success' => true, 'message' => 'User role updated successfully']);
		} else {
			echo json_encode(['success' => false, 'message' => 'Failed to update user role']);
		}
		break;

		case 'get_all_parents':
		$userId = getUserIdFromToken($token);  // Implement this function in jwt_auth.php
		$stmt = $pdo->prepare("SELECT * FROM parents_guardians WHERE user_id = ? ORDER BY is_primary DESC");
		$stmt->execute([$userId]);
		$all_parents = $stmt->fetchAll(PDO::FETCH_ASSOC);
		echo json_encode(['success' => true, 'parents' => $all_parents]);
		break;
	
		case 'update_points':
		$data = json_decode(file_get_contents('php://input'), true);
		$organizationId = getCurrentOrganizationId();
		$pdo->beginTransaction();

		$updateStmt = $pdo->prepare("
			INSERT INTO points (name_id, group_id, value, created_at, organization_id) 
			VALUES (:name_id, :group_id, :value, :created_at, :organization_id)
		");

		$getGroupMembersStmt = $pdo->prepare("
			SELECT p.id 
			FROM participants p
			JOIN participant_groups pg ON p.id = pg.participant_id
			WHERE pg.group_id = :group_id AND pg.organization_id = :organization_id
		");

		$responses = [];

		foreach ($data as $update) {
			if ($update['type'] === 'group') {
				// Add points to the group itself
				$updateStmt->execute([
					':name_id' => null,
					':group_id' => $update['id'],
					':value' => $update['points'],
					':created_at' => $update['timestamp'],
					':organization_id' => $organizationId
				]);

				// Add points to all group members individually
				$getGroupMembersStmt->execute([
					':group_id' => $update['id'],
					':organization_id' => $organizationId
				]);
				$members = $getGroupMembersStmt->fetchAll(PDO::FETCH_COLUMN);

				foreach ($members as $memberId) {
					$updateStmt->execute([
						':name_id' => $memberId,
						':group_id' => null, // This ensures it's counted as an individual point assignment
						':value' => $update['points'],
						':created_at' => $update['timestamp'],
						':organization_id' => $organizationId
					]);
				}

				// Fetch updated group total (only points directly assigned to the group)
				$groupTotalStmt = $pdo->prepare("
					SELECT COALESCE(SUM(value), 0) as total_points 
					FROM points 
					WHERE group_id = :group_id AND name_id IS NULL AND organization_id = :organization_id
				");
				$groupTotalStmt->execute([
					':group_id' => $update['id'],
					':organization_id' => $organizationId
				]);
				$groupTotal = $groupTotalStmt->fetchColumn();

				$responses[] = [
					'type' => 'group',
					'id' => $update['id'],
					'totalPoints' => $groupTotal,
					'memberIds' => $members
				];
			} else {
				// For individual updates, only add points to the individual
				$updateStmt->execute([
					':name_id' => $update['id'],
					':group_id' => null,
					':value' => $update['points'],
					':created_at' => $update['timestamp'],
					':organization_id' => $organizationId
				]);

				// Fetch updated individual total
				$individualTotalStmt = $pdo->prepare("
					SELECT COALESCE(SUM(value), 0) as total_points 
					FROM points 
					WHERE name_id = :name_id AND organization_id = :organization_id
				");
				$individualTotalStmt->execute([
					':name_id' => $update['id'],
					':organization_id' => $organizationId
				]);
				$individualTotal = $individualTotalStmt->fetchColumn();

				$responses[] = [
					'type' => 'individual',
					'id' => $update['id'],
					'totalPoints' => $individualTotal
				];
			}
		}

		$pdo->commit();
		echo json_encode(['status' => 'success', 'updates' => $responses]);
		break;
}
} catch (Exception $e) {
echo json_encode(['error' => $e->getMessage()]);
}

function calculatePointAdjustment($oldStatus, $newStatus) {
	if ($oldStatus === $newStatus) return 0;
	if ($oldStatus === 'non-motivated' && $newStatus !== 'non-motivated') {
		return 1;  // Give back the point
	} elseif ($oldStatus !== 'non-motivated' && $newStatus === 'non-motivated') {
		return -1; // Take away a point
	}
	return 0;  // No point adjustment for other status changes
}

function getUserOrganizations($userId) {
		global $pdo;
		try {
				$stmt = $pdo->prepare("SELECT organization_id, role FROM user_organizations WHERE user_id = ?");
				$stmt->execute([$userId]);
				return $stmt->fetchAll(PDO::FETCH_ASSOC);
		} catch (PDOException $e) {
				// Log or handle the error as needed
				error_log("Error fetching user organizations: " . $e->getMessage());
				return [];
		}
}

// function getCurrentOrganizationId() {
//     // Ensure session is started
//     if (session_status() == PHP_SESSION_NONE) {
//         session_start();
//     }

//     // Retrieve headers correctly
//     $headers = getallheaders();
//     $token = null;

//     if (isset($headers['Authorization'])) {
//         $authHeader = $headers['Authorization'];
//         $token = str_replace('Bearer ', '', $authHeader);
//     }

//     // Check if an organization ID is set in the session
//     if (isset($_SESSION['current_organization_id'])) {
//         return $_SESSION['current_organization_id'];
//     }

//     // Log if no organization ID is found in session
//     error_log("============================================================== No organization ID found in session");

//     // Check if the organization ID is passed as a header or query parameter, default to 1
//     $orgId = $_SERVER['HTTP_X_ORGANIZATION_ID'] ?? $_GET['organization_id'] ?? 1;

//     if ($orgId) {
//         // Validate that the user has access to this organization
//         $userId = getUserIdFromToken($token); // Implement this based on your JWT handling
//         $userOrgs = getUserOrganizations($userId);

//         if (in_array($orgId, array_column($userOrgs, 'organization_id'))) {
//             // Store in session for future requests
//             $_SESSION['current_organization_id'] = $orgId;
//             return $orgId;
//         }
//     }

//     // If no valid organization ID is found, return the first organization the user is part of
//     $userOrgs = getUserOrganizations($userId);
//     if (!empty($userOrgs)) {
//         $orgId = $userOrgs[0]['organization_id'];
//         $_SESSION['current_organization_id'] = $orgId;
//         return $orgId;
//     }

//     // If we get here, the user isn't part of any organization
//     throw new Exception("User is not associated with any organization");
// }
