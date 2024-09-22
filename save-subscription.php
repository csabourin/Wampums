<?php
require_once 'config.php';
require_once 'jwt_auth.php';

header('Content-Type: application/json');

// Enable error reporting for debugging (disable in production)
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

try {
		// Authenticate the user using JWT and ensure they are logged in
		$payload = requireAuth(); // You can customize allowed roles if needed

		// Check if the request method is POST
		if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
				http_response_code(405); // Method Not Allowed
				echo json_encode(['error' => 'Invalid request method']);
				exit();
		}

		// Get the POST data
		$input = json_decode(file_get_contents('php://input'), true);

		$endpoint = $input['endpoint'] ?? null;
		$expirationTime = $input['expirationTime'] ?? null;
		$p256dh = $input['keys']['p256dh'] ?? null;
		$auth = $input['keys']['auth'] ?? null;

		// Debug incoming keys
		error_log('p256dh: ' . $p256dh);
		error_log('auth: ' . $auth);

		if (!$endpoint || !$p256dh || !$auth) {
				http_response_code(400); // Bad Request
				error_log('Missing endpoint or keys');
				echo json_encode(['error' => 'Missing subscription data']);
				exit();
		}

		// Log the incoming data for debugging
		error_log('Saving subscription: ' . json_encode($input));

		// Store the subscription in the database
		$pdo = getDbConnection(); // Ensure you have a working PDO connection

		// Prepare the SQL query, including optional keys
		$stmt = $pdo->prepare('
				INSERT INTO subscribers (user_id, endpoint, expiration_time, p256dh, auth)
				VALUES (:user_id, :endpoint, :expiration_time, :p256dh, :auth)
				ON CONFLICT (endpoint) DO UPDATE 
				SET expiration_time = EXCLUDED.expiration_time, 
						p256dh = EXCLUDED.p256dh, 
						auth = EXCLUDED.auth
		');

		// Bind parameters and execute
		if (!$stmt->execute([
				':user_id' => $payload['user_id'], // Extract the user_id from the JWT payload
				':endpoint' => $endpoint,
				':expiration_time' => $expirationTime,
				':p256dh' => $p256dh,
				':auth' => $auth,
		])) {
				// Log SQL errors if execution fails
				$errorInfo = $stmt->errorInfo();
				error_log('SQL Error: ' . json_encode($errorInfo));
				throw new Exception('SQL error occurred.');
		}

		echo json_encode(['success' => true]);
} catch (PDOException $e) {
		http_response_code(500); // Internal Server Error
		error_log('Database error: ' . $e->getMessage());
		echo json_encode(['error' => 'Failed to save subscription.']);
} catch (Exception $e) {
		http_response_code(500); // Internal Server Error
		error_log('General error: ' . $e->getMessage());
		echo json_encode(['error' => 'An error occurred while processing the request.']);
}
