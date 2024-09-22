<?php
require_once 'config.php';
require_once 'functions.php';
require_once 'jwt_auth.php';
require_once __DIR__ . '/vendor/autoload.php';  // Load Composer dependencies

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

header('Content-Type: application/json');

// Authenticate the user and ensure they have 'admin' role
$payload = requireAuth(['admin']);

// Check if it's a POST request
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
		http_response_code(405);  // Method Not Allowed
		echo json_encode(['error' => 'Invalid request method']);
		exit();
}

// Retrieve the POST data
$data = json_decode(file_get_contents('php://input'), true);
$title = $data['title'] ?? 'No Title';
$body = $data['body'] ?? 'No Body';

if (empty($title) || empty($body)) {
		http_response_code(400);  // Bad Request
		echo json_encode(['error' => 'Title and body are required']);
		exit();
}

// VAPID keys
$vapidPublicKey = 'BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE';
$vapidPrivateKey = getenv('VAPID_PRIVATE');  // Ensure this is set correctly

if (!$vapidPrivateKey) {
		http_response_code(500);
		echo json_encode(['error' => 'VAPID private key is not set']);
		exit();
}

$auth = [
		'VAPID' => [
				'subject' => 'mailto:info@christiansabourin.com',
				'publicKey' => $vapidPublicKey,
				'privateKey' => $vapidPrivateKey,
		],
];

// Create WebPush object
$webPush = new WebPush($auth);

try {
		$pdo = getDbConnection();

		// Fetch all subscribers
		$stmt = $pdo->query("SELECT * FROM subscribers");
		$subscribers = $stmt->fetchAll(PDO::FETCH_ASSOC);

		if (!$subscribers) {
				echo json_encode(['error' => 'No subscribers found']);
				exit();
		}

		// Notification payload
		$notificationPayload = json_encode([
				'title' => $title,
				'body' => $body,
																			 'options' => [
																					 'body' => $body,
																					 'tag' => 'renotify',
																					 'renotify' => true,
																						'requireInteraction'=> true,
																			 ]
		]);
	error_log('Sending payload: ' . $notificationPayload);


		// Send notifications to all subscribers
		foreach ($subscribers as $subscriber) {
				$subscription = Subscription::create([
						'endpoint' => $subscriber['endpoint'],
						'publicKey' => $subscriber['p256dh'],
						'authToken' => $subscriber['auth'],
						'contentEncoding' => 'aesgcm',  // Ensure this is supported by your client
				]);

				// Send the notification
				$webPush->sendOneNotification($subscription, $notificationPayload);
		}

		// Flush notifications to send them
		foreach ($webPush->flush() as $report) {
				$endpoint = $report->getRequest()->getUri()->__toString();
				if ($report->isSuccess()) {
						error_log("[v] Message sent successfully for subscription {$endpoint}.");
				} else {
						error_log("[x] Message failed for subscription {$endpoint}: {$report->getReason()}");
				}
		}

		// Return success response
		echo json_encode(['success' => true]);
} catch (Exception $e) {
		http_response_code(500);
		error_log('Error sending notification: ' . $e->getMessage());
		echo json_encode(['error' => $e->getMessage()]);
}
