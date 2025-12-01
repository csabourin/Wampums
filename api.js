require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { check, validationResult } = require('express-validator');
const winston = require('winston');
const path = require('path');
const fs = require('fs').promises;
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// Compression middleware
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
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

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
  connectionString: process.env.SB_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

// Helper function to get point system rules from organization settings
async function getPointSystemRules(organizationId, client = null) {
  const queryExecutor = client || pool;
  
  try {
    const result = await queryExecutor.query(
      `SELECT setting_value FROM organization_settings 
       WHERE organization_id = $1 AND setting_key = 'point_system_rules'`,
      [organizationId]
    );
    
    if (result.rows.length > 0) {
      try {
        return JSON.parse(result.rows[0].setting_value);
      } catch (e) {
        console.warn('Error parsing point_system_rules:', e);
      }
    }
  } catch (error) {
    console.error('Error getting point system rules:', error);
  }
  
  // Default rules if not found
  return {
    attendance: {
      present: { label: 'present', points: 1 },
      absent: { label: 'absent', points: 0 },
      late: { label: 'late', points: 0 },
      excused: { label: 'excused', points: 0 }
    },
    honors: { award: 5 },
    badges: { earn: 5, level_up: 10 }
  };
}

// Helper function to calculate attendance point adjustment based on rules
function calculateAttendancePoints(previousStatus, newStatus, rules) {
  const attendanceRules = rules.attendance || {};
  
  const getPreviousPoints = (status) => {
    if (!status) return 0;
    const rule = attendanceRules[status];
    return rule ? (rule.points || 0) : 0;
  };
  
  const previousPoints = getPreviousPoints(previousStatus);
  const newPoints = getPreviousPoints(newStatus);
  
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

// Helper function to verify user belongs to organization with specific role
async function verifyOrganizationMembership(userId, organizationId, requiredRoles = null) {
  try {
    let query = `SELECT role FROM user_organizations 
                 WHERE user_id = $1 AND organization_id = $2`;
    const params = [userId, organizationId];
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return { authorized: false, role: null, message: 'User not a member of this organization' };
    }
    
    const userRole = result.rows[0].role;
    
    if (requiredRoles && !requiredRoles.includes(userRole)) {
      return { authorized: false, role: userRole, message: 'Insufficient permissions' };
    }
    
    return { authorized: true, role: userRole };
  } catch (error) {
    console.error('Error verifying organization membership:', error);
    return { authorized: false, role: null, message: 'Authorization check failed' };
  }
}

app.use((err, req, res, next) => {
  handleError(err, req, res, next);
});

// ============================================
// API DOCUMENTATION (Swagger/OpenAPI)
// ============================================

/**
 * @swagger
 * /:
 *   get:
 *     summary: Serve the main application
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Returns the application HTML
 */
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Wampums API Documentation'
}));

// API documentation JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpecs);
});

console.log('📚 API Documentation available at: /api-docs');

// ============================================
// RESTful API V1 ROUTES
// ============================================

// Mount RESTful routes
const participantsRoutes = require('./routes/participants')(pool);
const attendanceRoutes = require('./routes/attendance')(pool);
const groupsRoutes = require('./routes/groups')(pool);

app.use('/api/v1/participants', participantsRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/groups', groupsRoutes);

console.log('✅ RESTful API v1 routes loaded');
console.log('   - /api/v1/participants');
console.log('   - /api/v1/attendance');
console.log('   - /api/v1/groups');

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

// Login endpoint (migrated from api.php case 'login')
app.post('/public/login', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase();

    const userResult = await pool.query(
      `SELECT u.id, u.email, u.password, u.is_verified, u.full_name, uo.role 
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.email = $1 AND uo.organization_id = $2`,
      [normalizedEmail, organizationId]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Convert PHP $2y$ bcrypt hash to Node.js compatible $2a$ format
    // Both are identical bcrypt algorithms, just different prefixes
    const nodeCompatibleHash = user.password.replace(/^\$2y\$/, '$2a$');
    
    const passwordValid = await bcrypt.compare(password, nodeCompatibleHash);

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        message: 'Your account is not yet verified. Please wait for admin verification.'
      });
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        user_role: user.role,
        organizationId: organizationId
      },
      jwtKey,
      { expiresIn: '7d' }
    );

    const guardianResult = await pool.query(
      `SELECT pg.id, p.id AS participant_id, p.first_name, p.last_name 
       FROM parents_guardians pg
       JOIN participant_guardians pgu ON pg.id = pgu.guardian_id
       JOIN participants p ON pgu.participant_id = p.id
       LEFT JOIN user_participants up ON up.participant_id = p.id AND up.user_id = $1
       WHERE pg.courriel = $2 AND up.participant_id IS NULL`,
      [user.id, normalizedEmail]
    );

    const response = {
      success: true,
      message: 'login_successful',
      token: token,
      user_role: user.role,
      user_full_name: user.full_name,
      user_id: user.id
    };

    if (guardianResult.rows.length > 0) {
      response.guardian_participants = guardianResult.rows;
    }

    res.json(response);
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get organization ID (public endpoint)
app.get('/public/get_organization_id', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    res.json({
      success: true,
      organizationId: organizationId
    });
  } catch (error) {
    logger.error('Error getting organization ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting organization ID'
    });
  }
});

// Get organization settings
app.get('/api/organization-settings', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT setting_key, setting_value 
       FROM organization_settings 
       WHERE organization_id = $1`,
      [organizationId]
    );
    
    // Convert rows to key-value object
    const settings = {};
    result.rows.forEach(row => {
      try {
        settings[row.setting_key] = JSON.parse(row.setting_value);
      } catch {
        settings[row.setting_key] = row.setting_value;
      }
    });
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    logger.error('Error getting organization settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting organization settings'
    });
  }
});

// Get reunion preparation (dedicated endpoint for activity widget)
app.get('/api/reunion-preparation', async (req, res) => {
  try {
    const organizationId = await getCurrentOrganizationId(req);
    const reunionDate = req.query.date || new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT * FROM reunion_preparations
       WHERE organization_id = $1 AND date = $2`,
      [organizationId, reunionDate]
    );
    
    if (result.rows.length > 0) {
      const preparation = result.rows[0];
      // Parse JSON fields
      try {
        preparation.louveteau_dhonneur = JSON.parse(preparation.louveteau_dhonneur || '[]');
        preparation.activities = JSON.parse(preparation.activities || '[]');
      } catch (e) {
        logger.warn('Error parsing reunion preparation JSON fields:', e);
      }
      res.json({
        success: true,
        preparation: preparation
      });
    } else {
      res.json({
        success: false,
        message: 'No reunion preparation found for this date'
      });
    }
  } catch (error) {
    logger.error('Error fetching reunion preparation:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reunion preparation'
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
// DASHBOARD API ENDPOINTS
// ============================================

// Get participants (for dashboard and manage features)
app.get('/api/participants', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
              COALESCE((SELECT SUM(value) FROM points WHERE participant_id = p.id AND organization_id = $1), 0) as total_points
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      data: result.rows,
      participants: result.rows
    });
  } catch (error) {
    logger.error('Error fetching participants:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get groups
app.get('/api/get_groups', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Get groups with their total points (group-level points only, not individual)
    const result = await pool.query(
      `SELECT g.id, g.name, 
              COALESCE(SUM(p.value), 0) as total_points
       FROM groups g
       LEFT JOIN points p ON g.id = p.group_id AND p.organization_id = $1 AND p.participant_id IS NULL
       WHERE g.organization_id = $1
       GROUP BY g.id, g.name
       ORDER BY g.name`,
      [organizationId]
    );
    
    // Convert total_points to integer
    const groups = result.rows.map(g => ({
      ...g,
      total_points: parseInt(g.total_points) || 0
    }));
    
    res.json({
      success: true,
      data: groups,
      groups: groups
    });
  } catch (error) {
    logger.error('Error fetching groups:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get honors and participants (for manage honors)
app.get('/api/honors', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const requestedDate = req.query.date;
    
    // Get participants
    const participantsResult = await pool.query(
      `SELECT p.id as participant_id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE po.organization_id = $1
       ORDER BY g.name, p.first_name`,
      [organizationId]
    );
    
    // Get honors
    const honorsResult = await pool.query(
      `SELECT h.id, h.participant_id, h.date
       FROM honors h
       JOIN participants p ON h.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1
       ORDER BY h.date DESC`,
      [organizationId]
    );
    
    // Get available dates (dates with honors)
    const datesResult = await pool.query(
      `SELECT DISTINCT date FROM honors h
       JOIN participants p ON h.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1
       ORDER BY date DESC`,
      [organizationId]
    );
    
    res.json({
      success: true,
      participants: participantsResult.rows,
      honors: honorsResult.rows,
      availableDates: datesResult.rows.map(r => r.date)
    });
  } catch (error) {
    logger.error('Error fetching honors:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Award honor - accepts single object or array of honors
app.post('/api/award-honor', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Handle both array and single object formats
    const honorsToProcess = Array.isArray(req.body) ? req.body : [req.body];
    
    const results = [];
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get point system rules for this organization
      const pointRules = await getPointSystemRules(organizationId, client);
      const honorPoints = pointRules.honors?.award || 5;
      
      for (const honor of honorsToProcess) {
        // Accept both participantId (camelCase) and participant_id (snake_case)
        const participantId = honor.participantId || honor.participant_id;
        const honorDate = honor.date;
        
        if (!participantId || !honorDate) {
          results.push({ participantId, success: false, message: 'Participant ID and date are required' });
          continue;
        }
        
        // Check if honor already exists for this participant on this date
        const existingResult = await client.query(
          `SELECT id FROM honors WHERE participant_id = $1 AND date = $2 AND organization_id = $3`,
          [participantId, honorDate, organizationId]
        );
        
        if (existingResult.rows.length > 0) {
          // Honor already exists - skip (or could toggle off if needed)
          results.push({ participantId, success: true, action: 'already_awarded' });
        } else {
          // Add new honor with organization_id
          await client.query(
            `INSERT INTO honors (participant_id, date, organization_id) VALUES ($1, $2, $3)`,
            [participantId, honorDate, organizationId]
          );
          
          // Get participant's group for proper point tracking
          const groupResult = await client.query(
            `SELECT group_id FROM participant_groups 
             WHERE participant_id = $1 AND organization_id = $2`,
            [participantId, organizationId]
          );
          const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;
          
          // Add points for the honor based on organization rules
          await client.query(
            `INSERT INTO points (participant_id, group_id, value, created_at, organization_id) 
             VALUES ($1, $2, $3, $4, $5)`,
            [participantId, groupId, honorPoints, honorDate, organizationId]
          );
          
          console.log(`[honor] Participant ${participantId} awarded honor on ${honorDate}, points: +${honorPoints}`);
          results.push({ participantId, success: true, action: 'awarded', points: honorPoints });
        }
      }
      
      await client.query('COMMIT');
      res.json({ success: true, status: 'success', results });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error awarding honor:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get attendance
app.get('/api/attendance', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const requestedDate = req.query.date || new Date().toISOString().split('T')[0];
    
    // Get participants with attendance for the date
    const result = await pool.query(
      `SELECT p.id as participant_id, p.first_name, p.last_name,
              pg.group_id, g.name as group_name,
              a.status as attendance_status, a.date
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN attendance a ON p.id = a.participant_id AND a.date = $2 AND a.organization_id = $1
       WHERE po.organization_id = $1
       ORDER BY g.name, p.first_name`,
      [organizationId, requestedDate]
    );
    
    // Get all available dates
    const datesResult = await pool.query(
      `SELECT DISTINCT date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
      [organizationId]
    );
    
    res.json({
      success: true,
      participants: result.rows,
      currentDate: requestedDate,
      availableDates: datesResult.rows.map(r => r.date)
    });
  } catch (error) {
    logger.error('Error fetching attendance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update attendance
app.post('/api/update-attendance', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const { participant_id, status, date } = req.body;
    
    if (!status || !date) {
      return res.status(400).json({ success: false, message: 'Status and date are required' });
    }
    
    // Handle both single participant_id and array of participant_ids
    const participantIds = Array.isArray(participant_id) ? participant_id : [participant_id];
    
    if (participantIds.length === 0 || participantIds.some(id => !id)) {
      return res.status(400).json({ success: false, message: 'At least one valid participant ID is required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get point system rules for this organization
      const pointRules = await getPointSystemRules(organizationId, client);
      const pointUpdates = [];
      
      // Process attendance and apply points for each participant
      for (const pid of participantIds) {
        // Get existing attendance status for this participant on this date
        const existingResult = await client.query(
          `SELECT status FROM attendance 
           WHERE participant_id = $1 AND organization_id = $2 AND date = $3`,
          [pid, organizationId, date]
        );
        
        const previousStatus = existingResult.rows.length > 0 ? existingResult.rows[0].status : null;
        
        // Upsert attendance record
        await client.query(
          `INSERT INTO attendance (participant_id, organization_id, date, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (participant_id, organization_id, date)
           DO UPDATE SET status = $4`,
          [pid, organizationId, date, status]
        );
        
        // Calculate point adjustment based on status change
        const pointAdjustment = calculateAttendancePoints(previousStatus, status, pointRules);
        
        if (pointAdjustment !== 0) {
          // Get participant's group for proper point tracking
          const groupResult = await client.query(
            `SELECT group_id FROM participant_groups 
             WHERE participant_id = $1 AND organization_id = $2`,
            [pid, organizationId]
          );
          const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;
          
          // Insert point record with reason tracking
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [pid, groupId, organizationId, pointAdjustment, date]
          );
          
          pointUpdates.push({
            participant_id: pid,
            previous_status: previousStatus,
            new_status: status,
            points: pointAdjustment
          });
          
          console.log(`[attendance] Participant ${pid}: ${previousStatus || 'none'} -> ${status}, points: ${pointAdjustment > 0 ? '+' : ''}${pointAdjustment}`);
        }
      }
      
      await client.query('COMMIT');
      res.json({ 
        success: true,
        pointUpdates: pointUpdates 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error updating attendance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update points
app.post('/api/update-points', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const updates = req.body;
    
    console.log('[update-points] Request body:', JSON.stringify(updates));
    console.log('[update-points] Organization ID:', organizationId);
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: 'Updates must be an array' });
    }
    
    const client = await pool.connect();
    const responseUpdates = [];
    
    try {
      await client.query('BEGIN');
      
      for (const update of updates) {
        // Frontend sends: {type, id, points, timestamp}
        // We need to convert to: {participant_id, group_id, value}
        const { type, id, points } = update;
        const value = points;
        
        if (type === 'group') {
          // For group points, add points to the group AND to each individual member
          const groupId = parseInt(id);
          
          // Get all participants in this group (using participant_groups table)
          const membersResult = await client.query(
            `SELECT p.id FROM participants p
             JOIN participant_groups pg ON p.id = pg.participant_id
             WHERE pg.organization_id = $1 AND pg.group_id = $2`,
            [organizationId, groupId]
          );
          
          const memberIds = membersResult.rows.map(r => r.id);
          
          // Insert a point record for the group (group-level tracking)
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value)
             VALUES (NULL, $1, $2, $3)`,
            [groupId, organizationId, value]
          );
          
          // Also insert individual point records for each member of the group
          const memberTotals = [];
          for (const memberId of memberIds) {
            await client.query(
              `INSERT INTO points (participant_id, group_id, organization_id, value)
               VALUES ($1, $2, $3, $4)`,
              [memberId, groupId, organizationId, value]
            );
            
            // Get the new total for this member
            const memberTotalResult = await client.query(
              `SELECT COALESCE(SUM(value), 0) as total FROM points 
               WHERE organization_id = $1 AND participant_id = $2`,
              [organizationId, memberId]
            );
            memberTotals.push({
              id: memberId,
              totalPoints: parseInt(memberTotalResult.rows[0].total)
            });
          }
          
          // Calculate new total for the group (group-level points only)
          const totalResult = await client.query(
            `SELECT COALESCE(SUM(value), 0) as total FROM points 
             WHERE organization_id = $1 AND group_id = $2 AND participant_id IS NULL`,
            [organizationId, groupId]
          );
          
          responseUpdates.push({
            type: 'group',
            id: groupId,
            totalPoints: parseInt(totalResult.rows[0].total),
            memberIds: memberIds,
            memberTotals: memberTotals
          });
        } else {
          // For individual participant points
          const participantId = parseInt(id);

          // Get the participant's group_id and verify they belong to this organization
          const participantResult = await client.query(
            `SELECT pg.group_id
             FROM participants p
             JOIN participant_organizations po ON p.id = po.participant_id
             LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $2
             WHERE p.id = $1 AND po.organization_id = $2`,
            [participantId, organizationId]
          );

          if (participantResult.rows.length === 0) {
            throw new Error(`Participant ${participantId} not found in organization ${organizationId}`);
          }

          const groupId = participantResult.rows[0].group_id || null;
          
          await client.query(
            `INSERT INTO points (participant_id, group_id, organization_id, value)
             VALUES ($1, $2, $3, $4)`,
            [participantId, groupId, organizationId, value]
          );
          
          // Calculate new total for this participant
          const totalResult = await client.query(
            `SELECT COALESCE(SUM(value), 0) as total FROM points 
             WHERE organization_id = $1 AND participant_id = $2`,
            [organizationId, participantId]
          );
          
          responseUpdates.push({
            type: 'participant',
            id: participantId,
            totalPoints: parseInt(totalResult.rows[0].total)
          });
        }
      }
      
      await client.query('COMMIT');
      console.log('[update-points] SUCCESS - Response:', JSON.stringify({ success: true, updates: responseUpdates }));
      res.json({ success: true, updates: responseUpdates });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[update-points] ERROR:', error.message);
    console.error('[update-points] Stack:', error.stack);
    logger.error('Error updating points:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get guests by date (for attendance)
app.get('/api/guests-by-date', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const date = req.query.date || new Date().toISOString().split('T')[0];
    
    // Return empty array if guests table doesn't exist yet
    try {
      // Note: guests table doesn't have organization_id column per schema
      const result = await pool.query(
        `SELECT id, name, email, attendance_date FROM guests 
         WHERE attendance_date = $1
         ORDER BY name`,
        [date]
      );
      res.json({ success: true, guests: result.rows });
    } catch (err) {
      // If table or column doesn't exist, return empty array
      if (err.code === '42P01' || err.code === '42703') {
        res.json({ success: true, guests: [] });
      } else {
        throw err;
      }
    }
  } catch (error) {
    logger.error('Error fetching guests:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save guest
app.post('/api/save-guest', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const { name, email, attendance_date } = req.body;
    
    if (!name || !attendance_date) {
      return res.status(400).json({ success: false, message: 'Name and date are required' });
    }
    
    // Try to create guests table if it doesn't exist
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS guests (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          attendance_date DATE NOT NULL,
          organization_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (err) {
      // Ignore errors if table already exists
    }
    
    const result = await pool.query(
      `INSERT INTO guests (name, email, attendance_date, organization_id) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, email, attendance_date, organizationId]
    );
    
    res.json({ success: true, guest: { id: result.rows[0].id, name, email, attendance_date } });
  } catch (error) {
    logger.error('Error saving guest:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get reminder (for meeting preparation)
app.get('/api/get_reminder', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT * FROM rappel_reunion 
       WHERE organization_id = $1 
       ORDER BY creation_time DESC LIMIT 1`,
      [organizationId]
    );
    
    if (result.rows.length > 0) {
      res.json({ success: true, reminder: result.rows[0] });
    } else {
      res.json({ success: true, reminder: null });
    }
  } catch (error) {
    logger.error('Error fetching reminder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save reminder (for meeting preparation)
app.post('/api/save_reminder', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const { reminder_date, is_recurring, reminder_text } = req.body;
    
    await pool.query(
      `INSERT INTO rappel_reunion (organization_id, reminder_date, is_recurring, reminder_text) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id) DO UPDATE SET
       reminder_date = EXCLUDED.reminder_date,
       is_recurring = EXCLUDED.is_recurring,
       reminder_text = EXCLUDED.reminder_text`,
      [organizationId, reminder_date, is_recurring, reminder_text]
    );
    
    res.json({ success: true, message: 'Reminder saved successfully' });
  } catch (error) {
    logger.error('Error saving reminder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get reunion dates (for upcoming meeting)
app.get('/api/reunion-dates', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT DISTINCT date FROM reunion_preparations WHERE organization_id = $1 ORDER BY date DESC`,
      [organizationId]
    );
    
    res.json({
      success: true,
      dates: result.rows.map(row => row.date)
    });
  } catch (error) {
    logger.error('Error fetching reunion dates:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get attendance dates
app.get('/api/attendance-dates', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT DISTINCT date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
      [organizationId]
    );
    
    res.json({
      success: true,
      dates: result.rows.map(row => row.date)
    });
  } catch (error) {
    logger.error('Error fetching attendance dates:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get participant details
app.get('/api/participant-details', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const participantId = req.query.participant_id;
    
    if (participantId) {
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                pg.group_id, g.name as group_name
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1 AND p.id = $2`,
        [organizationId, participantId]
      );
      
      if (result.rows.length > 0) {
        res.json({ success: true, participant: result.rows[0] });
      } else {
        res.status(404).json({ success: false, message: 'Participant not found' });
      }
    } else {
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
                pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
                (SELECT COUNT(*) FROM form_submissions fs WHERE fs.participant_id = p.id AND fs.form_type = 'fiche_sante') > 0 as has_fiche_sante,
                (SELECT COUNT(*) FROM form_submissions fs WHERE fs.participant_id = p.id AND fs.form_type = 'acceptation_risque') > 0 as has_acceptation_risque
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         WHERE po.organization_id = $1
         ORDER BY p.first_name, p.last_name`,
        [organizationId]
      );
      
      res.json({ success: true, participants: result.rows });
    }
  } catch (error) {
    logger.error('Error fetching participant details:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get mailing list
app.get('/api/mailing-list', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT DISTINCT pg.courriel as email, pg.nom, pg.prenom, p.first_name as participant_first_name, p.last_name as participant_last_name
       FROM parents_guardians pg
       JOIN participants p ON pg.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1 AND pg.courriel IS NOT NULL AND pg.courriel != ''
       ORDER BY pg.nom, pg.prenom`,
      [organizationId]
    );
    
    res.json({
      success: true,
      contacts: result.rows
    });
  } catch (error) {
    logger.error('Error fetching mailing list:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get calendars
app.get('/api/calendars', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT c.participant_id, c.amount, c.amount_paid, c.paid, c.updated_at,
              p.first_name, p.last_name, g.name as group_name
       FROM calendars c
       JOIN participants p ON c.participant_id = p.id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE c.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      calendars: result.rows
    });
  } catch (error) {
    logger.error('Error fetching calendars:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get next meeting info
app.get('/api/next-meeting-info', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    const today = new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes
       FROM reunion_preparations
       WHERE organization_id = $1 AND date >= $2
       ORDER BY date ASC
       LIMIT 1`,
      [organizationId, today]
    );
    
    if (result.rows.length > 0) {
      res.json({ success: true, meeting: result.rows[0] });
    } else {
      res.json({ success: true, meeting: null, message: 'No upcoming meetings found' });
    }
  } catch (error) {
    logger.error('Error fetching next meeting info:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get animateurs (for reunion preparation)
app.get('/api/animateurs', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT u.id, u.full_name
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1 AND uo.role IN ('admin', 'animation')
       ORDER BY u.full_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      animateurs: result.rows
    });
  } catch (error) {
    logger.error('Error fetching animateurs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get parent contact list
app.get('/api/parent-contact-list', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT p.id as participant_id, p.first_name, p.last_name, g.name as group_name,
              pg_contact.id as guardian_id, pg_contact.nom, pg_contact.prenom, pg_contact.lien,
              pg_contact.courriel, pg_contact.telephone_residence, pg_contact.telephone_travail,
              pg_contact.telephone_cellulaire, pg_contact.is_emergency_contact
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pgrp ON p.id = pgrp.participant_id AND pgrp.organization_id = $1
       LEFT JOIN groups g ON pgrp.group_id = g.id
       LEFT JOIN parents_guardians pg_contact ON p.id = pg_contact.participant_id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name, pg_contact.is_primary DESC`,
      [organizationId]
    );
    
    res.json({
      success: true,
      contacts: result.rows
    });
  } catch (error) {
    logger.error('Error fetching parent contact list:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get users (for admin)
app.get('/api/users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = req.query.organization_id || await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_verified, uo.role, uo.approved
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1
       ORDER BY u.full_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get participants with users (for managing user assignments)
app.get('/api/participants-with-users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, 
              pg.group_id, g.name as group_name, pg.is_leader, pg.is_second_leader,
              u.id as user_id, u.email as user_email, u.full_name as user_full_name
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN user_participants up ON p.id = up.participant_id
       LEFT JOIN users u ON up.user_id = u.id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      participants: result.rows
    });
  } catch (error) {
    logger.error('Error fetching participants with users:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get parent users
app.get('/api/parent-users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1 AND uo.role = 'parent'
       ORDER BY u.full_name`,
      [organizationId]
    );
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    logger.error('Error fetching parent users:', error);
    res.status(500).json({ success: false, message: error.message });
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

      case 'attendance':
      case 'get_attendance':
        const dateForAttendance = req.query.date || new Date().toISOString().split('T')[0];
        const orgIdForAttendance = organizationId;
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
        const orgIdForAwardHonor = await getCurrentOrganizationId(req);

        try {
          await client.query('BEGIN');

          // Get point system rules for this organization
          const honorPointRules = await getPointSystemRules(orgIdForAwardHonor, client);
          const honorAwardPoints = honorPointRules.honors?.award || 5;

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
              // Get participant's group for proper point tracking
              const groupResultForHonor = await client.query(
                `SELECT group_id FROM participant_groups 
                 WHERE participant_id = $1 AND organization_id = $2`,
                [participantId, orgIdForAwardHonor]
              );
              const groupIdForHonor = groupResultForHonor.rows.length > 0 ? groupResultForHonor.rows[0].group_id : null;

              await client.query(
                `INSERT INTO points (participant_id, group_id, value, created_at, organization_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [participantId, groupIdForHonor, honorAwardPoints, date, orgIdForAwardHonor]
              );
              console.log(`[honor-legacy] Participant ${participantId} awarded honor on ${date}, points: +${honorAwardPoints}`);
              awards.push({ participantId, awarded: true, points: honorAwardPoints });
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

// ============================================
// BADGE SYSTEM ENDPOINTS
// ============================================

// Get badge progress for a participant
app.get('/api/badge-progress', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const participantId = req.query.participant_id;
    
    if (!participantId) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }
    
    const result = await pool.query(
      `SELECT * FROM badge_progress 
       WHERE participant_id = $1 AND organization_id = $2
       ORDER BY date_obtention DESC`,
      [participantId, organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching badge progress:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get pending badges for approval (requires admin or leader role)
app.get('/api/pending-badges', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or leader role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const result = await pool.query(
      `SELECT bp.*, p.first_name, p.last_name
       FROM badge_progress bp
       JOIN participants p ON bp.participant_id = p.id
       WHERE bp.organization_id = $1 AND bp.status = 'pending'
       ORDER BY bp.created_at DESC`,
      [organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching pending badges:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save badge progress (submit for approval)
app.post('/api/save-badge-progress', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { participant_id, territoire_chasse, objectif, description, fierte, raison, date_obtention, etoiles } = req.body;
    
    if (!participant_id || !territoire_chasse) {
      return res.status(400).json({ success: false, message: 'Participant ID and territoire_chasse are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        `INSERT INTO badge_progress 
         (participant_id, organization_id, territoire_chasse, objectif, description, fierte, raison, date_obtention, etoiles, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING *`,
        [participant_id, organizationId, territoire_chasse, objectif, description, fierte || false, raison, date_obtention, etoiles || 1]
      );
      
      await client.query('COMMIT');
      console.log(`[badge] Badge progress submitted for participant ${participant_id}: ${territoire_chasse}, ${etoiles} stars`);
      res.json({ success: true, data: result.rows[0], message: 'Badge progress submitted for approval' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error saving badge progress:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Approve badge (requires admin or leader role)
app.post('/api/approve-badge', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or leader role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { badge_id } = req.body;
    
    if (!badge_id) {
      return res.status(400).json({ success: false, message: 'Badge ID is required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get the badge details
      const badgeResult = await client.query(
        `SELECT * FROM badge_progress WHERE id = $1 AND organization_id = $2`,
        [badge_id, organizationId]
      );
      
      if (badgeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Badge not found' });
      }
      
      const badge = badgeResult.rows[0];
      
      // Update badge status to approved
      await client.query(
        `UPDATE badge_progress 
         SET status = 'approved', approved_by = $1, approval_date = NOW()
         WHERE id = $2`,
        [decoded.user_id, badge_id]
      );
      
      // Get point system rules for badge earn points
      const pointRules = await getPointSystemRules(organizationId, client);
      const badgeEarnPoints = pointRules.badges?.earn || 5;
      
      // Get participant's group for proper point tracking
      const groupResult = await client.query(
        `SELECT group_id FROM participant_groups 
         WHERE participant_id = $1 AND organization_id = $2`,
        [badge.participant_id, organizationId]
      );
      const groupId = groupResult.rows.length > 0 ? groupResult.rows[0].group_id : null;
      
      // Award points for earning the badge
      await client.query(
        `INSERT INTO points (participant_id, group_id, organization_id, value, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [badge.participant_id, groupId, organizationId, badgeEarnPoints]
      );
      
      await client.query('COMMIT');
      console.log(`[badge] Badge ${badge_id} approved for participant ${badge.participant_id}, points: +${badgeEarnPoints}`);
      res.json({ success: true, message: 'Badge approved', points: badgeEarnPoints });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error approving badge:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Reject badge (requires admin or leader role)
app.post('/api/reject-badge', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or leader role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { badge_id } = req.body;
    
    if (!badge_id) {
      return res.status(400).json({ success: false, message: 'Badge ID is required' });
    }
    
    const result = await pool.query(
      `UPDATE badge_progress 
       SET status = 'rejected', approved_by = $1, approval_date = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING *`,
      [decoded.user_id, badge_id, organizationId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Badge not found' });
    }
    
    console.log(`[badge] Badge ${badge_id} rejected`);
    res.json({ success: true, message: 'Badge rejected' });
  } catch (error) {
    logger.error('Error rejecting badge:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get badge summary (all badges for organization)
app.get('/api/badge-summary', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const result = await pool.query(
      `SELECT bp.*, p.first_name, p.last_name
       FROM badge_progress bp
       JOIN participants p ON bp.participant_id = p.id
       WHERE bp.organization_id = $1
       ORDER BY bp.date_obtention DESC`,
      [organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching badge summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get badge history for a participant
app.get('/api/badge-history', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const participantId = req.query.participant_id;
    
    if (!participantId) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }
    
    const result = await pool.query(
      `SELECT * FROM badge_progress 
       WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'
       ORDER BY date_obtention DESC`,
      [participantId, organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching badge history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get current stars for a participant (total approved stars)
app.get('/api/current-stars', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const participantId = req.query.participant_id;
    
    if (!participantId) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }
    
    const result = await pool.query(
      `SELECT COALESCE(SUM(etoiles), 0) as total_stars
       FROM badge_progress 
       WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'`,
      [participantId, organizationId]
    );
    
    res.json({ success: true, data: { total_stars: parseInt(result.rows[0].total_stars) } });
  } catch (error) {
    logger.error('Error fetching current stars:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get badge system settings (territoires and structure)
app.get('/api/badge-system-settings', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const result = await pool.query(
      `SELECT setting_value FROM organization_settings 
       WHERE organization_id = $1 AND setting_key = 'badge_system'`,
      [organizationId]
    );
    
    if (result.rows.length > 0) {
      try {
        const badgeSystem = JSON.parse(result.rows[0].setting_value);
        res.json({ success: true, data: badgeSystem });
      } catch (e) {
        res.json({ success: true, data: result.rows[0].setting_value });
      }
    } else {
      res.json({ success: true, data: null, message: 'No badge system settings found' });
    }
  } catch (error) {
    logger.error('Error fetching badge system settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// FORM SUBMISSION ENDPOINTS
// ============================================

// Get form submission for a participant
app.get('/api/form-submission', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { participant_id, form_type } = req.query;
    
    if (!participant_id || !form_type) {
      return res.status(400).json({ success: false, message: 'Participant ID and form_type are required' });
    }
    
    const result = await pool.query(
      `SELECT * FROM form_submissions 
       WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3
       ORDER BY updated_at DESC
       LIMIT 1`,
      [participant_id, organizationId, form_type]
    );
    
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.json({ success: true, data: null, message: 'No submission found' });
    }
  } catch (error) {
    logger.error('Error fetching form submission:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save form submission
app.post('/api/save-form-submission', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { participant_id, form_type, submission_data } = req.body;
    
    if (!participant_id || !form_type || !submission_data) {
      return res.status(400).json({ success: false, message: 'Participant ID, form_type, and submission_data are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if a submission already exists
      const existingResult = await client.query(
        `SELECT id FROM form_submissions 
         WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3`,
        [participant_id, organizationId, form_type]
      );
      
      let result;
      if (existingResult.rows.length > 0) {
        // Update existing submission
        result = await client.query(
          `UPDATE form_submissions 
           SET submission_data = $1, updated_at = NOW(), user_id = $2
           WHERE participant_id = $3 AND organization_id = $4 AND form_type = $5
           RETURNING *`,
          [JSON.stringify(submission_data), decoded.user_id, participant_id, organizationId, form_type]
        );
      } else {
        // Insert new submission
        result = await client.query(
          `INSERT INTO form_submissions 
           (participant_id, organization_id, form_type, submission_data, user_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [participant_id, organizationId, form_type, JSON.stringify(submission_data), decoded.user_id]
        );
      }
      
      await client.query('COMMIT');
      console.log(`[form] Form ${form_type} saved for participant ${participant_id}`);
      res.json({ success: true, data: result.rows[0], message: 'Form saved successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error saving form submission:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get organization form formats
app.get('/api/organization-form-formats', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const result = await pool.query(
      `SELECT * FROM organization_form_formats 
       WHERE organization_id = $1`,
      [organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching form formats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// GUARDIAN MANAGEMENT ENDPOINTS
// ============================================

// Get guardians for a participant
app.get('/api/guardians', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const participantId = req.query.participant_id;
    
    if (!participantId) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }
    
    // Verify participant belongs to this organization
    const participantCheck = await pool.query(
      `SELECT id FROM participants WHERE id = $1 AND organization_id = $2`,
      [participantId, organizationId]
    );
    
    if (participantCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Participant not found in this organization' });
    }
    
    const result = await pool.query(
      `SELECT pg.*, pg.lien as relationship, g.id, g.nom, g.prenom, g.courriel, 
              g.telephone_residence, g.telephone_travail, g.telephone_cellulaire,
              g.is_primary, g.is_emergency_contact
       FROM participant_guardians pg
       JOIN parents_guardians g ON pg.guardian_id = g.id
       JOIN participants p ON pg.participant_id = p.id
       WHERE pg.participant_id = $1 AND p.organization_id = $2`,
      [participantId, organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching guardians:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save guardian
app.post('/api/save-guardian', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { participant_id, guardian_id, nom, prenom, lien, courriel, 
            telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary, is_emergency_contact } = req.body;
    
    if (!participant_id || !nom || !prenom) {
      return res.status(400).json({ success: false, message: 'Participant ID, nom, and prenom are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Verify participant belongs to this organization
      const participantCheck = await client.query(
        `SELECT id FROM participants WHERE id = $1 AND organization_id = $2`,
        [participant_id, organizationId]
      );
      
      if (participantCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Participant not found in this organization' });
      }
      
      let guardianIdToLink;
      
      if (guardian_id) {
        // Verify the guardian is linked to a participant in this organization
        const guardianCheck = await client.query(
          `SELECT pg.guardian_id FROM participant_guardians pg
           JOIN participants p ON pg.participant_id = p.id
           WHERE pg.guardian_id = $1 AND p.organization_id = $2`,
          [guardian_id, organizationId]
        );
        
        if (guardianCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({ success: false, message: 'Guardian not found in this organization' });
        }
        
        // Update existing guardian
        await client.query(
          `UPDATE parents_guardians 
           SET nom = $1, prenom = $2, courriel = $3, 
               telephone_residence = $4, telephone_travail = $5, telephone_cellulaire = $6,
               is_primary = $7, is_emergency_contact = $8
           WHERE id = $9`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
           is_primary || false, is_emergency_contact || false, guardian_id]
        );
        guardianIdToLink = guardian_id;
        
        // Update the relationship if provided
        if (lien) {
          await client.query(
            `UPDATE participant_guardians SET lien = $1 WHERE guardian_id = $2 AND participant_id = $3`,
            [lien, guardian_id, participant_id]
          );
        }
      } else {
        // Insert new guardian
        const result = await client.query(
          `INSERT INTO parents_guardians 
           (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
            is_primary, is_emergency_contact)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire,
           is_primary || false, is_emergency_contact || false]
        );
        guardianIdToLink = result.rows[0].id;
        
        // Link guardian to participant
        await client.query(
          `INSERT INTO participant_guardians (guardian_id, participant_id, lien)
           VALUES ($1, $2, $3)
           ON CONFLICT (guardian_id, participant_id) DO UPDATE SET lien = $3`,
          [guardianIdToLink, participant_id, lien || null]
        );
      }
      
      await client.query('COMMIT');
      console.log(`[guardian] Guardian ${guardianIdToLink} saved for participant ${participant_id}`);
      res.json({ success: true, data: { guardian_id: guardianIdToLink }, message: 'Guardian saved successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error saving guardian:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Remove guardian from participant
app.delete('/api/remove-guardian', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { participant_id, guardian_id } = req.query;
    
    if (!participant_id || !guardian_id) {
      return res.status(400).json({ success: false, message: 'Participant ID and Guardian ID are required' });
    }
    
    // Verify the guardian-participant link belongs to this organization
    const linkCheck = await pool.query(
      `SELECT pg.guardian_id FROM participant_guardians pg
       JOIN participants p ON pg.participant_id = p.id
       WHERE pg.guardian_id = $1 AND pg.participant_id = $2 AND p.organization_id = $3`,
      [guardian_id, participant_id, organizationId]
    );
    
    if (linkCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Guardian link not found in this organization' });
    }
    
    await pool.query(
      `DELETE FROM participant_guardians WHERE guardian_id = $1 AND participant_id = $2`,
      [guardian_id, participant_id]
    );
    
    console.log(`[guardian] Guardian ${guardian_id} removed from participant ${participant_id}`);
    res.json({ success: true, message: 'Guardian removed successfully' });
  } catch (error) {
    logger.error('Error removing guardian:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// SPA catch-all route - serve index.html for all non-API routes
// This must be the last route handler
app.get('*', (req, res) => {
  // Don't catch API routes or static files
  if (req.path.startsWith('/api') || req.path.startsWith('/api-docs')) {
    return res.status(404).json({ success: false, message: 'Endpoint not found' });
  }
  
  const indexPath = isProduction
    ? path.join(__dirname, 'dist', 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
  });
}

module.exports = app;
