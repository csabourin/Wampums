<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

// Get the current organization ID
$organizationId = getCurrentOrganizationId();

// Connect to PostgreSQL using the getDbConnection function from config.php
try {
		$pdo = getDbConnection();

	 // Fetch the latest news for the current organization (limit to 3 latest posts)
		$stmt = $pdo->prepare("
				SELECT title, content, created_at 
				FROM news 
				WHERE organization_id = :organization_id 
				ORDER BY created_at DESC 
				LIMIT 3
		");
		$stmt->execute([':organization_id' => $organizationId]);
		$newsItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
		die("Error fetching news from database: " . $e->getMessage());
}

?>
<div class="news-accordion" data-latest-timestamp="<?php echo $newsItems[0]['created_at'] ?? ''; ?>">
		<div class="news-accordion-header">
				<h2><?php echo translate('latest_news'); ?></h2>
		</div>
		<div class="news-accordion-content">
				<?php if (!empty($newsItems)): ?>
						<?php foreach ($newsItems as $news): ?>
								<div class="news-item">
										<h3><?php echo htmlspecialchars($news['title']); ?></h3>
										<p><?php echo nl2br(htmlspecialchars($news['content'])); ?></p>
										<?php
										// Set the locale for the date formatter based on the language
										$locale = $lang === 'fr' ? 'fr_FR' : 'en_US';

										// Check if the news array is not null and contains a valid created_at value
										if (isset($news['created_at']) && !empty($news['created_at'])) {
												// Create a new DateTime object from the news created_at timestamp
												try {
														$date = new DateTime($news['created_at']);
														// Use IntlDateFormatter for locale-aware date formatting
														$formatter = new IntlDateFormatter($locale, IntlDateFormatter::LONG, IntlDateFormatter::NONE);
														echo '<small>' . $formatter->format($date) . '</small>';
												} catch (Exception $e) {
														echo '<small>' . translate('invalid_date') . '</small>';
												}
										} else {
												// If the date is missing or invalid, display a fallback message
												echo '<small>' . translate('no_date_available') . '</small>';
										}
										?>
								</div>
						<?php endforeach; ?>
				<?php else: ?>
						<p><?php echo translate('no_news'); ?></p>
				<?php endif; ?>
		</div>
</div>