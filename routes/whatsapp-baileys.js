/**
 * WhatsApp Baileys Routes
 *
 * Provides endpoints for managing WhatsApp connection via Baileys
 * Allows Scout Leaders to connect their personal WhatsApp accounts via QR code
 *
 * IMPORTANT: This uses an unofficial API. Follow safety guidelines.
 */

const { authenticate, blockDemoRoles, requirePermission, getOrganizationId } = require('../middleware/auth');
const express = require('express');
const { asyncHandler, error: errorResponse } = require('../middleware/response');
const router = express.Router();
const {
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
  router.post('/v1/whatsapp/baileys/connect', authenticate, blockDemoRoles, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);

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
      await whatsappService.initializeConnection(organizationId, req.user.id);

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
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * Disconnect WhatsApp
   * POST /api/v1/whatsapp/baileys/disconnect
   */
  router.post('/v1/whatsapp/baileys/disconnect', authenticate, blockDemoRoles, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);

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
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * Get WhatsApp connection status
   * GET /api/v1/whatsapp/baileys/status
   */
  router.get('/v1/whatsapp/baileys/status', authenticate, requirePermission(), asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);

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
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  /**
   * Send test WhatsApp message
   * POST /api/v1/whatsapp/baileys/test
   */
  router.post('/v1/whatsapp/baileys/test', authenticate, blockDemoRoles, requirePermission('communications.send'), asyncHandler(async (req, res) => {
    try {

      const organizationId = await getOrganizationId(req, pool);

      const { phoneNumber, message } = req.body;

      if (!phoneNumber || !message) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and message are required',
        });
      }

      // Send test message
      const result = await whatsappService.sendMessage(organizationId, phoneNumber, message);

      res.json({
        success: result.success,
        message: result.success
          ? 'Test message sent successfully'
          : result.error || 'Failed to send test message. Make sure WhatsApp is connected.',
      });
    } catch (error) {
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('Error sending test WhatsApp message:', error);
      return errorResponse(res, 'internal_server_error', 500);
    }
  }));

  return router;
};
