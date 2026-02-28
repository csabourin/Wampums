/**
 * Dashboard Routes
 *
 * Handles dashboard data for different user roles
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/dashboards
 */

const express = require('express');
const router = express.Router();

// Import utilities
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { hasStaffRole, isParentOnly } = require('../config/role-constants');
const { requireJWTSecret, signJWTToken } = require('../utils/jwt-config');

// Validate JWT secret at startup
requireJWTSecret();

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with dashboard routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/initial-data:
   *   get:
   *     summary: Get initial application data
   *     description: Returns initial data for the application including authentication status
   *     tags: [Dashboard]
   *     parameters:
   *       - in: query
   *         name: lang
   *         schema:
   *           type: string
   *         description: Language preference (en/fr)
   *     responses:
   *       200:
   *         description: Initial data returned successfully
   *         content:
   *           application/javascript:
   *             schema:
   *               type: string
   */
  router.get('/initial', async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
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
        jwtToken = signJWTToken(
          { organizationId },
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
  // Note: The /api/news endpoint already escapes HTML content (see escapeHtml function)
  // This provides server-side XSS protection for news content
  fetch('/api/v1/public/news?lang=' + (window.initialData.lang || 'en'))
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error generating initial data:', error);
      res.status(500).type('application/javascript').send('console.error("Failed to load initial data");');
    }
  });

  /**
   * @swagger
   * /api/parent-dashboard:
   *   get:
   *     summary: Get parent dashboard data
   *     description: Retrieve dashboard data for parents including their children's information
   *     tags: [Dashboard]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Parent dashboard data retrieved successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permissions
   */
  router.get('/parent', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const roleNames = Array.isArray(decoded.roleNames) ? decoded.roleNames : [];
      const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];
      const userRoles = roleNames.length > 0 ? roleNames : (decoded.user_role ? [decoded.user_role] : []);

      // Use centralized role constants instead of hardcoded arrays
      const hasStaffAccess = hasStaffRole(userRoles);
      const isParentOnlyAccess = isParentOnly(userRoles);
      const canViewAllParticipants = hasStaffAccess && permissions.includes('participants.view');

      if (!hasStaffAccess && !isParentOnlyAccess) {
        return res.status(403).json({ success: false, message: 'Insufficient permissions' });
      }

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: authCheck.message });
      }

      // Get participants scoped to user permissions
      const participantBaseQuery = `
        SELECT p.id, p.first_name, p.last_name, p.date_naissance,
               g.name as group_name
        FROM participants p
        JOIN participant_organizations po ON p.id = po.participant_id
        LEFT JOIN participant_groups pg ON p.id = pg.participant_id AND pg.organization_id = $1
        LEFT JOIN groups g ON pg.group_id = g.id
      `;

      const childrenResult = canViewAllParticipants
        ? await pool.query(
          `${participantBaseQuery}
             WHERE po.organization_id = $1`,
          [organizationId]
        )
        : await pool.query(
          `${participantBaseQuery}
             JOIN user_participants up ON p.id = up.participant_id
             WHERE up.user_id = $2 AND po.organization_id = $1`,
          [organizationId, decoded.user_id]
        );

      const children = [];
      const childIds = childrenResult.rows.map(c => c.id);

      if (childIds.length === 0) {
        // No children, return early
        const nextMeetingResult = await pool.query(
          `SELECT date::text as date, endroit, notes FROM reunion_preparations
           WHERE organization_id = $1 AND date >= CURRENT_DATE
           ORDER BY date ASC LIMIT 1`,
          [organizationId]
        );

        return res.json({
          success: true,
          data: {
            children: [],
            next_meeting: nextMeetingResult.rows[0] || null
          }
        });
      }

      // Batch fetch all data with optimized queries (fix N+1 problem)
      const [attendanceResults, pointsResults, honorsResults, badgesResults, formsResults] = await Promise.all([
        // Get attendance (last 10 per child)
        pool.query(
          `SELECT participant_id, date::text as date, status
           FROM (
             SELECT participant_id, date, status,
                    ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY date DESC) as rn
             FROM attendance
             WHERE participant_id = ANY($1) AND organization_id = $2
           ) t
           WHERE rn <= 10
           ORDER BY participant_id, date DESC`,
          [childIds, organizationId]
        ),

        // Get total points for all children
        pool.query(
          `SELECT participant_id, COALESCE(SUM(value), 0) as total_points
           FROM points
           WHERE participant_id = ANY($1) AND organization_id = $2
           GROUP BY participant_id`,
          [childIds, organizationId]
        ),

        // Get honors count for all children
        pool.query(
          `SELECT participant_id, COUNT(*) as honor_count
           FROM honors
           WHERE participant_id = ANY($1) AND organization_id = $2
           GROUP BY participant_id`,
          [childIds, organizationId]
        ),

        // Get approved badges for all children
        pool.query(
          `SELECT bp.participant_id, bp.etoiles, bp.date_obtention, bp.badge_template_id,
                  bt.name AS badge_name, bt.translation_key, bt.section AS badge_section,
                  bt.level_count, COALESCE(bt.levels, '[]'::jsonb) AS template_levels
           FROM badge_progress bp
           JOIN badge_templates bt ON bp.badge_template_id = bt.id
           WHERE bp.participant_id = ANY($1) AND bp.organization_id = $2 AND bp.status = 'approved'
           ORDER BY bp.participant_id, bp.date_obtention DESC`,
          [childIds, organizationId]
        ),

        // Get form submissions for all children
        pool.query(
          `SELECT participant_id, form_type, updated_at
           FROM form_submissions
           WHERE participant_id = ANY($1) AND organization_id = $2`,
          [childIds, organizationId]
        )
      ]);

      // Group results by participant_id for efficient lookup
      const attendanceByChild = {};
      const pointsByChild = {};
      const honorsByChild = {};
      const badgesByChild = {};
      const formsByChild = {};

      attendanceResults.rows.forEach(row => {
        if (!attendanceByChild[row.participant_id]) attendanceByChild[row.participant_id] = [];
        attendanceByChild[row.participant_id].push({ date: row.date, status: row.status });
      });

      pointsResults.rows.forEach(row => {
        pointsByChild[row.participant_id] = parseInt(row.total_points);
      });

      honorsResults.rows.forEach(row => {
        honorsByChild[row.participant_id] = parseInt(row.honor_count);
      });

      badgesResults.rows.forEach(row => {
        if (!badgesByChild[row.participant_id]) badgesByChild[row.participant_id] = [];
        badgesByChild[row.participant_id].push({
          etoiles: row.etoiles,
          date_obtention: row.date_obtention,
          badge_template_id: row.badge_template_id,
          badge_name: row.badge_name,
          translation_key: row.translation_key,
          badge_section: row.badge_section,
          level_count: row.level_count,
          template_levels: row.template_levels
        });
      });

      formsResults.rows.forEach(row => {
        if (!formsByChild[row.participant_id]) formsByChild[row.participant_id] = [];
        formsByChild[row.participant_id].push({ type: row.form_type, updated_at: row.updated_at });
      });

      // Build children array with batched data
      for (const child of childrenResult.rows) {
        children.push({
          id: child.id,
          first_name: child.first_name,
          last_name: child.last_name,
          date_naissance: child.date_naissance,
          group_name: child.group_name,
          attendance: attendanceByChild[child.id] || [],
          total_points: pointsByChild[child.id] || 0,
          honor_count: honorsByChild[child.id] || 0,
          badges: badgesByChild[child.id] || [],
          forms: formsByChild[child.id] || []
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching parent dashboard:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
