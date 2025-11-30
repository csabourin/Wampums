require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 3000;

// Compression middleware (install with: npm install compression)
let compression;
try {
  compression = require('compression');
  app.use(compression());
} catch (e) {
  console.log('Compression not available. Install with: npm install compression');
}

app.use(bodyParser.json());
app.use(helmet({
  contentSecurityPolicy: false // Will be configured properly later
}));
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Determine if we're in production mode
const isProduction = process.env.NODE_ENV === 'production';

// Serve static files
// In production, serve from dist folder (Vite build output)
// In development, serve from root (Vite dev server handles the rest)
const staticDir = isProduction ? path.join(__dirname, 'dist') : __dirname;

console.log(`Serving static files from: ${staticDir}`);
console.log(`Environment: ${isProduction ? 'production' : 'development'}`);

app.use(express.static(staticDir, {
  setHeaders: (res, filepath) => {
    // Aggressive caching for production builds (1 year for hashed files)
    if (isProduction && (filepath.includes('-') && (filepath.endsWith('.js') || filepath.endsWith('.css')))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    // Moderate caching for other assets
    else if (filepath.endsWith('.js') || filepath.endsWith('.css') || filepath.endsWith('.png') || filepath.endsWith('.jpg') || filepath.endsWith('.webp')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Support legacy environment variable name `JWT_SECRET`
// to match the PHP implementation which falls back to this value
// if `JWT_SECRET_KEY` is not defined.
const jwtKey = process.env.JWT_SECRET_KEY ||
               process.env.JWT_SECRET ||
               '1615c2ab-2c71-4b93-8e2e-03f1e6e6e331';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Helper function to get current organization ID from request
async function getCurrentOrganizationId(req) {
  // Try to get from header first
  if (req.headers['x-organization-id']) {
    return parseInt(req.headers['x-organization-id'], 10);
  }

  // Try to get from hostname/domain mapping
  const hostname = req.hostname;

  try {
    const result = await pool.query(
      'SELECT organization_id FROM organization_domains WHERE domain = $1',
      [hostname]
    );

    if (result.rows.length > 0) {
      return result.rows[0].organization_id;
    }
  } catch (error) {
    logger.error('Error getting organization ID:', error);
  }

  // Default to organization ID 1 if not found
  return 1;
}

// Helper function to get user ID from token
function getUserIdFromToken(token) {
  try {
    const decoded = jwt.verify(token, jwtKey);
    return decoded.user_id;
  } catch (e) {
    return null;
  }
}

// Helper function to calculate point adjustment
function calculatePointAdjustment(previousStatus, newStatus) {
  // Implement your point calculation logic here
  const pointValues = {
    'present': 1,
    'absent': 0,
    'late': 0.5
  };
  
  const previousPoints = pointValues[previousStatus] || 0;
  const newPoints = pointValues[newStatus] || 0;
  
  return newPoints - previousPoints;
}

function jsonResponse(res, success, data = null, message = '') {
  res.json({
    success,
    data,
    message,
  });
}

function handleError(err, req, res, next) {
  logger.error(err.stack);
  res.status(500).json({ success: false, error: err.message });
}

function verifyJWT(token) {
  try {
    return jwt.verify(token, jwtKey);
  } catch (e) {
    return null;
  }
}

app.use((err, req, res, next) => {
  handleError(err, req, res, next);
});

// ============================================
// PUBLIC ENDPOINTS (migrated from PHP)
// ============================================

// Serve index.html for root route
app.get('/', (req, res) => {
  const indexPath = isProduction
    ? path.join(__dirname, 'dist', 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

// Get translations (migrated from get_translations.php)
app.get('/api/translations', async (req, res) => {
  try {
    const frPath = path.join(__dirname, 'lang', 'fr.json');
    const enPath = path.join(__dirname, 'lang', 'en.json');

    const [frData, enData] = await Promise.all([
      fs.readFile(frPath, 'utf8'),
      fs.readFile(enPath, 'utf8')
    ]);

    const translations = {
      fr: JSON.parse(frData),
      en: JSON.parse(enData)
    };

    res.json(translations);
  } catch (error) {
    logger.error('Error loading translations:', error);
    res.status(500).json({ error: 'Failed to load translations' });
  }
});

// Get news (migrated from get-news.php)
app.get('/api/news', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    const lang = req.query.lang || 'en';

    const result = await pool.query(
      `SELECT title, content, created_at
       FROM news
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [organizationId]
    );

    const newsItems = result.rows;

    // Return as HTML (to match PHP behavior) or JSON based on accept header
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      res.json({ success: true, data: newsItems });
    } else {
      // Return HTML for backward compatibility
      let html = '';
      if (newsItems.length > 0) {
        html = `<div class="news-accordion" data-latest-timestamp="${newsItems[0].created_at || ''}">
          <div class="news-accordion-header">
            <h2>${lang === 'fr' ? 'Dernières nouvelles' : 'Latest News'}</h2>
          </div>
          <div class="news-accordion-content">`;

        newsItems.forEach(news => {
          const date = new Date(news.created_at);
          const formattedDate = date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          html += `<div class="news-item">
            <h3>${escapeHtml(news.title)}</h3>
            <p>${escapeHtml(news.content).replace(/\n/g, '<br>')}</p>
            <small>${formattedDate}</small>
          </div>`;
        });

        html += `</div></div>`;
      }
      res.send(html);
    }
  } catch (error) {
    logger.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Get organization JWT (migrated from get-organization-jwt.php)
app.get('/api/organization-jwt', async (req, res) => {
  try {
    const organizationId = req.query.organization_id
      ? parseInt(req.query.organization_id, 10)
      : await getCurrentOrganizationId(req);

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID is required'
      });
    }

    // Generate JWT with organization ID only (no user information)
    const token = jwt.sign(
      { organizationId },
      jwtKey,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      organizationId
    });
  } catch (error) {
    logger.error('Error generating organization JWT:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate JWT token'
    });
  }
});

// Get points data (migrated from get_points_data.php)
app.get('/api/points-data', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);

    // Fetch all groups with total points
    const groupsResult = await pool.query(
      `SELECT g.id, g.name, COALESCE(SUM(p.value), 0) AS total_points
       FROM groups g
       LEFT JOIN points p ON g.id = p.group_id AND p.organization_id = $1
       WHERE g.organization_id = $1
       GROUP BY g.id, g.name
       ORDER BY g.name`,
      [organizationId]
    );

    // Fetch all participants with their associated group and total points
    const participantsResult = await pool.query(
      `SELECT part.id, part.first_name, pg.group_id, COALESCE(SUM(p.value), 0) AS total_points
       FROM participants part
       JOIN participant_organizations po ON part.id = po.participant_id
       LEFT JOIN participant_groups pg ON part.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN points p ON part.id = p.participant_id AND p.organization_id = $1
       WHERE po.organization_id = $1
       GROUP BY part.id, part.first_name, pg.group_id
       ORDER BY part.first_name`,
      [organizationId]
    );

    res.json({
      success: true,
      groups: groupsResult.rows,
      names: participantsResult.rows
    });
  } catch (error) {
    logger.error('Error fetching points data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Initial data endpoint (migrated from initial-data.php)
app.get('/api/initial-data', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    const token = req.headers.authorization?.split(' ')[1];

    let isLoggedIn = false;
    let userRole = null;
    let userId = null;
    let jwtToken = null;

    // Check if user is logged in via JWT
    if (token) {
      const decoded = verifyJWT(token);
      if (decoded && decoded.user_id) {
        isLoggedIn = true;
        userRole = decoded.user_role;
        userId = decoded.user_id;
        jwtToken = token;
      }
    }

    // If not logged in, generate organization-only JWT
    if (!jwtToken) {
      jwtToken = jwt.sign(
        { organizationId },
        jwtKey,
        { expiresIn: '7d' }
      );
    }

    const initialData = {
      isLoggedIn,
      userRole,
      userId,
      organizationId,
      lang: req.query.lang || 'en'
    };

    // Return as JavaScript module
    res.type('application/javascript');
    res.send(`
window.initialData = ${JSON.stringify(initialData)};

// Store the JWT in localStorage for use by the frontend
const jwtToken = "${jwtToken}";
localStorage.setItem("jwtToken", jwtToken);

// Store organization ID as well
const organizationId = ${organizationId};
localStorage.setItem("organizationId", organizationId);

document.addEventListener("DOMContentLoaded", function() {
  let newsWidget = document.getElementById("news-widget");
  if (!newsWidget) return;

  // Lazy load the news widget
  fetch('/api/news?lang=' + (window.initialData.lang || 'en'))
    .then(response => response.text())
    .then(data => {
      newsWidget.innerHTML = data;

      // Now that the content is loaded, find the accordion
      const accordion = document.querySelector('.news-accordion');
      if (!accordion) return;

      const accordionHeader = accordion.querySelector('.news-accordion-header');

      // Function to toggle accordion
      function toggleAccordion() {
        accordion.classList.toggle('open');
        saveAccordionState();
      }

      // Function to save accordion state
      function saveAccordionState() {
        localStorage.setItem('newsAccordionOpen', accordion.classList.contains('open'));
        localStorage.setItem('lastNewsTimestamp', accordion.dataset.latestTimestamp);
      }

      // Function to load accordion state
      function loadAccordionState() {
        const isOpen = localStorage.getItem('newsAccordionOpen');
        const lastTimestamp = localStorage.getItem('lastNewsTimestamp');
        const latestNewsTimestamp = accordion.dataset.latestTimestamp;

        // Open accordion if no localStorage key exists or if there's new news
        if (isOpen === null || (lastTimestamp && latestNewsTimestamp > lastTimestamp)) {
          accordion.classList.add('open');
        } else if (isOpen === 'true') {
          accordion.classList.add('open');
        }
      }

      // Add click event listener to header
      if (accordionHeader) {
        accordionHeader.addEventListener('click', toggleAccordion);
      }

      // Load initial state
      loadAccordionState();
    })
    .catch(error => {
      console.error('Error loading news widget:', error);
    });
});
    `);
  } catch (error) {
    logger.error('Error generating initial data:', error);
    res.status(500).type('application/javascript').send('console.error("Failed to load initial data");');
  }
});

// Save push notification subscription (migrated from save-subscription.php)
app.post('/api/push-subscription', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const payload = verifyJWT(token);

    if (!payload || !payload.user_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { endpoint, expirationTime, keys } = req.body;
    const { p256dh, auth } = keys || {};

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'Missing subscription data' });
    }

    await pool.query(
      `INSERT INTO subscribers (user_id, endpoint, expiration_time, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
       SET expiration_time = EXCLUDED.expiration_time,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
      [payload.user_id, endpoint, expirationTime, p256dh, auth]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Error saving subscription:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// Send push notification (migrated from send-notification.php)
app.post('/api/send-notification', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const payload = verifyJWT(token);

    // Only admin can send notifications
    if (!payload || payload.user_role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    // Note: Web-push functionality requires additional npm package
    // For now, just save to database or return success
    // Install with: npm install web-push

    try {
      const webpush = require('web-push');

      // VAPID keys
      const vapidPublicKey = 'BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE';
      const vapidPrivateKey = process.env.VAPID_PRIVATE;

      if (!vapidPrivateKey) {
        return res.status(500).json({ error: 'VAPID private key is not set' });
      }

      webpush.setVapidDetails(
        'mailto:info@christiansabourin.com',
        vapidPublicKey,
        vapidPrivateKey
      );

      // Fetch all subscribers
      const subscribersResult = await pool.query('SELECT * FROM subscribers');
      const subscribers = subscribersResult.rows;

      if (subscribers.length === 0) {
        return res.json({ success: true, message: 'No subscribers found' });
      }

      const notificationPayload = JSON.stringify({
        title,
        body,
        options: {
          body,
          tag: 'renotify',
          renotify: true,
          requireInteraction: true
        }
      });

      // Send notifications to all subscribers
      const promises = subscribers.map(subscriber => {
        const pushSubscription = {
          endpoint: subscriber.endpoint,
          keys: {
            p256dh: subscriber.p256dh,
            auth: subscriber.auth
          }
        };

        return webpush.sendNotification(pushSubscription, notificationPayload)
          .catch(error => {
            logger.error(`Failed to send notification to ${subscriber.endpoint}:`, error);
          });
      });

      await Promise.all(promises);

      res.json({ success: true });
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.warn('web-push not installed. Install with: npm install web-push');
        res.json({ success: false, message: 'Web push not configured. Install web-push package.' });
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error('Error sending notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MAIN API ENDPOINT
// ============================================

app.get('/api', [
  check('action').isString().notEmpty(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const action = req.query.action;
  const token = req.headers.authorization?.split(' ')[1];
  const decodedToken = verifyJWT(token);
  const userId = decodedToken?.user_id;

  if (!userId && !['login', 'register', 'request_reset', 'reset_password'].includes(action)) {
    return jsonResponse(res, false, null, 'Invalid or expired token');
  }

  const client = await pool.connect();

  try {
    // Get organization ID once for the entire request
    const organizationId = await getCurrentOrganizationId(req);

    switch (action) {
      case 'get_organization_id':
        jsonResponse(res, true, { organizationId });
        break;

      case 'get_form_types':
        const formTypesResult = await client.query(
          "SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public'",
          [organizationId]
        );
        jsonResponse(res, true, formTypesResult.rows.map(row => row.form_type));
        break;

      case 'get_form_structure':
        const formType = req.query.form_type;
        if (!formType) {
          jsonResponse(res, false, null, 'Form type is required');
        } else {
          const formStructureResult = await client.query(
            "SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
            [formType, organizationId]
          );
          if (formStructureResult.rows.length > 0) {
            jsonResponse(res, true, JSON.parse(formStructureResult.rows[0].form_structure));
          } else {
            jsonResponse(res, false, null, 'Form structure not found');
          }
        }
        break;

      case 'get_form_submissions':
        const formTypeForSubmissions = req.query.form_type;
        const participantId = req.query.participant_id;
        if (!formTypeForSubmissions) {
          jsonResponse(res, false, null, 'Form type is required');
        } else if (participantId) {
          const formSubmissionsResult = await client.query(
            "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
            [participantId, formTypeForSubmissions, organizationId]
          );
          if (formSubmissionsResult.rows.length > 0) {
            jsonResponse(res, true, JSON.parse(formSubmissionsResult.rows[0].submission_data));
          } else {
            jsonResponse(res, false, null, 'No submission data found');
          }
        } else {
          const allFormSubmissionsResult = await client.query(
            "SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name FROM form_submissions fs JOIN participant_organizations po ON fs.participant_id = po.participant_id JOIN participants p ON fs.participant_id = p.id WHERE po.organization_id = $1 AND fs.form_type = $2",
            [organizationId, formTypeForSubmissions]
          );
          jsonResponse(res, true, allFormSubmissionsResult.rows.map(row => ({
            participant_id: row.participant_id,
            first_name: row.first_name,
            last_name: row.last_name,
            submission_data: JSON.parse(row.submission_data),
          })));
        }
        break;

      case 'get_reunion_dates':
        const datesResult = await client.query(
          `SELECT DISTINCT date
           FROM reunion_preparations
           WHERE organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, datesResult.rows.map(row => row.date));
        break;

      case 'create_organization':
        const { name: orgName } = req.body;
        const userIdForOrg = getUserIdFromToken(token);

        try {
          await client.query('BEGIN');

          const newOrgResult = await client.query(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
        [orgName]
          );
          const newOrganizationId = newOrgResult.rows[0].id;

          await client.query(
        `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
         SELECT $1, form_type, form_structure, 'public'
         FROM organization_form_formats
         WHERE organization_id = 0`,
        [newOrganizationId]
          );

          await client.query(
        `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
         VALUES ($1, 'organization_info', $2)`,
        [newOrganizationId, JSON.stringify(req.body)]
          );

          await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role)
         VALUES ($1, $2, 'admin')`,
        [userIdForOrg, newOrganizationId]
          );

          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Organization created successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error; // Re-throw to be caught by outer try-catch
        }
        break;

      case 'update_points':
        const updates = req.body;
        const responses = [];

        try {
          await client.query('BEGIN');

          for (const update of updates) {
            if (update.type === 'group') {
              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES (NULL, $1, $2, $3, $4)`,
                [update.id, update.points, update.timestamp, organizationId]
              );

              const membersResult = await client.query(
                `SELECT p.id
                 FROM participants p
                 JOIN participant_groups pg ON p.id = pg.participant_id
                 WHERE pg.group_id = $1 AND pg.organization_id = $2`,
                [update.id, organizationId]
              );

              for (const member of membersResult.rows) {
                await client.query(
                  `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                   VALUES ($1, NULL, $2, $3, $4)`,
                  [member.id, update.points, update.timestamp, organizationId]
                );
              }

              const groupTotalResult = await client.query(
                `SELECT COALESCE(SUM(value), 0) as total_points
                 FROM points
                 WHERE group_id = $1 AND participant_id IS NULL AND organization_id = $2`,
                [update.id, organizationId]
              );

              responses.push({
                type: 'group',
                id: update.id,
                totalPoints: groupTotalResult.rows[0].total_points,
                memberIds: membersResult.rows.map(row => row.id),
              });
            } else {
              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES ($1, NULL, $2, $3, $4)`,
                [update.id, update.points, update.timestamp, organizationId]
              );

              const individualTotalResult = await client.query(
                `SELECT COALESCE(SUM(value), 0) as total_points
                 FROM points
                 WHERE participant_id = $1 AND organization_id = $2`,
                [update.id, organizationId]
              );

              responses.push({
                type: 'individual',
                id: update.id,
                totalPoints: individualTotalResult.rows[0].total_points,
              });
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, responses);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error; // Re-throw to be caught by outer try-catch
        }
        break;

      case 'get_acceptation_risque':
        const participantIdForRisque = req.query.participant_id;
        if (participantIdForRisque) {
          const acceptationRisqueResult = await client.query(
            `SELECT * FROM acceptation_risque WHERE participant_id = $1`,
            [participantIdForRisque]
          );
          if (acceptationRisqueResult.rows.length > 0) {
            jsonResponse(res, true, acceptationRisqueResult.rows[0]);
          } else {
            jsonResponse(res, false, null, 'Acceptation risque not found');
          }
        } else {
          jsonResponse(res, false, null, 'Invalid participant ID');
        }
        break;

      case 'save_acceptation_risque':
        const {
          participant_id,
          groupe_district,
          accepte_risques,
          accepte_covid19,
          participation_volontaire,
          declaration_sante,
          declaration_voyage,
          nom_parent_tuteur,
          date_signature,
        } = req.body;

        const saveAcceptationRisqueResult = await client.query(
          `INSERT INTO acceptation_risque 
           (participant_id, groupe_district, accepte_risques, accepte_covid19, 
            participation_volontaire, declaration_sante, declaration_voyage, 
            nom_parent_tuteur, date_signature) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           ON CONFLICT (participant_id) DO UPDATE SET 
           groupe_district = EXCLUDED.groupe_district, 
           accepte_risques = EXCLUDED.accepte_risques, 
           accepte_covid19 = EXCLUDED.accepte_covid19, 
           participation_volontaire = EXCLUDED.participation_volontaire, 
           declaration_sante = EXCLUDED.declaration_sante, 
           declaration_voyage = EXCLUDED.declaration_voyage, 
           nom_parent_tuteur = EXCLUDED.nom_parent_tuteur, 
           date_signature = EXCLUDED.date_signature`,
          [
            participant_id,
            groupe_district,
            accepte_risques,
            accepte_covid19,
            participation_volontaire,
            declaration_sante,
            declaration_voyage,
            nom_parent_tuteur,
            date_signature,
          ]
        );

        if (saveAcceptationRisqueResult.rowCount > 0) {
          jsonResponse(res, true, null, 'Acceptation risque saved successfully');
        } else {
          jsonResponse(res, false, null, 'Failed to save acceptation risque');
        }
        break;

      case 'get_guardians':
        const participantIdForGuardians = req.query.participant_id;
        if (participantIdForGuardians) {
          const guardianInfoResult = await client.query(
            "SELECT guardian_id, lien FROM participant_guardians WHERE participant_id = $1",
            [participantIdForGuardians]
          );
          const guardianInfo = guardianInfoResult.rows;

          if (guardianInfo.length > 0) {
            const guardianIds = guardianInfo.map(row => row.guardian_id);
            const lienInfo = guardianInfo.reduce((acc, row) => {
              acc[row.guardian_id] = row.lien;
              return acc;
            }, {});

            const guardianDetailsResult = await client.query(
              `SELECT id, nom, prenom, courriel, telephone_residence, telephone_travail, 
                      telephone_cellulaire, is_primary, is_emergency_contact
               FROM parents_guardians
               WHERE id = ANY($1::int[])`,
              [guardianIds]
            );
            const guardians = guardianDetailsResult.rows;

            const customFormFormatResult = await client.query(
              "SELECT form_structure FROM organization_form_formats WHERE form_type = 'parent_guardian' AND organization_id = $1",
              [organizationId]
            );
            const customFormFormat = customFormFormatResult.rows[0]?.form_structure;

            const mergedData = guardians.map(guardian => ({
              ...guardian,
              lien: lienInfo[guardian.id],
              custom_form: customFormFormat ? JSON.parse(customFormFormat) : null,
            }));

            jsonResponse(res, true, mergedData);
          } else {
            jsonResponse(res, false, null, 'No guardians found for this participant.');
          }
        } else {
          jsonResponse(res, false, null, 'Missing participant_id parameter.');
        }
        break;

      case 'participant-age':
        const participantsResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name, p.date_naissance, 
                  EXTRACT(YEAR FROM AGE(p.date_naissance)) AS age
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE po.organization_id = $1
           ORDER BY p.date_naissance ASC, p.last_name`,
          [organizationId]
        );
        jsonResponse(res, true, participantsResult.rows);
        break;

      case 'get_health_report':
        const healthReportResult = await client.query(
          `SELECT p.id as participant_id, p.first_name, p.last_name,
                  fs.submission_data->>'epipen' AS epipen,
                  fs.submission_data->>'allergie' AS allergies,
                  fs.submission_data->>'probleme_sante' AS health_issues,
                  fs.submission_data->>'niveau_natation' AS swimming_level,
                  fs.submission_data->>'blessures_operations' AS injuries,
                  fs2.submission_data->>'peut_partir_seul' AS leave_alone,
                  fs2.submission_data->>'consentement_photos_videos' AS media_consent
           FROM participants p
           JOIN form_submissions fs ON fs.participant_id = p.id AND fs.form_type = 'fiche_sante'
           JOIN form_submissions fs2 ON fs2.participant_id = p.id AND fs2.form_type = 'participant_registration'
           JOIN participant_organizations po ON po.participant_id = p.id
           WHERE po.organization_id = $1`,
          [organizationId]
        );
        jsonResponse(res, true, healthReportResult.rows);
        break;

      case 'get_mailing_list':
        const usersEmailsResult = await client.query(
          `SELECT u.email, uo.role 
           FROM user_organizations uo
           JOIN users u ON u.id = uo.user_id
           WHERE uo.organization_id = $1
           AND u.email IS NOT NULL 
           AND u.email != ''`,
          [organizationId]
        );
        const usersEmails = usersEmailsResult.rows;

        const emailsByRole = usersEmails.reduce((acc, user) => {
          const role = user.role;
          const email = user.email.toLowerCase();
          if (!acc[role]) {
            acc[role] = [];
          }
          acc[role].push(email);
          return acc;
        }, {});

        const parentEmailsResult = await client.query(
          `SELECT LOWER(fs.submission_data->>'guardian_courriel_0') AS courriel, 
                  string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
           FROM form_submissions fs
           JOIN participants p ON fs.participant_id = p.id
           WHERE (fs.submission_data->>'guardian_courriel_0') IS NOT NULL 
           AND (fs.submission_data->>'guardian_courriel_0') != ''
           AND fs.organization_id = $1
           GROUP BY fs.submission_data->>'guardian_courriel_0'
           UNION
           SELECT LOWER(fs.submission_data->>'guardian_courriel_1') AS courriel, 
                  string_agg(p.first_name || ' ' || p.last_name, ', ') AS participants
           FROM form_submissions fs
           JOIN participants p ON fs.participant_id = p.id
           WHERE (fs.submission_data->>'guardian_courriel_1') IS NOT NULL 
           AND (fs.submission_data->>'guardian_courriel_1') != ''
           AND fs.organization_id = $1
           GROUP BY fs.submission_data->>'guardian_courriel_1'`,
          [organizationId]
        );
        const parentEmails = parentEmailsResult.rows;

        emailsByRole['parent'] = parentEmails.map(parent => ({
          email: parent.courriel,
          participants: parent.participants,
        }));

        const participantEmailsResult = await client.query(
          `SELECT LOWER(fs.submission_data->>'courriel') AS courriel
           FROM form_submissions fs
           WHERE (fs.submission_data->>'courriel') IS NOT NULL 
           AND (fs.submission_data->>'courriel') != ''
           AND fs.organization_id = $1`,
          [organizationId]
        );
        const participantEmails = participantEmailsResult.rows.map(row => row.courriel);

        const allEmails = [
          ...new Set([
            ...Object.values(emailsByRole).flat().map(item => typeof item === 'string' ? item : item.email),
            ...participantEmails,
          ]),
        ];

        jsonResponse(res, true, {
          emails_by_role: emailsByRole,
          participant_emails: participantEmails,
          unique_emails: allEmails,
        });
        break;

      case 'get_organization_form_formats':
        const orgIdForFormats = req.query.organization_id || organizationId;
        const formFormatsResult = await client.query(
          `SELECT form_type, form_structure 
           FROM organization_form_formats 
           WHERE organization_id = $1`,
          [orgIdForFormats]
        );
        const formFormats = formFormatsResult.rows.reduce((acc, form) => {
          acc[form.form_type] = JSON.parse(form.form_structure);
          return acc;
        }, {});
        jsonResponse(res, true, formFormats);
        break;

      case 'get_activites_rencontre':
        const activitesResult = await client.query(
          "SELECT * FROM activites_rencontre ORDER BY activity"
        );
        jsonResponse(res, true, activitesResult.rows);
        break;

      case 'get_animateurs':
        const animateursResult = await client.query(
          `SELECT u.id, u.full_name 
           FROM users u
           JOIN user_organizations uo ON u.id = uo.user_id
           WHERE uo.organization_id = $1 
           AND uo.role IN ('animation')
           ORDER BY u.full_name`,
          [organizationId]
        );
        jsonResponse(res, true, animateursResult.rows);
        break;

      case 'get_recent_honors':
        const recentHonorsResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name 
           FROM participants p 
           JOIN honors h ON p.id = h.participant_id 
           WHERE h.date = (SELECT MAX(h2.date) FROM honors h2 WHERE h2.organization_id = $1) 
           AND h.organization_id = $1
           ORDER BY h.date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, recentHonorsResult.rows);
        break;

      case 'save_reminder':
        const { reminder_date, is_recurring, reminder_text } = req.body;
        await client.query(
          `INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text) 
           VALUES ($1, $2, $3, $4)`,
          [getCurrentOrganizationId(), reminder_date, is_recurring, reminder_text]
        );
        jsonResponse(res, true, null, 'Reminder saved successfully');
        break;

      case 'get_reminder':
        const reminderResult = await client.query(
          `SELECT * FROM rappel_reunion 
           WHERE organization_id = $1 
           ORDER BY creation_time DESC LIMIT 1`,
          [organizationId]
        );
        if (reminderResult.rows.length > 0) {
          jsonResponse(res, true, reminderResult.rows[0]);
        } else {
          jsonResponse(res, false, null, 'No reminder found');
        }
        break;

      case 'save_reunion_preparation':
        const { date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes } = req.body;
        await client.query(
          `INSERT INTO reunion_preparations (organization_id, date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, date) DO UPDATE SET
           animateur_responsable = EXCLUDED.animateur_responsable,
           louveteau_dhonneur = EXCLUDED.louveteau_dhonneur,
           endroit = EXCLUDED.endroit,
           activities = EXCLUDED.activities,
           notes = EXCLUDED.notes,
           updated_at = CURRENT_TIMESTAMP`,
          [getCurrentOrganizationId(), date, animateur_responsable, JSON.stringify(louveteau_dhonneur), endroit, JSON.stringify(activities), notes]
        );
        jsonResponse(res, true, null, 'Reunion preparation saved successfully');
        break;

      case 'get_reunion_preparation':
        const reunionDate = req.query.date || new Date().toISOString().split('T')[0];
        const reunionPreparationResult = await client.query(
          `SELECT * FROM reunion_preparations
           WHERE organization_id = $1 AND date = $2`,
          [getCurrentOrganizationId(), reunionDate]
        );
        if (reunionPreparationResult.rows.length > 0) {
          const preparation = reunionPreparationResult.rows[0];
          preparation.louveteau_dhonneur = JSON.parse(preparation.louveteau_dhonneur);
          preparation.activities = JSON.parse(preparation.activities);
          jsonResponse(res, true, preparation);
        } else {
          jsonResponse(res, false, null, 'No reunion preparation found for this date');
        }
        break;

      case 'get_organization_settings':
        const settingsResult = await client.query(
          `SELECT setting_key, setting_value 
           FROM organization_settings 
           WHERE organization_id = $1`,
          [organizationId]
        );
        const settings = settingsResult.rows.reduce((acc, setting) => {
          const decodedValue = JSON.parse(setting.setting_value);
          acc[setting.setting_key] = decodedValue !== null ? decodedValue : setting.setting_value;
          return acc;
        }, {});
        jsonResponse(res, true, settings);
        break;

      case 'register_for_organization':
        const { registration_password, role, link_children } = req.body;
        const correctPasswordResult = await client.query(
          `SELECT setting_value 
           FROM organization_settings 
           WHERE setting_key = 'registration_password' 
           AND organization_id = $1`,
          [organizationId]
        );
        const correctPassword = correctPasswordResult.rows[0]?.setting_value;

        if (registration_password !== correctPassword) {
          jsonResponse(res, false, null, 'Invalid registration password');
        } else {
          await client.query(
            `INSERT INTO user_organizations (user_id, organization_id, role) 
             VALUES ($1, $2, $3)`,
            [userId, getCurrentOrganizationId(), role]
          );

          if (link_children && link_children.length > 0) {
            // Fixed SQL syntax - using PostgreSQL syntax instead of MySQL
            const linkChildrenQuery = `
              INSERT INTO participant_organizations (participant_id, organization_id) 
              VALUES ${link_children.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}
            `;
            const linkChildrenValues = link_children.flatMap(childId => [childId, organizationId]);
            await client.query(linkChildrenQuery, linkChildrenValues);
          }

          jsonResponse(res, true, null, 'Successfully registered for organization');
        }
        break;

      case 'get_user_children':
        const userChildrenResult = await client.query(
          `SELECT p.id, p.first_name, p.last_name 
           FROM participants p 
           JOIN user_participants up ON p.id = up.participant_id 
           WHERE up.user_id = $1`,
          [userId]
        );
        jsonResponse(res, true, userChildrenResult.rows);
        break;

      case 'get_calendars':
        const calendarsResult = await client.query(
          `SELECT p.id AS participant_id, p.first_name, p.last_name, 
                  COALESCE(c.amount, 0) AS calendar_amount, 
                  COALESCE(c.amount_paid, 0) AS amount_paid, 
                  COALESCE(c.paid, FALSE) AS paid, 
                  c.updated_at
           FROM participants p
           LEFT JOIN calendars c ON p.id = c.participant_id AND c.organization_id = $1
           LEFT JOIN participant_organizations po ON po.participant_id = p.id AND po.organization_id = $1
           WHERE po.organization_id = $1
           OR p.id IN (SELECT participant_id FROM calendars WHERE organization_id = $1)
           ORDER BY p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, calendarsResult.rows);
        break;

      case 'update_calendar':
        const { participant_id: participantIdCal, amount, amount_paid } = req.body;
        await client.query(
          `INSERT INTO calendars (participant_id, amount, amount_paid, paid, organization_id)
           VALUES ($1, $2, $3, FALSE, $4)
           ON CONFLICT (participant_id, organization_id) 
           DO UPDATE SET amount = EXCLUDED.amount, amount_paid = EXCLUDED.amount_paid, updated_at = CURRENT_TIMESTAMP`,
          [participantIdCal, amount, amount_paid || 0, organizationId]
        );
        jsonResponse(res, true, null, 'Calendar updated successfully');
        break;

      case 'update_calendar_amount_paid':
        const { participant_id: participantIdAmountPaid, amount_paid: amountPaidUpdate } = req.body;
        await client.query(
          `UPDATE calendars
           SET amount_paid = $1, updated_at = CURRENT_TIMESTAMP
           WHERE participant_id = $2 AND organization_id = $3`,
          [amountPaidUpdate, participantIdAmountPaid, organizationId]
        );
        jsonResponse(res, true, null, 'Calendar amount paid updated successfully');
        break;

      case 'save_guest':
        const { name, email, attendance_date } = req.body;
        await client.query(
          `INSERT INTO guests (name, email, attendance_date, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [name, email, attendance_date, organizationId]
        );
        jsonResponse(res, true, null, 'Guest added successfully');
        break;

      case 'get_guests_by_date':
        const dateForGuests = req.query.date || new Date().toISOString().split('T')[0];
        const guestsResult = await client.query(
          `SELECT * FROM guests WHERE attendance_date = $1 AND organization_id = $2`,
          [dateForGuests, organizationId]
        );
        jsonResponse(res, true, guestsResult.rows);
        break;

      case 'get_attendance':
        const dateForAttendance = req.query.date || new Date().toISOString().split('T')[0];
        const orgIdForAttendance = getCurrentOrganizationId();
        const attendanceResult = await client.query(
          `SELECT a.participant_id, a.status
           FROM attendance a
           JOIN participants p ON a.participant_id = p.id
           JOIN participant_organizations po ON po.participant_id = p.id
           WHERE a.date = $1 AND po.organization_id = $2`,
          [dateForAttendance, orgIdForAttendance]
        );
        jsonResponse(res, true, attendanceResult.rows);
        break;

      case 'get_attendance_dates':
        const attendanceDatesResult = await client.query(
          `SELECT DISTINCT date 
           FROM attendance 
           WHERE date <= CURRENT_DATE AND organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, attendanceDatesResult.rows.map(row => row.date));
        break;

      case 'getAvailableDates':
        const availableDatesResult = await client.query(
          `SELECT DISTINCT date::date AS date 
           FROM honors 
           WHERE organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, availableDatesResult.rows.map(row => row.date));
        break;

      case 'remove_group':
        const { group_id } = req.body;
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE participants 
             SET group_id = NULL 
             WHERE group_id = $1`,
            [group_id]
          );
          await client.query(
            `DELETE FROM groups 
             WHERE id = $1 AND organization_id = $2`,
            [group_id, organizationId]
          );
          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Group removed successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'add_group':
        const { group_name } = req.body;
        const orgIdForGroup = getCurrentOrganizationId();
        await client.query(
          `INSERT INTO groups (name, organization_id) 
           VALUES ($1, $2)`,
          [group_name, orgIdForGroup]
        );
        jsonResponse(res, true, null, 'Group added successfully');
        break;

      case 'get_health_contact_report':
        const healthContactReportResult = await client.query(
          `SELECT 
            p.id AS participant_id,
            p.first_name,
            p.last_name,
            p.date_naissance,
            g.name AS group_name,
            fs.*
          FROM participants p
          JOIN participant_organizations po ON p.id = po.participant_id
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = po.organization_id
          LEFT JOIN groups g ON pg.group_id = g.id
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
          WHERE po.organization_id = $1
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, healthContactReportResult.rows);
        break;

      case 'get_attendance_report':
        const endDate = req.query.end_date || new Date().toISOString().split('T')[0];
        const startDate = req.query.start_date || new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];

        const totalDaysResult = await client.query(
          `SELECT COUNT(DISTINCT date) as total_days
           FROM attendance
           WHERE date BETWEEN $1 AND $2
           AND organization_id = $3`,
          [startDate, endDate, organizationId]
        );
        const totalDays = totalDaysResult.rows[0].total_days;

        const attendanceDataResult = await client.query(
          `WITH attendance_days AS (
            SELECT DISTINCT date
            FROM attendance
            WHERE date BETWEEN $1 AND $2
            AND organization_id = $3
          ),
          attendance_data AS (
            SELECT 
              p.id, 
              p.first_name, 
              p.last_name, 
              g.name AS group_name,
              a.date,
              a.status
            FROM participants p
            INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
            INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
            LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $3
            WHERE a.date BETWEEN $1 AND $2
          )
          SELECT 
            p.id,
            p.first_name, 
            p.last_name, 
            g.name AS group_name,
            json_agg(json_build_object('date', a.date, 'status', a.status)) AS attendance
          FROM participants p
          INNER JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $3
          INNER JOIN groups g ON pg.group_id = g.id AND g.organization_id = $3
          LEFT JOIN attendance_data a ON p.id = a.id
          GROUP BY p.id, p.first_name, p.last_name, g.name
          ORDER BY g.name, p.last_name, p.first_name`,
          [startDate, endDate, organizationId]
        );

        jsonResponse(res, true, {
          start_date: startDate,
          end_date: endDate,
          total_days: totalDays,
          attendance_data: attendanceDataResult.rows,
        });
        break;

      case 'get_allergies_report':
        const allergiesReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            fs.submission_data->>'allergie' AS allergies,
            (fs.submission_data->>'epipen')::boolean AS epipen
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          AND (fs.submission_data->>'allergie' IS NOT NULL AND fs.submission_data->>'allergie' != '')
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, allergiesReportResult.rows);
        break;

      case 'get_medication_report':
        const medicationReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            fs.submission_data->>'medicament' AS medication
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1 
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          AND (fs.submission_data->>'medicament' IS NOT NULL AND fs.submission_data->>'medicament' != '')
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, medicationReportResult.rows);
        break;

      case 'get_vaccine_report':
        const vaccineReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'vaccins_a_jour')::boolean AS vaccines_up_to_date
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'fiche_sante'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, vaccineReportResult.rows);
        break;

      case 'get_leave_alone_report':
        const leaveAloneReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'peut_partir_seul')::boolean AS can_leave_alone
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'participant_registration'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, leaveAloneReportResult.rows);
        break;

      case 'get_media_authorization_report':
        const mediaAuthorizationReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            (fs.submission_data->>'consentement_photos_videos')::boolean AS media_authorized
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE fs.form_type = 'participant_registration'
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, mediaAuthorizationReportResult.rows);
        break;

      case 'get_missing_documents_report':
        const missingDocumentsReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            CASE WHEN fs_fiche.id IS NULL THEN 'Fiche Santé' ELSE NULL END AS missing_fiche_sante,
            CASE WHEN fs_risque.id IS NULL THEN 'Acceptation Risque' ELSE NULL END AS missing_acceptation_risque
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN form_submissions fs_fiche ON p.id = fs_fiche.participant_id AND fs_fiche.form_type = 'fiche_sante' AND fs_fiche.organization_id = $1
          LEFT JOIN form_submissions fs_risque ON p.id = fs_risque.participant_id AND fs_risque.form_type = 'acceptation_risque' AND fs_risque.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          WHERE (fs_fiche.id IS NULL OR fs_risque.id IS NULL)
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        const missingDocuments = missingDocumentsReportResult.rows.map(row => ({
          ...row,
          missing_documents: [row.missing_fiche_sante, row.missing_acceptation_risque].filter(Boolean),
        }));
        jsonResponse(res, true, missingDocuments);
        break;

      case 'get_honors_report':
        const honorsReportResult = await client.query(
          `SELECT 
            p.first_name || ' ' || p.last_name AS name,
            g.name AS group_name,
            COUNT(h.id) AS honors_count
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN honors h ON p.id = h.participant_id AND h.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          GROUP BY p.id, g.name
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        jsonResponse(res, true, honorsReportResult.rows);
        break;

      case 'get_points_report':
        const pointsReportResult = await client.query(
          `SELECT 
            g.name AS group_name,
            p.first_name || ' ' || p.last_name AS name,
            COALESCE(SUM(pt.value), 0) AS points
          FROM participants p
          LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
          LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = $1
          LEFT JOIN points pt ON p.id = pt.participant_id AND pt.organization_id = $1
          JOIN participant_organizations po ON po.organization_id = $1 AND po.participant_id = p.id
          GROUP BY g.id, p.id
          ORDER BY g.name, p.last_name, p.first_name`,
          [organizationId]
        );
        const groupedPoints = pointsReportResult.rows.reduce((acc, row) => {
          if (!acc[row.group_name]) {
            acc[row.group_name] = [];
          }
          acc[row.group_name].push({ name: row.name, points: row.points });
          return acc;
        }, {});
        jsonResponse(res, true, groupedPoints);
        break;

      case 'logout':
        // Session handling would depend on your session middleware
        // If using express-session: req.session = null;
        jsonResponse(res, true, null, 'Logged out successfully');
        break;

      case 'get_groups':
        const orgIdForGroups = getCurrentOrganizationId();
        const groupsResult = await client.query(
          `SELECT 
            g.id,
            g.name,
            COALESCE(SUM(pt.value), 0) AS total_points
           FROM groups g
           LEFT JOIN points pt ON pt.group_id = g.id AND pt.organization_id = $1
           WHERE g.organization_id = $1
           GROUP BY g.id, g.name
           ORDER BY g.name`,
          [orgIdForGroups]
        );
        jsonResponse(res, true, groupsResult.rows);
        break;

      case 'update_attendance':
        const { participant_id: participantIdAttendance, status, date: dateAttendance } = req.body;
        const orgIdForAttendanceUpdate = getCurrentOrganizationId();
        const participantIds = Array.isArray(participantIdAttendance) ? participantIdAttendance : [participantIdAttendance];

        try {
          await client.query('BEGIN');

          for (const participantId of participantIds) {
            const previousStatusResult = await client.query(
              `SELECT status 
               FROM attendance 
               WHERE participant_id = $1 AND date = $2 AND organization_id = $3`,
              [participantId, dateAttendance, orgIdForAttendanceUpdate]
            );
            const previousStatus = previousStatusResult.rows[0]?.status || 'none';

            await client.query(
              `INSERT INTO attendance (participant_id, date, status, organization_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (participant_id, date, organization_id) 
               DO UPDATE SET status = EXCLUDED.status`,
              [participantId, dateAttendance, status, orgIdForAttendanceUpdate]
            );

            const pointAdjustment = calculatePointAdjustment(previousStatus, status);
            if (pointAdjustment !== 0) {
              await client.query(
                `INSERT INTO points (participant_id, value, created_at, organization_id)
                 VALUES ($1, $2, $3, $4)`,
                [participantId, pointAdjustment, dateAttendance, orgIdForAttendanceUpdate]
              );
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, null, 'Attendance updated successfully');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'get_honors':
        const dateForHonors = req.query.date || new Date().toISOString().split('T')[0];
        const academicYearStart = new Date().getMonth() >= 8 ? `${new Date().getFullYear()}-09-01` : `${new Date().getFullYear() - 1}-09-01`;
        const orgIdForHonors = getCurrentOrganizationId();

        const participantsForHonorsResult = await client.query(
          `SELECT 
            p.id AS participant_id, 
            p.first_name, 
            p.last_name, 
            pg.group_id, 
            COALESCE(g.name, 'no_group') AS group_name
           FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = po.organization_id
           LEFT JOIN groups g ON pg.group_id = g.id AND g.organization_id = po.organization_id
           WHERE po.organization_id = $1
           ORDER BY g.name, p.last_name, p.first_name`,
          [orgIdForHonors]
        );

        const honorsForDateResult = await client.query(
          `SELECT 
            participant_id, 
            date
           FROM honors
           WHERE date >= $1 AND date <= $2 AND organization_id = $3`,
          [academicYearStart, dateForHonors, orgIdForHonors]
        );

        const availableDatesForHonorsResult = await client.query(
          `SELECT DISTINCT 
            date
           FROM honors
           WHERE organization_id = $1 AND date >= $2 AND date <= CURRENT_DATE
           ORDER BY date DESC`,
          [orgIdForHonors, academicYearStart]
        );

        jsonResponse(res, true, {
          participants: participantsForHonorsResult.rows,
          honors: honorsForDateResult.rows,
          availableDates: availableDatesForHonorsResult.rows.map(row => row.date),
        });
        break;

      case 'award_honor':
        const honors = req.body;
        const orgIdForAwardHonor = getCurrentOrganizationId();

        try {
          await client.query('BEGIN');

          const awards = [];
          for (const honor of honors) {
            const { participantId, date } = honor;

            const honorResult = await client.query(
              `INSERT INTO honors (participant_id, date, organization_id)
               VALUES ($1, $2, $3)
               ON CONFLICT (participant_id, date, organization_id) DO NOTHING
               RETURNING id`,
              [participantId, date, orgIdForAwardHonor]
            );

            if (honorResult.rows.length > 0) {
              await client.query(
                `INSERT INTO points (participant_id, value, created_at, organization_id)
                 VALUES ($1, 5, $2, $3)`,
                [participantId, date, orgIdForAwardHonor]
              );
              awards.push({ participantId, awarded: true });
            } else {
              awards.push({ participantId, awarded: false, message: 'Honor already awarded for this date' });
            }
          }

          await client.query('COMMIT');
          jsonResponse(res, true, awards);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        break;

      case 'get_badge_progress':
        const participantIdForBadge = req.query.participant_id;

        if (participantIdForBadge) {
          const badgeProgressResult = await client.query(
            `SELECT * FROM badge_progress WHERE participant_id = $1 AND organization_id = $2`,
            [participantIdForBadge, organizationId]
          );
          jsonResponse(res, true, badgeProgressResult.rows);
        } else {
          jsonResponse(res, false, null, 'Participant ID is required');
        }
        break;

      default:
        jsonResponse(res, false, null, 'Invalid action');
        break;
    }
  } catch (error) {
    logger.error('Database error:', error);
    jsonResponse(res, false, null, 'Internal server error');
  } finally {
    client.release();
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
