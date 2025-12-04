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
const jwt = require('jsonwebtoken');

// Import utilities
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership } = require('../utils/api-helpers');

// Load JWT secret key
const jwtKey = process.env.JWT_SECRET || 'default-secret-key-change-in-production';

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
  router.get('/initial-data', async (req, res) => {
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
  // Note: The /api/news endpoint already escapes HTML content (see escapeHtml function)
  // This provides server-side XSS protection for news content
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
  router.get('/parent-dashboard', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      // Verify user belongs to this organization
      const authCheck = await verifyOrganizationMembership(decoded.user_id, organizationId, pool);
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

  return router;
};
