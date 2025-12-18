/**
 * WhatsApp Baileys Routes
 *
 * Provides endpoints for managing WhatsApp connection via Baileys
 * Allows Scout Leaders to connect their personal WhatsApp accounts via QR code
 *
 * IMPORTANT: This uses an unofficial API. Follow safety guidelines.
 */

const express = require('express');
const router = express.Router();
const {
  verifyJWT,
  getCurrentOrganizationId,
  verifyOrganizationMembership,
  handleOrganizationResolutionError,
} = require('../utils/api-helpers');

/**
 * Export route factory function
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Winston logger instance
 * @param {WhatsAppBaileysService} whatsappService - WhatsApp Baileys service instance
 * @returns {Router} Express router with WhatsApp routes
 */
module.exports = (pool, logger, whatsappService) => {
  /**
   * Initialize WhatsApp connection (generates QR code)
   * POST /api/v1/whatsapp/baileys/connect
   */
  router.post('/v1/whatsapp/baileys/connect', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload?.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(
        pool,
        payload.user_id,
        organizationId,
        ['admin', 'animation']
      );

      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message });
      }

      // Check if already connected
      const isConnected = await whatsappService.isConnected(organizationId);
      if (isConnected) {
        return res.json({
          success: true,
          message: 'WhatsApp already connected',
          alreadyConnected: true,
        });
      }

      // Initialize connection (will generate QR code)
      await whatsappService.initializeConnection(organizationId, payload.user_id);

      res.json({
        success: true,
        message: 'WhatsApp connection initiated. Please scan the QR code.',
        qrCodePending: true,
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error initiating WhatsApp connection:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * Disconnect WhatsApp
   * POST /api/v1/whatsapp/baileys/disconnect
   */
  router.post('/v1/whatsapp/baileys/disconnect', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload?.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(
        pool,
        payload.user_id,
        organizationId,
        ['admin', 'animation']
      );

      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message });
      }

      // Disconnect
      await whatsappService.disconnect(organizationId);

      res.json({
        success: true,
        message: 'WhatsApp disconnected successfully',
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error disconnecting WhatsApp:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * Get WhatsApp connection status
   * GET /api/v1/whatsapp/baileys/status
   */
  router.get('/v1/whatsapp/baileys/status', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload?.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(
        pool,
        payload.user_id,
        organizationId,
        ['admin', 'animation', 'parent']
      );

      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message });
      }

      // Get connection info
      const connectionInfo = await whatsappService.getConnectionInfo(organizationId);

      res.json({
        success: true,
        data: connectionInfo || {
          isConnected: false,
          connectedPhoneNumber: null,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
        },
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error getting WhatsApp status:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * Send test WhatsApp message
   * POST /api/v1/whatsapp/baileys/test
   */
  router.post('/v1/whatsapp/baileys/test', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const payload = verifyJWT(token);

      if (!payload?.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);
      const membership = await verifyOrganizationMembership(
        pool,
        payload.user_id,
        organizationId,
        ['admin', 'animation']
      );

      if (!membership.authorized) {
        return res.status(403).json({ success: false, message: membership.message });
      }

      const { phoneNumber, message } = req.body;

      if (!phoneNumber || !message) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and message are required',
        });
      }

      // Send test message
      const success = await whatsappService.sendMessage(organizationId, phoneNumber, message);

      res.json({
        success,
        message: success
          ? 'Test message sent successfully'
          : 'Failed to send test message. Make sure WhatsApp is connected.',
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error sending test WhatsApp message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
