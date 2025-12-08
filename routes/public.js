/**
 * Public Routes
 *
 * Handles public endpoints that don't require authentication
 * All endpoints in this module are prefixed with /api
 *
 * @module routes/public
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Import utilities
const { getCurrentOrganizationId, handleOrganizationResolutionError } = require('../utils/api-helpers');

/**
 * Helper function to escape HTML
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Export route factory function
 * Allows dependency injection of pool and logger
 *
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @returns {Router} Express router with public routes
 */
module.exports = (pool, logger) => {
  /**
   * @swagger
   * /api/translations:
   *   get:
   *     summary: Get translations for all languages
   *     description: Retrieve translation files for the application
   *     tags: [Public]
   *     responses:
   *       200:
   *         description: Translations retrieved successfully
   *       500:
   *         description: Failed to load translations
   */
  router.get('/translations', async (req, res) => {
    try {
      const frPath = path.join(__dirname, '..', 'lang', 'fr.json');
      const enPath = path.join(__dirname, '..', 'lang', 'en.json');

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

  /**
   * @swagger
   * /api/news:
   *   get:
   *     summary: Get latest news
   *     description: Retrieve the latest news items for the organization
   *     tags: [Public]
   *     parameters:
   *       - in: query
   *         name: lang
   *         schema:
   *           type: string
   *           enum: [en, fr]
   *         description: Language preference (en/fr)
   *     responses:
   *       200:
   *         description: News retrieved successfully
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: array
   *                   items:
   *                     type: object
   *       500:
   *         description: Failed to fetch news
   */
  router.get('/news', async (req, res) => {
    try {
      const organizationId = await getCurrentOrganizationId(req, pool, logger);
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
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error fetching news:', error);
      res.status(500).json({ error: 'Failed to fetch news' });
    }
  });

  return router;
};
