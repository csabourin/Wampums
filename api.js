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
const { success, error: errorResponse } = require('./middleware/response');

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

// Handle pool errors to prevent app crashes
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit the process on pool errors
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Log but don't exit - let the process continue
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't exit - let the process continue
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

// Save reunion preparation
app.post('/api/save-reunion-preparation', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);
    const { date, louveteau_dhonneur, endroit, activities, notes, animateur_responsable } = req.body;

    // Convert arrays/objects to appropriate formats
    const louvetauDhonneurJson = Array.isArray(louveteau_dhonneur)
      ? JSON.stringify(louveteau_dhonneur)
      : louveteau_dhonneur;

    const activitiesJson = typeof activities === 'string'
      ? activities
      : JSON.stringify(activities);

    // Use UPSERT to handle both insert and update atomically
    // This prevents race conditions and duplicate key errors
    const result = await pool.query(
      `INSERT INTO reunion_preparations
       (organization_id, date, louveteau_dhonneur, endroit, activities, notes, animateur_responsable)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, date)
       DO UPDATE SET
         louveteau_dhonneur = EXCLUDED.louveteau_dhonneur,
         endroit = EXCLUDED.endroit,
         activities = EXCLUDED.activities,
         notes = EXCLUDED.notes,
         animateur_responsable = EXCLUDED.animateur_responsable,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [organizationId, date, louvetauDhonneurJson, endroit, activitiesJson, notes, animateur_responsable]
    );

    res.json({
      success: true,
      message: 'Reunion preparation saved successfully',
      preparation: result.rows[0]
    });
  } catch (error) {
    logger.error('Error saving reunion preparation:', error);
    res.status(500).json({
      success: false,
      message: error.message
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
    
    return success(res, result.rows, 'Participants retrieved successfully');
  } catch (error) {
    logger.error('Error fetching participants:', error);
    return errorResponse(res, error.message, 500);
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
      `SELECT h.id, h.participant_id, h.date::text as date
       FROM honors h
       JOIN participants p ON h.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1
       ORDER BY h.date DESC`,
      [organizationId]
    );
    
    // Get available dates (dates with honors)
    const datesResult = await pool.query(
      `SELECT DISTINCT date::text as date FROM honors h
       JOIN participants p ON h.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1
       ORDER BY date DESC`,
      [organizationId]
    );
    
    return success(res, {
      participants: participantsResult.rows,
      honors: honorsResult.rows,
      availableDates: datesResult.rows.map(r => r.date)
    }, 'Honors retrieved successfully');
  } catch (error) {
    logger.error('Error fetching honors:', error);
    return errorResponse(res, error.message, 500);
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
              a.status as attendance_status, a.date::text as date
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
      `SELECT DISTINCT date::text as date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
      [organizationId]
    );
    
    return success(res, {
      participants: result.rows,
      currentDate: requestedDate,
      availableDates: datesResult.rows.map(r => r.date)
    }, 'Attendance retrieved successfully');
  } catch (error) {
    logger.error('Error fetching attendance:', error);
    return errorResponse(res, error.message, 500);
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
      return success(res, { pointUpdates }, 'Attendance updated successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error updating attendance:', error);
    return errorResponse(res, error.message, 500);
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
      console.log('[update-points] SUCCESS - Response:', JSON.stringify({ success: true, data: { updates: responseUpdates } }));
      return success(res, { updates: responseUpdates }, 'Points updated successfully');
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
    return errorResponse(res, error.message, 500);
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
        `SELECT id, name, email, attendance_date::text as attendance_date FROM guests
         WHERE attendance_date = $1
         ORDER BY name`,
        [date]
      );
      return success(res, { guests: result.rows }, 'Guests retrieved successfully');
    } catch (err) {
      // If table or column doesn't exist, return empty array
      if (err.code === '42P01' || err.code === '42703') {
        return success(res, { guests: [] }, 'Guests retrieved successfully');
      } else {
        throw err;
      }
    }
  } catch (error) {
    logger.error('Error fetching guests:', error);
    return errorResponse(res, error.message, 500);
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
      `SELECT DISTINCT date::text as date FROM reunion_preparations WHERE organization_id = $1 ORDER BY date DESC`,
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
      `SELECT DISTINCT date::text as date FROM attendance WHERE organization_id = $1 ORDER BY date DESC`,
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

// Save participant (create or update)
app.post('/api/save-participant', async (req, res) => {
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
    
    const { id, first_name, last_name, date_naissance, group_id } = req.body;
    
    if (!first_name || !last_name) {
      return res.status(400).json({ success: false, message: 'First name and last name are required' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      let participantId;
      
      if (id) {
        // Update existing participant
        const updateResult = await client.query(
          `UPDATE participants SET first_name = $1, last_name = $2, date_naissance = $3
           WHERE id = $4 RETURNING id`,
          [first_name, last_name, date_naissance || null, id]
        );
        
        if (updateResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Participant not found' });
        }
        
        participantId = id;
      } else {
        // Check for duplicate participant (same first name, last name, and date of birth)
        const duplicateCheck = await client.query(
          `SELECT p.id FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE LOWER(p.first_name) = LOWER($1) 
             AND LOWER(p.last_name) = LOWER($2) 
             AND p.date_naissance = $3
             AND po.organization_id = $4`,
          [first_name, last_name, date_naissance || null, organizationId]
        );
        
        if (duplicateCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ 
            success: false, 
            message: 'A participant with this name and date of birth already exists',
            existing_participant_id: duplicateCheck.rows[0].id
          });
        }
        
        // Create new participant
        const insertResult = await client.query(
          `INSERT INTO participants (first_name, last_name, date_naissance)
           VALUES ($1, $2, $3) RETURNING id`,
          [first_name, last_name, date_naissance || null]
        );
        
        participantId = insertResult.rows[0].id;
        
        // Link to organization
        await client.query(
          `INSERT INTO participant_organizations (participant_id, organization_id)
           VALUES ($1, $2)
           ON CONFLICT (participant_id, organization_id) DO NOTHING`,
          [participantId, organizationId]
        );
      }
      
      // Update group assignment if provided
      if (group_id !== undefined) {
        // Remove existing group assignment for this org
        await client.query(
          `DELETE FROM participant_groups WHERE participant_id = $1 AND organization_id = $2`,
          [participantId, organizationId]
        );
        
        // Add new group assignment if group_id is not null
        if (group_id) {
          await client.query(
            `INSERT INTO participant_groups (participant_id, group_id, organization_id)
             VALUES ($1, $2, $3)`,
            [participantId, group_id, organizationId]
          );
        }
      }
      
      await client.query('COMMIT');
      
      console.log(`[participant] Participant ${participantId} saved by user ${decoded.user_id}`);
      res.json({ 
        success: true, 
        participant_id: participantId,
        message: id ? 'Participant updated successfully' : 'Participant created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error saving participant:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update participant group membership and roles
app.post('/api/update-participant-group', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    // Verify user belongs to this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized) {
      return res.status(403).json({ status: 'error', message: authCheck.message });
    }

    const { participant_id, group_id, is_leader, is_second_leader } = req.body;

    if (!participant_id) {
      return res.status(400).json({ status: 'error', message: 'Participant ID is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Remove existing group assignment for this participant and organization
      await client.query(
        `DELETE FROM participant_groups WHERE participant_id = $1 AND organization_id = $2`,
        [participant_id, organizationId]
      );

      // Add new group assignment if group_id is not null/empty
      if (group_id) {
        await client.query(
          `INSERT INTO participant_groups (participant_id, group_id, organization_id, is_leader, is_second_leader)
           VALUES ($1, $2, $3, $4, $5)`,
          [participant_id, group_id, organizationId, is_leader || false, is_second_leader || false]
        );
      }

      await client.query('COMMIT');

      console.log(`[update-participant-group] Participant ${participant_id} group updated to ${group_id} by user ${decoded.user_id}`);
      res.json({
        status: 'success',
        message: group_id ? 'Group membership updated successfully' : 'Participant removed from group'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error updating participant group:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Link participant to organization
app.post('/api/link-participant-to-organization', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    const { participant_id } = req.body;
    
    if (!participant_id) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }
    
    // Insert or do nothing if already linked
    await pool.query(
      `INSERT INTO participant_organizations (participant_id, organization_id)
       VALUES ($1, $2)
       ON CONFLICT (participant_id, organization_id) DO NOTHING`,
      [participant_id, organizationId]
    );
    
    res.json({ success: true, message: 'Participant linked to organization' });
  } catch (error) {
    logger.error('Error linking participant to organization:', error);
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
      `SELECT date::text as date, animateur_responsable, louveteau_dhonneur, endroit, activities, notes
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
              pg.id as guardian_id, pg.nom, pg.prenom, pguard.lien,
              pg.courriel, pg.telephone_residence, pg.telephone_travail,
              pg.telephone_cellulaire, pg.is_emergency_contact, pg.is_primary
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pgrp ON p.id = pgrp.participant_id AND pgrp.organization_id = $1
       LEFT JOIN groups g ON pgrp.group_id = g.id
       LEFT JOIN participant_guardians pguard ON p.id = pguard.participant_id
       LEFT JOIN parents_guardians pg ON pguard.guardian_id = pg.id
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name, pg.is_primary DESC`,
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
          `SELECT DISTINCT date::text as date
           FROM reunion_preparations
           WHERE organization_id = $1
           ORDER BY date ASC`,
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
          `SELECT DISTINCT date::text as date
           FROM attendance
           WHERE date <= CURRENT_DATE AND organization_id = $1
           ORDER BY date DESC`,
          [organizationId]
        );
        jsonResponse(res, true, attendanceDatesResult.rows.map(row => row.date));
        break;

      case 'getAvailableDates':
        const availableDatesResult = await client.query(
          `SELECT DISTINCT date::text as date
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

    // Role-based access control
    const userRole = decoded.role || decoded.user_role;

    // Verify access to this participant
    if (userRole !== 'admin' && userRole !== 'animation') {
      // For parents, check if they have access to this participant
      const accessCheck = await pool.query(
        `SELECT 1 FROM user_participants
         WHERE user_id = $1 AND participant_id = $2`,
        [decoded.user_id, participant_id]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({ success: false, message: 'Access denied to this participant' });
      }
    }

    // Get form submission with participant basic information
    const result = await pool.query(
      `SELECT fs.*,
              p.first_name, p.last_name, p.date_naissance,
              p.date_of_birth
       FROM form_submissions fs
       JOIN participants p ON fs.participant_id = p.id
       WHERE fs.participant_id = $1 AND fs.organization_id = $2 AND fs.form_type = $3
       ORDER BY fs.updated_at DESC
       LIMIT 1`,
      [participant_id, organizationId, form_type]
    );

    if (result.rows.length > 0) {
      const submission = result.rows[0];
      // Merge submission_data with participant basic info for frontend compatibility
      const formData = {
        ...submission.submission_data,
        first_name: submission.first_name,
        last_name: submission.last_name,
        date_naissance: submission.date_naissance || submission.date_of_birth,
        participant_id: submission.participant_id
      };

      res.json({
        success: true,
        data: submission,
        form_data: formData // Add form_data for frontend compatibility
      });
    } else {
      // No submission found, but return participant basic info for new forms
      const participantResult = await pool.query(
        `SELECT first_name, last_name, date_naissance, date_of_birth, id
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         WHERE p.id = $1 AND po.organization_id = $2`,
        [participant_id, organizationId]
      );

      if (participantResult.rows.length > 0) {
        const participant = participantResult.rows[0];
        const formData = {
          first_name: participant.first_name,
          last_name: participant.last_name,
          date_naissance: participant.date_naissance || participant.date_of_birth,
          participant_id: participant.id
        };

        res.json({
          success: true,
          data: null,
          form_data: formData,
          message: 'No submission found, returning participant basic info'
        });
      } else {
        res.json({ success: true, data: null, form_data: {}, message: 'No submission or participant found' });
      }
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

    // Transform the data into an object keyed by form_type for easier lookup
    const formatsObject = {};
    result.rows.forEach(row => {
      formatsObject[row.form_type] = {
        ...row,
        form_structure: typeof row.form_structure === 'string'
          ? JSON.parse(row.form_structure)
          : row.form_structure
      };
    });

    res.json({ success: true, data: formatsObject });
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

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Approve user (admin only)
app.post('/api/approve-user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user has admin role in this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    // Verify target user exists and belongs to this organization
    const userCheck = await pool.query(
      `SELECT u.id, u.email, uo.role FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE u.id = $1 AND uo.organization_id = $2`,
      [user_id, organizationId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found in this organization' });
    }
    
    // Update user verification status
    await pool.query(
      `UPDATE users SET is_verified = true WHERE id = $1`,
      [user_id]
    );
    
    console.log(`[user] User ${user_id} approved by admin ${decoded.user_id}`);
    res.json({ success: true, message: 'User approved successfully' });
  } catch (error) {
    logger.error('Error approving user:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update user role (admin only)
app.post('/api/update-user-role', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user has admin role in this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { user_id, role } = req.body;
    
    if (!user_id || !role) {
      return res.status(400).json({ success: false, message: 'User ID and role are required' });
    }
    
    const validRoles = ['admin', 'animation', 'parent', 'leader'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role. Valid roles: ${validRoles.join(', ')}` });
    }
    
    // Prevent admin from changing their own role
    if (user_id === decoded.user_id) {
      return res.status(400).json({ success: false, message: 'Cannot change your own role' });
    }
    
    // Verify target user belongs to this organization
    const userCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [user_id, organizationId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found in this organization' });
    }
    
    // Update user role in organization
    await pool.query(
      `UPDATE user_organizations SET role = $1 WHERE user_id = $2 AND organization_id = $3`,
      [role, user_id, organizationId]
    );
    
    console.log(`[user] User ${user_id} role updated to ${role} by admin ${decoded.user_id}`);
    res.json({ success: true, message: 'User role updated successfully' });
  } catch (error) {
    logger.error('Error updating user role:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Link user to participants (admin can link any user, regular users can only link themselves)
app.post('/api/link-user-participants', async (req, res) => {
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
    
    let { user_id, participant_ids } = req.body;
    
    // If no user_id provided, use the current user (self-linking)
    if (!user_id) {
      user_id = decoded.user_id;
    }
    
    // If user is trying to link someone else, they need admin role
    if (user_id !== decoded.user_id) {
      const adminCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin']);
      if (!adminCheck.authorized) {
        return res.status(403).json({ success: false, message: 'Only admins can link participants to other users' });
      }
    }
    
    if (!participant_ids || !Array.isArray(participant_ids)) {
      return res.status(400).json({ success: false, message: 'participant_ids array is required' });
    }
    
    // Verify target user belongs to this organization
    const userCheck = await pool.query(
      `SELECT id FROM user_organizations WHERE user_id = $1 AND organization_id = $2`,
      [user_id, organizationId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found in this organization' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Only remove existing links if replace_all is true (admin replacing all links)
      // For self-linking (adding children), we just add to existing links
      const replaceAll = req.body.replace_all === true;
      if (replaceAll && user_id !== decoded.user_id) {
        await client.query(
          `DELETE FROM user_participants WHERE user_id = $1`,
          [user_id]
        );
      }
      
      // Add new links for each participant (verify they belong to org)
      for (const participantId of participant_ids) {
        // Verify participant belongs to this organization
        const participantCheck = await client.query(
          `SELECT id FROM participants p
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE p.id = $1 AND po.organization_id = $2`,
          [participantId, organizationId]
        );
        
        if (participantCheck.rows.length > 0) {
          await client.query(
            `INSERT INTO user_participants (user_id, participant_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, participant_id) DO NOTHING`,
            [user_id, participantId]
          );
        }
      }
      
      await client.query('COMMIT');
      console.log(`[user] User ${user_id} linked to ${participant_ids.length} participants`);
      res.json({ success: true, message: 'User linked to participants successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error linking user to participants:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get pending users (users awaiting approval)
app.get('/api/pending-users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user has admin role in this organization
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const result = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.is_verified, u.created_at, uo.role
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1 AND u.is_verified = false
       ORDER BY u.created_at DESC`,
      [organizationId]
    );
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching pending users:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// REPORTS ENDPOINTS
// ============================================

// Health report (allergies, medications, EpiPen, emergency contacts)
app.get('/api/health-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or animation role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const groupId = req.query.group_id;
    
    // Get all participants with their health form submissions
    let query = `
      SELECT p.id, p.first_name, p.last_name, p.date_naissance,
             g.name as group_name,
             fs.submission_data as health_data
      FROM participants p
      JOIN participant_organizations po ON p.id = po.participant_id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      LEFT JOIN form_submissions fs ON p.id = fs.participant_id 
        AND fs.organization_id = $1 
        AND fs.form_type = 'fiche_sante'
      WHERE po.organization_id = $1
    `;
    
    const params = [organizationId];
    
    if (groupId) {
      query += ` AND pg.group_id = $2`;
      params.push(groupId);
    }
    
    query += ` ORDER BY g.name, p.last_name, p.first_name`;
    
    const result = await pool.query(query, params);
    
    // Process health data to extract key fields
    const healthReport = result.rows.map(row => {
      const healthData = row.health_data || {};
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        date_naissance: row.date_naissance,
        group_name: row.group_name,
        allergies: healthData.allergies || healthData.allergie || null,
        allergies_details: healthData.allergies_details || healthData.allergie_details || null,
        medications: healthData.medicaments || healthData.medications || null,
        epipen: healthData.epipen || healthData.auto_injecteur || false,
        medecin_famille: healthData.medecin_famille || null,
        nom_medecin: healthData.nom_medecin || null,
        telephone_medecin: healthData.telephone_medecin || null,
        carte_assurance_maladie: healthData.carte_assurance_maladie || null,
        has_health_form: !!row.health_data
      };
    });
    
    res.json({ success: true, data: healthReport });
  } catch (error) {
    logger.error('Error fetching health report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Attendance report with date range
app.get('/api/attendance-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or animation role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    const { start_date, end_date, group_id, format } = req.query;
    
    let query = `
      SELECT p.id, p.first_name, p.last_name,
             g.name as group_name,
             a.date, a.status
      FROM participants p
      JOIN participant_organizations po ON p.id = po.participant_id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      LEFT JOIN attendance a ON p.id = a.participant_id AND a.organization_id = $1
      WHERE po.organization_id = $1
    `;
    
    const params = [organizationId];
    let paramIndex = 2;
    
    if (start_date) {
      query += ` AND a.date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND a.date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    if (group_id) {
      query += ` AND pg.group_id = $${paramIndex}`;
      params.push(group_id);
      paramIndex++;
    }
    
    query += ` ORDER BY p.last_name, p.first_name, a.date`;
    
    const result = await pool.query(query, params);
    
    // Group by participant
    const participantMap = new Map();
    for (const row of result.rows) {
      const key = row.id;
      if (!participantMap.has(key)) {
        participantMap.set(key, {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          group_name: row.group_name,
          attendance: [],
          summary: { present: 0, absent: 0, late: 0, excused: 0 }
        });
      }
      if (row.date) {
        const participant = participantMap.get(key);
        participant.attendance.push({ date: row.date, status: row.status });
        if (participant.summary[row.status] !== undefined) {
          participant.summary[row.status]++;
        }
      }
    }
    
    const attendanceReport = Array.from(participantMap.values());
    
    // If CSV format requested
    if (format === 'csv') {
      let csv = 'First Name,Last Name,Group,Present,Absent,Late,Excused\n';
      for (const p of attendanceReport) {
        csv += `"${p.first_name}","${p.last_name}","${p.group_name || ''}",${p.summary.present},${p.summary.absent},${p.summary.late},${p.summary.excused}\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance_report.csv"');
      return res.send(csv);
    }
    
    res.json({ success: true, data: attendanceReport });
  } catch (error) {
    logger.error('Error fetching attendance report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Missing documents report
app.get('/api/missing-documents-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);
    
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const organizationId = await getCurrentOrganizationId(req);
    
    // Verify user belongs to this organization with admin or animation role
    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, ['admin', 'animation', 'leader']);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, message: authCheck.message });
    }
    
    // Get required form types from organization settings
    const settingsResult = await pool.query(
      `SELECT setting_value FROM organization_settings 
       WHERE organization_id = $1 AND setting_key = 'required_forms'`,
      [organizationId]
    );
    
    // Default required forms if not configured
    let requiredForms = ['fiche_sante', 'acceptation_risque', 'formulaire_inscription'];
    if (settingsResult.rows.length > 0) {
      try {
        requiredForms = JSON.parse(settingsResult.rows[0].setting_value);
      } catch (e) {
        // Keep defaults
      }
    }
    
    // Get all participants and their submitted forms
    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              g.name as group_name,
              ARRAY_AGG(DISTINCT fs.form_type) FILTER (WHERE fs.form_type IS NOT NULL) as submitted_forms
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.organization_id = $1
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name, g.name
       ORDER BY g.name, p.last_name, p.first_name`,
      [organizationId]
    );
    
    // Calculate missing forms for each participant
    const missingDocsReport = result.rows.map(row => {
      const submittedForms = row.submitted_forms || [];
      const missingForms = requiredForms.filter(form => !submittedForms.includes(form));
      
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        group_name: row.group_name,
        submitted_forms: submittedForms,
        missing_forms: missingForms,
        is_complete: missingForms.length === 0
      };
    });
    
    res.json({ 
      success: true, 
      data: missingDocsReport,
      required_forms: requiredForms
    });
  } catch (error) {
    logger.error('Error fetching missing documents report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Points leaderboard report
app.get('/api/points-leaderboard', async (req, res) => {
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
    
    const { type, limit } = req.query;
    const resultLimit = parseInt(limit) || 10;
    
    if (type === 'groups') {
      // Group leaderboard
      const result = await pool.query(
        `SELECT g.id, g.name, 
                COALESCE(SUM(pts.value), 0) as total_points,
                COUNT(DISTINCT pg.participant_id) as member_count
         FROM groups g
         LEFT JOIN participant_groups pg ON g.id = pg.group_id AND pg.organization_id = $1
         LEFT JOIN points pts ON pts.group_id = g.id AND pts.organization_id = $1
         WHERE g.organization_id = $1
         GROUP BY g.id, g.name
         ORDER BY total_points DESC
         LIMIT $2`,
        [organizationId, resultLimit]
      );
      
      res.json({ success: true, data: result.rows, type: 'groups' });
    } else {
      // Individual leaderboard (default)
      const result = await pool.query(
        `SELECT p.id, p.first_name, p.last_name, 
                g.name as group_name,
                COALESCE(SUM(pts.value), 0) as total_points
         FROM participants p
         JOIN participant_organizations po ON p.id = po.participant_id
         LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
         LEFT JOIN groups g ON pg.group_id = g.id
         LEFT JOIN points pts ON pts.participant_id = p.id AND pts.organization_id = $1
         WHERE po.organization_id = $1
         GROUP BY p.id, p.first_name, p.last_name, g.name
         ORDER BY total_points DESC
         LIMIT $2`,
        [organizationId, resultLimit]
      );
      
      res.json({ success: true, data: result.rows, type: 'individuals' });
    }
  } catch (error) {
    logger.error('Error fetching points leaderboard:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Honors history report
app.get('/api/honors-history', async (req, res) => {
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
    
    const { start_date, end_date, participant_id } = req.query;
    
    let query = `
      SELECT h.id, h.date::text as date,
             p.id as participant_id, p.first_name, p.last_name,
             g.name as group_name
      FROM honors h
      JOIN participants p ON h.participant_id = p.id
      LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
      LEFT JOIN groups g ON pg.group_id = g.id
      WHERE h.organization_id = $1
    `;
    
    const params = [organizationId];
    let paramIndex = 2;
    
    if (start_date) {
      query += ` AND h.date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      query += ` AND h.date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }
    
    if (participant_id) {
      query += ` AND h.participant_id = $${paramIndex}`;
      params.push(participant_id);
      paramIndex++;
    }
    
    query += ` ORDER BY h.date DESC, p.last_name, p.first_name`;
    
    const result = await pool.query(query, params);
    
    // Also get summary by participant
    const summaryQuery = `
      SELECT p.id, p.first_name, p.last_name, COUNT(h.id) as honor_count
      FROM honors h
      JOIN participants p ON h.participant_id = p.id
      WHERE h.organization_id = $1
      GROUP BY p.id, p.first_name, p.last_name
      ORDER BY honor_count DESC
    `;
    
    const summaryResult = await pool.query(summaryQuery, [organizationId]);
    
    res.json({ 
      success: true, 
      data: result.rows,
      summary: summaryResult.rows
    });
  } catch (error) {
    logger.error('Error fetching honors history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// PARENT DASHBOARD ENDPOINT
// ============================================

// Optimized parent dashboard - single call for all child data
app.get('/api/parent-dashboard', async (req, res) => {
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
    
    // Get children linked to this user
    const childrenResult = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              g.name as group_name
       FROM participants p
       JOIN user_participants up ON p.id = up.participant_id
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE up.user_id = $2 AND po.organization_id = $1`,
      [organizationId, decoded.user_id]
    );
    
    const children = [];
    
    for (const child of childrenResult.rows) {
      // Get attendance (last 10)
      const attendanceResult = await pool.query(
        `SELECT date::text as date, status FROM attendance
         WHERE participant_id = $1 AND organization_id = $2
         ORDER BY date DESC LIMIT 10`,
        [child.id, organizationId]
      );
      
      // Get total points
      const pointsResult = await pool.query(
        `SELECT COALESCE(SUM(value), 0) as total_points FROM points 
         WHERE participant_id = $1 AND organization_id = $2`,
        [child.id, organizationId]
      );
      
      // Get honors count
      const honorsResult = await pool.query(
        `SELECT COUNT(*) as honor_count FROM honors 
         WHERE participant_id = $1 AND organization_id = $2`,
        [child.id, organizationId]
      );
      
      // Get approved badges
      const badgesResult = await pool.query(
        `SELECT territoire_chasse, etoiles, date_obtention FROM badge_progress 
         WHERE participant_id = $1 AND organization_id = $2 AND status = 'approved'
         ORDER BY date_obtention DESC`,
        [child.id, organizationId]
      );
      
      // Get form submission status
      const formsResult = await pool.query(
        `SELECT form_type, updated_at FROM form_submissions 
         WHERE participant_id = $1 AND organization_id = $2`,
        [child.id, organizationId]
      );
      
      children.push({
        id: child.id,
        first_name: child.first_name,
        last_name: child.last_name,
        date_naissance: child.date_naissance,
        group_name: child.group_name,
        attendance: attendanceResult.rows,
        total_points: parseInt(pointsResult.rows[0].total_points),
        honor_count: parseInt(honorsResult.rows[0].honor_count),
        badges: badgesResult.rows,
        forms: formsResult.rows.map(f => ({ type: f.form_type, updated_at: f.updated_at }))
      });
    }
    
    // Get next meeting info
    const nextMeetingResult = await pool.query(
      `SELECT date::text as date, endroit, notes FROM reunion_preparations
       WHERE organization_id = $1 AND date >= CURRENT_DATE
       ORDER BY date ASC LIMIT 1`,
      [organizationId]
    );
    
    res.json({ 
      success: true, 
      data: {
        children,
        next_meeting: nextMeetingResult.rows[0] || null
      }
    });
  } catch (error) {
    logger.error('Error fetching parent dashboard:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// FORM MANAGEMENT ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/form-types:
 *   get:
 *     summary: Get all available form types
 *     tags: [Forms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of form types
 */
app.get('/api/form-types', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      "SELECT DISTINCT form_type FROM organization_form_formats WHERE organization_id = $1 AND display_type = 'public' ORDER BY form_type",
      [organizationId]
    );

    res.json({
      success: true,
      data: result.rows.map(row => row.form_type)
    });
  } catch (error) {
    logger.error('Error fetching form types:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/form-structure:
 *   get:
 *     summary: Get form structure for a specific form type
 *     tags: [Forms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: form_type
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Form structure
 */
app.get('/api/form-structure', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { form_type } = req.query;

    if (!form_type) {
      return res.status(400).json({ success: false, message: 'Form type is required' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      "SELECT form_structure FROM organization_form_formats WHERE form_type = $1 AND organization_id = $2",
      [form_type, organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Form structure not found' });
    }

    res.json({
      success: true,
      data: JSON.parse(result.rows[0].form_structure)
    });
  } catch (error) {
    logger.error('Error fetching form structure:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/form-submissions-list:
 *   get:
 *     summary: Get form submissions for a specific form type
 *     tags: [Forms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: form_type
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: participant_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Form submissions
 */
app.get('/api/form-submissions-list', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { form_type, participant_id } = req.query;

    if (!form_type) {
      return res.status(400).json({ success: false, message: 'Form type is required' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    if (participant_id) {
      const result = await pool.query(
        "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
        [participant_id, form_type, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'No submission data found' });
      }

      const submissionData = result.rows[0].submission_data;
      res.json({
        success: true,
        data: typeof submissionData === 'string' ? JSON.parse(submissionData) : submissionData
      });
    } else {
      const result = await pool.query(
        `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
         FROM form_submissions fs
         JOIN participant_organizations po ON fs.participant_id = po.participant_id
         JOIN participants p ON fs.participant_id = p.id
         WHERE po.organization_id = $1 AND fs.form_type = $2
         ORDER BY p.first_name, p.last_name`,
        [organizationId, form_type]
      );

      res.json({
        success: true,
        data: result.rows.map(row => ({
          participant_id: row.participant_id,
          first_name: row.first_name,
          last_name: row.last_name,
          submission_data: typeof row.submission_data === 'string'
            ? JSON.parse(row.submission_data)
            : row.submission_data
        }))
      });
    }
  } catch (error) {
    logger.error('Error fetching form submissions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Alias endpoint for backwards compatibility with frontend
app.get('/api/form-submissions', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { form_type, participant_id } = req.query;

    if (!form_type) {
      return res.status(400).json({ success: false, message: 'Form type is required' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    if (participant_id) {
      const result = await pool.query(
        "SELECT submission_data FROM form_submissions WHERE participant_id = $1 AND form_type = $2 AND organization_id = $3",
        [participant_id, form_type, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'No submission data found' });
      }

      const submissionData = result.rows[0].submission_data;
      res.json({
        success: true,
        data: typeof submissionData === 'string' ? JSON.parse(submissionData) : submissionData
      });
    } else {
      const result = await pool.query(
        `SELECT fs.participant_id, fs.submission_data, p.first_name, p.last_name
         FROM form_submissions fs
         JOIN participant_organizations po ON fs.participant_id = po.participant_id
         JOIN participants p ON fs.participant_id = p.id
         WHERE po.organization_id = $1 AND fs.form_type = $2
         ORDER BY p.first_name, p.last_name`,
        [organizationId, form_type]
      );

      res.json({
        success: true,
        data: result.rows.map(row => ({
          participant_id: row.participant_id,
          first_name: row.first_name,
          last_name: row.last_name,
          submission_data: typeof row.submission_data === 'string'
            ? JSON.parse(row.submission_data)
            : row.submission_data
        }))
      });
    }
  } catch (error) {
    logger.error('Error fetching form submissions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// RISK ACCEPTANCE ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/risk-acceptance:
 *   get:
 *     summary: Get risk acceptance for a participant
 *     tags: [Forms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: participant_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Risk acceptance data
 */
app.get('/api/risk-acceptance', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { participant_id } = req.query;

    if (!participant_id) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }

    const result = await pool.query(
      `SELECT * FROM acceptation_risque WHERE participant_id = $1`,
      [participant_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Risk acceptance not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error fetching risk acceptance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/risk-acceptance:
 *   post:
 *     summary: Save risk acceptance for a participant
 *     tags: [Forms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participant_id
 *             properties:
 *               participant_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Risk acceptance saved
 */
app.post('/api/risk-acceptance', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      participant_id,
      groupe_district,
      accepte_risques,
      accepte_covid19,
      participation_volontaire,
      declaration_sante,
      declaration_voyage,
      nom_parent_tuteur,
      date_signature
    } = req.body;

    if (!participant_id) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }

    const result = await pool.query(
      `INSERT INTO acceptation_risque
       (participant_id, groupe_district, accepte_risques, accepte_covid19,
        participation_volontaire, declaration_sante, declaration_voyage,
        nom_parent_tuteur, date_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (participant_id)
       DO UPDATE SET
         groupe_district = EXCLUDED.groupe_district,
         accepte_risques = EXCLUDED.accepte_risques,
         accepte_covid19 = EXCLUDED.accepte_covid19,
         participation_volontaire = EXCLUDED.participation_volontaire,
         declaration_sante = EXCLUDED.declaration_sante,
         declaration_voyage = EXCLUDED.declaration_voyage,
         nom_parent_tuteur = EXCLUDED.nom_parent_tuteur,
         date_signature = EXCLUDED.date_signature
       RETURNING *`,
      [participant_id, groupe_district, accepte_risques, accepte_covid19,
       participation_volontaire, declaration_sante, declaration_voyage,
       nom_parent_tuteur, date_signature]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error saving risk acceptance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ADDITIONAL REPORT ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/health-contact-report:
 *   get:
 *     summary: Get health contact information report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health contact report
 */
app.get('/api/health-contact-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              fs.submission_data->>'emergency_contact_name' as emergency_contact_name,
              fs.submission_data->>'emergency_contact_phone' as emergency_contact_phone,
              fs.submission_data->>'doctor_name' as doctor_name,
              fs.submission_data->>'doctor_phone' as doctor_phone
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching health contact report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/allergies-report:
 *   get:
 *     summary: Get allergies report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Allergies report
 */
app.get('/api/allergies-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              fs.submission_data->>'allergies' as allergies,
              fs.submission_data->>'allergies_details' as allergies_details
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
       WHERE po.organization_id = $1
         AND (fs.submission_data->>'allergies' = 'true' OR fs.submission_data->>'allergies_details' IS NOT NULL)
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching allergies report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/medication-report:
 *   get:
 *     summary: Get medication report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Medication report
 */
app.get('/api/medication-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              fs.submission_data->>'medication' as medication,
              fs.submission_data->>'medication_details' as medication_details
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
       WHERE po.organization_id = $1
         AND (fs.submission_data->>'medication' = 'true' OR fs.submission_data->>'medication_details' IS NOT NULL)
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching medication report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/vaccine-report:
 *   get:
 *     summary: Get vaccine report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vaccine report
 */
app.get('/api/vaccine-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              fs.submission_data->>'vaccinations' as vaccinations,
              fs.submission_data->>'vaccination_date' as vaccination_date
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'fiche_sante'
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching vaccine report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/leave-alone-report:
 *   get:
 *     summary: Get permission to leave alone report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leave alone permission report
 */
app.get('/api/leave-alone-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              fs.submission_data->>'can_leave_alone' as can_leave_alone
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'guardian_form'
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching leave alone report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/media-authorization-report:
 *   get:
 *     summary: Get media authorization report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Media authorization report
 */
app.get('/api/media-authorization-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              fs.submission_data->>'media_authorization' as media_authorization
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id AND fs.form_type = 'guardian_form'
       WHERE po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching media authorization report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/honors-report:
 *   get:
 *     summary: Get honors report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Honors report
 */
app.get('/api/honors-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT h.honor_name, h.category, COUNT(*) as count,
              array_agg(p.first_name || ' ' || p.last_name) as recipients
       FROM honors h
       JOIN participants p ON h.participant_id = p.id
       JOIN participant_organizations po ON p.id = po.participant_id
       WHERE po.organization_id = $1
       GROUP BY h.honor_name, h.category
       ORDER BY h.category, h.honor_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching honors report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/points-report:
 *   get:
 *     summary: Get points report
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Points report
 */
app.get('/api/points-report', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, g.name as group_name,
              COALESCE(SUM(pts.value), 0) as total_points,
              COUNT(DISTINCT h.id) as honors_count
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       LEFT JOIN points pts ON p.id = pts.participant_id AND pts.organization_id = $1
       LEFT JOIN honors h ON p.id = h.participant_id
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name, g.name
       ORDER BY total_points DESC, p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching points report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// PARTICIPANT ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/participant-ages:
 *   get:
 *     summary: Get participants with calculated ages
 *     tags: [Participants]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Participants with ages
 */
app.get('/api/participant-ages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              DATE_PART('year', AGE(CURRENT_DATE, p.date_naissance)) as age,
              g.name as group_name
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE po.organization_id = $1
       ORDER BY age DESC, p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching participant ages:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/recent-honors:
 *   get:
 *     summary: Get recently awarded honors
 *     tags: [Honors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Recent honors
 */
app.get('/api/recent-honors', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);
    const limit = parseInt(req.query.limit) || 10;

    const result = await pool.query(
      `SELECT h.*, p.first_name, p.last_name, g.name as group_name
       FROM honors h
       JOIN participants p ON h.participant_id = p.id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE h.organization_id = $1
       ORDER BY h.date DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching recent honors:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/activites-rencontre:
 *   get:
 *     summary: Get meeting activities
 *     tags: [Meetings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Meeting activities
 */
app.get('/api/activites-rencontre', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT * FROM activites_rencontre ORDER BY activity`
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching activites rencontre:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/activity-templates:
 *   get:
 *     summary: Get activity templates for meetings
 *     tags: [Meetings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Activity templates
 */
app.get('/api/activity-templates', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      `SELECT * FROM activites_rencontre
       WHERE organization_id = $1 OR organization_id = 0
       ORDER BY category, name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching activity templates:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/user-children:
 *   get:
 *     summary: Get children linked to current user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's children
 */
app.get('/api/user-children', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name, p.date_naissance,
              g.name as group_name, pg.group_id
       FROM participants p
       JOIN user_participants up ON p.id = up.participant_id
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
       LEFT JOIN groups g ON pg.group_id = g.id
       WHERE up.user_id = $2 AND po.organization_id = $1
       ORDER BY p.first_name, p.last_name`,
      [organizationId, decoded.user_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching user children:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// CALENDAR/PAYMENT ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/calendars/{id}:
 *   put:
 *     summary: Update a calendar entry
 *     tags: [Calendars]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Calendar updated
 */
app.put('/api/calendars/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { id } = req.params;
    const { participant_id, date, amount_due, amount_paid, paid, notes } = req.body;

    const result = await pool.query(
      `UPDATE calendars
       SET participant_id = COALESCE($1, participant_id),
           date = COALESCE($2, date),
           amount_due = COALESCE($3, amount_due),
           amount_paid = COALESCE($4, amount_paid),
           paid = COALESCE($5, paid),
           notes = COALESCE($6, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND organization_id = $8
       RETURNING *`,
      [participant_id, date, amount_due, amount_paid, paid, notes, id, organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Calendar entry not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error updating calendar:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/calendars/{id}/payment:
 *   put:
 *     summary: Update payment amount for a calendar entry
 *     tags: [Calendars]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount_paid
 *             properties:
 *               amount_paid:
 *                 type: number
 *     responses:
 *       200:
 *         description: Payment updated
 */
app.put('/api/calendars/:id/payment', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { id } = req.params;
    const { amount_paid } = req.body;

    if (amount_paid === undefined) {
      return res.status(400).json({ success: false, message: 'Amount paid is required' });
    }

    // Get current amount due to determine if fully paid
    const currentResult = await pool.query(
      `SELECT amount_due FROM calendars WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Calendar entry not found' });
    }

    const amountDue = parseFloat(currentResult.rows[0].amount_due);
    const paid = parseFloat(amount_paid) >= amountDue;

    const result = await pool.query(
      `UPDATE calendars
       SET amount_paid = $1,
           paid = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND organization_id = $4
       RETURNING *`,
      [amount_paid, paid, id, organizationId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Error updating calendar payment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/participant-calendar:
 *   get:
 *     summary: Get calendar entries for a specific participant
 *     tags: [Calendars]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: participant_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Participant calendar entries
 */
app.get('/api/participant-calendar', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { participant_id } = req.query;

    if (!participant_id) {
      return res.status(400).json({ success: false, message: 'Participant ID is required' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const result = await pool.query(
      `SELECT c.*, p.first_name, p.last_name
       FROM calendars c
       JOIN participants p ON c.participant_id = p.id
       WHERE c.participant_id = $1 AND c.organization_id = $2
       ORDER BY c.date DESC`,
      [participant_id, organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching participant calendar:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - full_name
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               full_name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and full name are required'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (unverified by default)
    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, is_verified)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, full_name, is_verified`,
      [email, hashedPassword, full_name]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'User registered successfully. Please wait for admin approval.'
    });
  } catch (error) {
    logger.error('Error registering user:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/auth/request-reset:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset email sent
 */
app.post('/api/auth/request-reset', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if user exists
    const user = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    // Always return success to prevent email enumeration
    if (user.rows.length === 0) {
      return res.json({
        success: true,
        message: 'If a user with that email exists, a reset link has been sent'
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = jwt.sign(
      { user_id: user.rows[0].id, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Store reset token in database
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')
       ON CONFLICT (user_id)
       DO UPDATE SET token = $2, expires_at = NOW() + INTERVAL '1 hour', created_at = NOW()`,
      [user.rows[0].id, resetToken]
    );

    // TODO: Send email with reset link
    // For now, return the token in the response (in production, this should be emailed)
    res.json({
      success: true,
      message: 'If a user with that email exists, a reset link has been sent',
      // Remove this in production:
      reset_token: resetToken
    });
  } catch (error) {
    logger.error('Error requesting password reset:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - new_password
 *             properties:
 *               token:
 *                 type: string
 *               new_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successful
 */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.purpose !== 'password_reset') {
        throw new Error('Invalid token purpose');
      }
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    // Check if token exists in database and is not expired
    const tokenResult = await pool.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE user_id = $1 AND token = $2 AND expires_at > NOW()`,
      [decoded.user_id, token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, decoded.user_id]
    );

    // Delete used token
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [decoded.user_id]
    );

    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    logger.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/register-for-organization:
 *   post:
 *     summary: Register existing user for an organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - registration_password
 *             properties:
 *               registration_password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [parent, animation, admin]
 *               link_children:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Successfully registered for organization
 */
app.post('/api/register-for-organization', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { registration_password, role, link_children } = req.body;
    const organizationId = await getCurrentOrganizationId(req);

    // Check registration password
    const passwordResult = await pool.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'registration_password'`,
      [organizationId]
    );

    if (passwordResult.rows.length === 0 || passwordResult.rows[0].setting_value !== registration_password) {
      return res.status(403).json({ success: false, message: 'Invalid registration password' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Add user to organization
      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [decoded.user_id, organizationId, role || 'parent']
      );

      // Link children if provided
      if (link_children && Array.isArray(link_children)) {
        for (const participantId of link_children) {
          await client.query(
            `INSERT INTO user_participants (user_id, participant_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, participant_id) DO NOTHING`,
            [decoded.user_id, participantId]
          );
        }
      }

      await client.query('COMMIT');

      res.json({ success: true, message: 'Successfully registered for organization' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error registering for organization:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/switch-organization:
 *   post:
 *     summary: Switch active organization for user
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - organization_id
 *             properties:
 *               organization_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Organization switched
 */
app.post('/api/switch-organization', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { organization_id } = req.body;

    if (!organization_id) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Verify user belongs to this organization
    const membershipCheck = await pool.query(
      `SELECT role FROM user_organizations
       WHERE user_id = $1 AND organization_id = $2`,
      [decoded.user_id, organization_id]
    );

    if (membershipCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this organization'
      });
    }

    // Generate new JWT with updated organization
    const newToken = jwt.sign(
      {
        user_id: decoded.user_id,
        organization_id: organization_id,
        role: membershipCheck.rows[0].role
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      data: { token: newToken },
      message: 'Organization switched successfully'
    });
  } catch (error) {
    logger.error('Error switching organization:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// OTHER MISSING ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/push-subscribers:
 *   get:
 *     summary: Get all push notification subscribers
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of subscribers
 */
app.get('/api/push-subscribers', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || authCheck.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT ps.*, u.email, u.full_name
       FROM push_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE ps.organization_id = $1
       ORDER BY ps.created_at DESC`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching push subscribers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/participants-with-documents:
 *   get:
 *     summary: Get participants with their document submission status
 *     tags: [Participants]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Participants with documents
 */
app.get('/api/participants-with-documents', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT p.id, p.first_name, p.last_name,
              COUNT(DISTINCT fs.form_type) as forms_submitted,
              array_agg(DISTINCT fs.form_type) as submitted_forms
       FROM participants p
       JOIN participant_organizations po ON p.id = po.participant_id
       LEFT JOIN form_submissions fs ON p.id = fs.participant_id
       WHERE po.organization_id = $1
       GROUP BY p.id, p.first_name, p.last_name
       ORDER BY p.first_name, p.last_name`,
      [organizationId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Error fetching participants with documents:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/associate-user-participant:
 *   post:
 *     summary: Associate a user with a participant
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - participant_id
 *             properties:
 *               user_id:
 *                 type: integer
 *               participant_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Association created
 */
app.post('/api/associate-user-participant', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { user_id, participant_id } = req.body;

    if (!user_id || !participant_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID and participant ID are required'
      });
    }

    await pool.query(
      `INSERT INTO user_participants (user_id, participant_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, participant_id) DO NOTHING`,
      [user_id, participant_id]
    );

    res.json({ success: true, message: 'User associated with participant successfully' });
  } catch (error) {
    logger.error('Error associating user with participant:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/link-parent-participant:
 *   post:
 *     summary: Link a parent to a participant (child)
 *     tags: [Participants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - parent_id
 *               - participant_id
 *             properties:
 *               parent_id:
 *                 type: integer
 *               participant_id:
 *                 type: integer
 *               relationship:
 *                 type: string
 *     responses:
 *       200:
 *         description: Parent linked to participant
 */
app.post('/api/link-parent-participant', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { parent_id, participant_id, relationship } = req.body;

    if (!parent_id || !participant_id) {
      return res.status(400).json({
        success: false,
        message: 'Parent ID and participant ID are required'
      });
    }

    await pool.query(
      `INSERT INTO guardians (participant_id, guardian_id, relationship)
       VALUES ($1, $2, $3)
       ON CONFLICT (participant_id, guardian_id)
       DO UPDATE SET relationship = EXCLUDED.relationship`,
      [participant_id, parent_id, relationship || 'parent']
    );

    res.json({ success: true, message: 'Parent linked to participant successfully' });
  } catch (error) {
    logger.error('Error linking parent to participant:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @swagger
 * /api/participant-groups/{participantId}:
 *   delete:
 *     summary: Remove participant from their group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: participantId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Participant removed from group
 */
app.delete('/api/participant-groups/:participantId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const organizationId = await getCurrentOrganizationId(req);

    const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId);
    if (!authCheck.authorized || !['admin', 'animation'].includes(authCheck.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const { participantId } = req.params;

    const result = await pool.query(
      `DELETE FROM participant_groups
       WHERE participant_id = $1 AND organization_id = $2
       RETURNING *`,
      [participantId, organizationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Participant group assignment not found'
      });
    }

    res.json({ success: true, message: 'Participant removed from group successfully' });
  } catch (error) {
    logger.error('Error removing participant from group:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// ADDITIONAL ENDPOINTS - Migrated from PHP
// ============================================================================

/**
 * @swagger
 * /api/auth/verify-session:
 *   post:
 *     summary: Verify JWT session and get fresh user data
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Session verified successfully
 *       401:
 *         description: Invalid or expired token
 */
app.post('/api/auth/verify-session', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const decoded = verifyJWT(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Fetch fresh user data from database
    const result = await pool.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];

    // Get user's organizations and roles
    const orgsResult = await pool.query(
      `SELECT uo.organization_id, uo.role, os.setting_value->>'name' as org_name
       FROM user_organizations uo
       LEFT JOIN organization_settings os ON uo.organization_id = os.organization_id
         AND os.setting_key = 'organization_info'
       WHERE uo.user_id = $1`,
      [user.id]
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        organizations: orgsResult.rows
      }
    });
  } catch (error) {
    logger.error('Error verifying session:', error);
    res.status(500).json({ success: false, message: 'Error verifying session' });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user (client-side token removal)
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logout successful
 */
app.post('/api/auth/logout', (req, res) => {
  // With JWT, logout is primarily handled on the client side by removing the token
  // If using session-based auth or token blacklisting, handle here
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * @swagger
 * /api/permissions/check:
 *   post:
 *     summary: Check if user has permission for a specific operation
 *     tags: [Authorization]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - operation
 *             properties:
 *               operation:
 *                 type: string
 *     responses:
 *       200:
 *         description: Permission check result
 */
app.post('/api/permissions/check', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      return res.json({ hasPermission: false });
    }

    const { operation } = req.body;

    if (!operation) {
      return res.json({ hasPermission: false });
    }

    const userId = decoded.userId;

    // Check user's permission for the specific operation
    const result = await pool.query(
      `SELECT u.id, p.allowed
       FROM users u
       LEFT JOIN user_organizations uo ON u.id = uo.user_id
       LEFT JOIN permissions p ON uo.role = p.role
       WHERE u.id = $1 AND p.operation = $2`,
      [userId, operation]
    );

    const hasPermission = result.rows.length > 0 && result.rows[0].allowed;

    res.json({ hasPermission });
  } catch (error) {
    logger.error('Error checking permission:', error);
    res.json({ hasPermission: false });
  }
});

/**
 * @swagger
 * /api/health-forms:
 *   post:
 *     summary: Create or update health form (fiche santé) for a participant
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participant_id
 *             properties:
 *               participant_id:
 *                 type: integer
 *               nom_fille_mere:
 *                 type: string
 *               medecin_famille:
 *                 type: string
 *               nom_medecin:
 *                 type: string
 *               probleme_sante:
 *                 type: string
 *               allergie:
 *                 type: string
 *               epipen:
 *                 type: boolean
 *               medicament:
 *                 type: string
 *               limitation:
 *                 type: string
 *               vaccins_a_jour:
 *                 type: boolean
 *               blessures_operations:
 *                 type: string
 *               niveau_natation:
 *                 type: string
 *               doit_porter_vfi:
 *                 type: boolean
 *               regles:
 *                 type: string
 *               renseignee:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Health form saved successfully
 *       201:
 *         description: Health form created successfully
 */
app.post('/api/health-forms', async (req, res) => {
  const client = await pool.connect();

  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      participant_id,
      nom_fille_mere,
      medecin_famille,
      nom_medecin,
      probleme_sante,
      allergie,
      epipen,
      medicament,
      limitation,
      vaccins_a_jour,
      blessures_operations,
      niveau_natation,
      doit_porter_vfi,
      regles,
      renseignee
    } = req.body;

    if (!participant_id) {
      return res.status(400).json({ success: false, message: 'Missing participant_id' });
    }

    await client.query('BEGIN');

    // Check if health form already exists
    const checkResult = await client.query(
      'SELECT id FROM fiche_sante WHERE participant_id = $1',
      [participant_id]
    );

    const exists = checkResult.rows.length > 0;

    if (exists) {
      // Update existing record
      await client.query(
        `UPDATE fiche_sante SET
          nom_fille_mere = $1,
          medecin_famille = $2,
          nom_medecin = $3,
          probleme_sante = $4,
          allergie = $5,
          epipen = $6,
          medicament = $7,
          limitation = $8,
          vaccins_a_jour = $9,
          blessures_operations = $10,
          niveau_natation = $11,
          doit_porter_vfi = $12,
          regles = $13,
          renseignee = $14,
          updated_at = NOW()
         WHERE participant_id = $15`,
        [
          nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
          allergie, epipen, medicament, limitation, vaccins_a_jour,
          blessures_operations, niveau_natation, doit_porter_vfi,
          regles, renseignee, participant_id
        ]
      );
    } else {
      // Insert new record
      await client.query(
        `INSERT INTO fiche_sante
         (nom_fille_mere, medecin_famille, nom_medecin, probleme_sante, allergie,
          epipen, medicament, limitation, vaccins_a_jour, blessures_operations,
          niveau_natation, doit_porter_vfi, regles, renseignee, participant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          nom_fille_mere, medecin_famille, nom_medecin, probleme_sante,
          allergie, epipen, medicament, limitation, vaccins_a_jour,
          blessures_operations, niveau_natation, doit_porter_vfi,
          regles, renseignee, participant_id
        ]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Health form saved successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error saving health form:', error);
    res.status(500).json({ success: false, message: 'Error saving health form: ' + error.message });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/groups/{id}:
 *   put:
 *     summary: Update a group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated successfully
 *       404:
 *         description: Group not found
 */
app.put('/api/groups/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const groupId = parseInt(req.params.id);
    const { name } = req.body;

    if (!groupId) {
      return res.status(400).json({ success: false, message: 'Group ID is required' });
    }

    if (!name) {
      return res.status(400).json({ success: false, message: 'At least one field to update is required' });
    }

    const result = await pool.query(
      'UPDATE groups SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name.trim(), groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    res.json({ success: true, message: 'Group updated successfully', group: result.rows[0] });
  } catch (error) {
    logger.error('Error updating group:', error);
    res.status(500).json({ success: false, message: 'Error updating group' });
  }
});

/**
 * @swagger
 * /api/badge-progress/{id}:
 *   put:
 *     summary: Update badge progress status (approve/reject)
 *     tags: [Badges]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Badge progress ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [approved, rejected, pending]
 *               reviewer_comments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Badge status updated successfully
 *       404:
 *         description: Badge progress not found
 */
app.put('/api/badge-progress/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const badgeId = parseInt(req.params.id);
    const { status, reviewer_comments } = req.body;

    if (!badgeId) {
      return res.status(400).json({ success: false, message: 'Badge ID is required' });
    }

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const result = await pool.query(
      `UPDATE badge_progress
       SET status = $1, reviewer_comments = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, reviewer_comments || null, badgeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Badge progress not found' });
    }

    res.json({ success: true, message: 'Badge status updated successfully', badge: result.rows[0] });
  } catch (error) {
    logger.error('Error updating badge status:', error);
    res.status(500).json({ success: false, message: 'Error updating badge status' });
  }
});

/**
 * @swagger
 * /api/groups/{id}:
 *   delete:
 *     summary: Remove a group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Group removed successfully
 */
app.delete('/api/groups/:id', async (req, res) => {
  const client = await pool.connect();

  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      await client.release();
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const groupId = parseInt(req.params.id);

    if (!groupId) {
      return res.status(400).json({ success: false, message: 'Group ID is required' });
    }

    await client.query('BEGIN');

    // Update participants to remove group assignment
    await client.query(
      'UPDATE participants SET group_id = NULL WHERE group_id = $1',
      [groupId]
    );

    // Delete the group
    const result = await client.query(
      'DELETE FROM groups WHERE id = $1 RETURNING *',
      [groupId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Group removed successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error removing group:', error);
    res.status(500).json({ success: false, message: 'Error removing group' });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/groups:
 *   post:
 *     summary: Create a new group
 *     tags: [Groups]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - organization_id
 *             properties:
 *               name:
 *                 type: string
 *               organization_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Group created successfully
 */
app.post('/api/groups', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { name, organization_id } = req.body;

    if (!name || !organization_id) {
      return res.status(400).json({ success: false, message: 'Name and organization ID are required' });
    }

    const result = await pool.query(
      'INSERT INTO groups (name, organization_id, created_at) VALUES ($1, $2, NOW()) RETURNING *',
      [name.trim(), organization_id]
    );

    res.status(201).json({ success: true, message: 'Group created successfully', group: result.rows[0] });
  } catch (error) {
    logger.error('Error creating group:', error);
    res.status(500).json({ success: false, message: 'Error creating group' });
  }
});

/**
 * @swagger
 * /api/organizations:
 *   post:
 *     summary: Create a new organization
 *     tags: [Organizations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Organization created successfully
 */
app.post('/api/organizations', async (req, res) => {
  const client = await pool.connect();

  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = verifyJWT(token);

    if (!decoded || !decoded.userId) {
      await client.release();
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { name, ...otherData } = req.body;
    const userId = decoded.userId;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Organization name is required' });
    }

    await client.query('BEGIN');

    // Create new organization
    const orgResult = await client.query(
      'INSERT INTO organizations (name, created_at) VALUES ($1, NOW()) RETURNING id',
      [name]
    );

    const newOrganizationId = orgResult.rows[0].id;

    // Copy organization form formats from template (organization_id = 0)
    await client.query(
      `INSERT INTO organization_form_formats (organization_id, form_type, form_structure, display_type)
       SELECT $1, form_type, form_structure, 'public'
       FROM organization_form_formats
       WHERE organization_id = 0`,
      [newOrganizationId]
    );

    // Insert organization settings
    const orgInfo = { name, ...otherData };
    await client.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES ($1, 'organization_info', $2)`,
      [newOrganizationId, JSON.stringify(orgInfo)]
    );

    // Link current user to the new organization as admin
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, role, created_at)
       VALUES ($1, $2, 'admin', NOW())`,
      [userId, newOrganizationId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      organization_id: newOrganizationId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating organization:', error);
    res.status(500).json({ success: false, message: 'Error creating organization: ' + error.message });
  } finally {
    client.release();
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
