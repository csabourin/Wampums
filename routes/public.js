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
const { check, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Import utilities
const { getCurrentOrganizationId, handleOrganizationResolutionError } = require('../utils/api-helpers');
const { sendEmail, sanitizeInput } = require('../utils/index');

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
 * Rate limiter for contact form submissions
 * Prevents spam and abuse
 */
const contactFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 3 requests per hour per IP
  message: 'Too many contact form submissions from this IP, please try again after an hour.',
  standardHeaders: true,
  legacyHeaders: false,
});

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

  /**
   * @swagger
   * /api/contact-demo:
   *   post:
   *     summary: Submit demo request contact form
   *     description: Send a demo request email to rama@meute6a.app
   *     tags: [Public]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - email
   *               - message
   *             properties:
   *               name:
   *                 type: string
   *                 description: Contact person's name
   *               email:
   *                 type: string
   *                 format: email
   *                 description: Contact person's email
   *               organization:
   *                 type: string
   *                 description: Organization/company name
   *               phone:
   *                 type: string
   *                 description: Phone number (optional)
   *               message:
   *                 type: string
   *                 description: Demo request message
   *               honeypot:
   *                 type: string
   *                 description: Anti-spam honeypot field (should be empty)
   *     responses:
   *       200:
   *         description: Demo request submitted successfully
   *       400:
   *         description: Validation error
   *       429:
   *         description: Too many requests
   *       500:
   *         description: Failed to send email
   */
  router.post('/contact-demo',
    contactFormLimiter,
    [
      check('name')
        .trim()
        .notEmpty()
        .withMessage('Name is required')
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
      check('email')
        .trim()
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Invalid email address')
        .normalizeEmail(),
      check('organization')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Organization name is too long'),
      check('phone')
        .optional()
        .trim()
        .isLength({ max: 20 })
        .withMessage('Phone number is too long'),
      check('message')
        .trim()
        .notEmpty()
        .withMessage('Message is required')
        .isLength({ min: 10, max: 2000 })
        .withMessage('Message must be between 10 and 2000 characters'),
      check('honeypot')
        .optional()
        .custom((value) => {
          // Honeypot field should be empty
          if (value && value.trim() !== '') {
            throw new Error('Invalid submission');
          }
          return true;
        }),
    ],
    async (req, res) => {
      try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            errors: errors.array().map(err => ({
              field: err.path,
              message: err.msg
            }))
          });
        }

        // Check honeypot (additional security layer)
        if (req.body.honeypot && req.body.honeypot.trim() !== '') {
          logger.warn('Honeypot triggered for contact form', {
            ip: req.ip,
            honeypot: req.body.honeypot
          });
          // Return success to fool bots
          return res.json({ success: true, message: 'Demo request submitted successfully' });
        }

        // Sanitize inputs
        const name = sanitizeInput(req.body.name);
        const email = sanitizeInput(req.body.email);
        const organization = sanitizeInput(req.body.organization || 'Not provided');
        const phone = sanitizeInput(req.body.phone || 'Not provided');
        const message = sanitizeInput(req.body.message);

        // Construct email content
        const subject = `Demo Request from ${name}`;
        const emailBody = `
Demo Request Submission
=======================

Name: ${name}
Email: ${email}
Organization: ${organization}
Phone: ${phone}

Message:
${message}

---
Submitted from: ${req.ip}
User Agent: ${req.headers['user-agent'] || 'Unknown'}
`;

        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4c65ae; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: #4c65ae; }
    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Demo Request Submission</h2>
    </div>
    <div class="content">
      <div class="field">
        <span class="label">Name:</span> ${escapeHtml(name)}
      </div>
      <div class="field">
        <span class="label">Email:</span> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
      </div>
      <div class="field">
        <span class="label">Organization:</span> ${escapeHtml(organization)}
      </div>
      <div class="field">
        <span class="label">Phone:</span> ${escapeHtml(phone)}
      </div>
      <div class="field">
        <span class="label">Message:</span>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      </div>
      <div class="footer">
        <p>Submitted from: ${escapeHtml(req.ip)}<br>
        User Agent: ${escapeHtml(req.headers['user-agent'] || 'Unknown')}</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

        // Send email to rama@meute6a.app
        const emailSent = await sendEmail(
          'rama@meute6a.app',
          subject,
          emailBody,
          htmlBody
        );

        if (!emailSent) {
          logger.error('Failed to send demo request email', {
            name,
            email,
            organization
          });
          return res.status(500).json({
            success: false,
            message: 'Failed to send demo request. Please try again later.'
          });
        }

        logger.info('Demo request email sent successfully', {
          name,
          email,
          organization,
          ip: req.ip
        });

        res.json({
          success: true,
          message: 'Demo request submitted successfully'
        });
      } catch (error) {
        logger.error('Error processing contact form:', error);
        res.status(500).json({
          success: false,
          message: 'An error occurred while processing your request'
        });
      }
    }
  );

  return router;
};
