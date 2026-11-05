'use strict';

const rateLimit = require('express-rate-limit');
const { MS_PER_HOUR } = require('../utils/time-units');

const INVITATION_WINDOW_MS = MS_PER_HOUR;
const INVITATION_WRITES_PER_WINDOW = 60;

/** Shared mail budget across administrator and walk-in invitation endpoints. */
const familyInvitationLimiter = rateLimit({
  windowMs: INVITATION_WINDOW_MS,
  max: INVITATION_WRITES_PER_WINDOW,
  message: { success: false, message: 'too_many_invitation_requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { familyInvitationLimiter };
