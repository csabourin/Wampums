const express = require('express');
const router = express.Router();
const { authenticate, getOrganizationId, blockDemoRoles, hasAnyRole } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');

// Initialize Stripe with secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = (pool, logger) => {
  /**
   * @route POST /v1/stripe/create-payment-intent
   * @desc Create a Stripe payment intent for a participant fee
   * @access Parents and staff (authenticated)
   */
  router.post('/v1/stripe/create-payment-intent', authenticate, blockDemoRoles, asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const organizationId = await getOrganizationId(req, pool);
    const { participant_fee_id, amount } = req.body;

    // Validate input
    if (!participant_fee_id) {
      return error(res, 'participant_fee_id is required', 400);
    }

    if (!amount || amount <= 0) {
      return error(res, 'amount must be greater than 0', 400);
    }

    // Verify the user has permission to pay this fee
    // Parents can only pay for their own children, staff can pay for anyone
    const isStaff = hasAnyRole(req.user, ['district', 'unitadmin', 'leader', 'finance', 'administration', 'demoadmin']);

    let feeQuery;
    let feeParams;

    if (isStaff) {
      // Staff can pay any fee in their organization
      feeQuery = `
        SELECT
          pf.id,
          pf.participant_id,
          pf.total_amount,
          pf.status,
          p.first_name,
          p.last_name,
          COALESCE(SUM(pay.amount), 0) as total_paid
        FROM participant_fees pf
        JOIN participants p ON pf.participant_id = p.id
        LEFT JOIN payments pay ON pf.id = pay.participant_fee_id
        WHERE pf.id = $1 AND pf.organization_id = $2
        GROUP BY pf.id, pf.participant_id, pf.total_amount, pf.status, p.first_name, p.last_name
      `;
      feeParams = [participant_fee_id, organizationId];
    } else {
      // Parents can only pay for their children
      feeQuery = `
        SELECT
          pf.id,
          pf.participant_id,
          pf.total_amount,
          pf.status,
          p.first_name,
          p.last_name,
          COALESCE(SUM(pay.amount), 0) as total_paid
        FROM participant_fees pf
        JOIN participants p ON pf.participant_id = p.id
        JOIN user_participants up ON p.id = up.participant_id
        LEFT JOIN payments pay ON pf.id = pay.participant_fee_id
        WHERE pf.id = $1
          AND up.user_id = $2
          AND pf.organization_id = $3
        GROUP BY pf.id, pf.participant_id, pf.total_amount, pf.status, p.first_name, p.last_name
      `;
      feeParams = [participant_fee_id, userId, organizationId];
    }

    const feeResult = await pool.query(feeQuery, feeParams);

    if (feeResult.rows.length === 0) {
      return error(res, 'Fee not found or you do not have permission to pay this fee', 404);
    }

    const fee = feeResult.rows[0];
    const outstanding = parseFloat(fee.total_amount) - parseFloat(fee.total_paid);

    // Verify the payment amount doesn't exceed outstanding balance
    if (amount > outstanding) {
      return error(res, `Payment amount ($${amount}) exceeds outstanding balance ($${outstanding.toFixed(2)})`, 400);
    }

    try {
      // Create a PaymentIntent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'cad',
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          participant_fee_id: participant_fee_id.toString(),
          participant_id: fee.participant_id.toString(),
          participant_name: `${fee.first_name} ${fee.last_name}`,
          organization_id: organizationId.toString(),
          user_id: userId.toString(),
        },
        description: `Payment for ${fee.first_name} ${fee.last_name} - Fee #${participant_fee_id}`,
      });

      logger.info(`Created Stripe PaymentIntent: ${paymentIntent.id} for participant_fee_id: ${participant_fee_id}, amount: $${amount}`);

      return success(res, {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amount,
        participantName: `${fee.first_name} ${fee.last_name}`,
      }, 'Payment intent created successfully');

    } catch (stripeError) {
      logger.error('Stripe PaymentIntent creation failed:', stripeError);
      return error(res, `Payment processing error: ${stripeError.message}`, 500);
    }
  }));

  /**
   * @route POST /v1/stripe/webhook
   * @desc Stripe webhook handler for payment events
   * @access Public (verified by Stripe signature)
   */
  router.post('/v1/stripe/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      logger.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info(`Stripe webhook received: ${event.type}, ID: ${event.id}`);

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object, pool, logger);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object, pool, logger);
        break;

      case 'payment_intent.canceled':
        await handlePaymentCanceled(event.data.object, pool, logger);
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    // Return a 200 response to acknowledge receipt of the event
    res.json({ received: true });
  }));

  /**
   * @route GET /v1/stripe/payment-status/:paymentIntentId
   * @desc Check the status of a payment intent
   * @access Authenticated
   */
  router.get('/v1/stripe/payment-status/:paymentIntentId', authenticate, asyncHandler(async (req, res) => {
    const { paymentIntentId } = req.params;

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      return success(res, {
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100, // Convert from cents
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata,
      }, 'Payment status retrieved');

    } catch (stripeError) {
      logger.error('Failed to retrieve PaymentIntent:', stripeError);
      return error(res, 'Failed to retrieve payment status', 500);
    }
  }));

  return router;
};

/**
 * Handle successful payment
 */
async function handlePaymentSuccess(paymentIntent, pool, logger) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      id: paymentIntentId,
      amount,
      currency,
      payment_method,
      metadata
    } = paymentIntent;

    const participant_fee_id = metadata.participant_fee_id;
    const participant_id = metadata.participant_id;
    const organization_id = metadata.organization_id;

    if (!participant_fee_id) {
      throw new Error('Missing participant_fee_id in PaymentIntent metadata');
    }

    // Check if payment already recorded
    const existingPayment = await client.query(
      'SELECT id FROM payments WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );

    if (existingPayment.rows.length > 0) {
      logger.info(`Payment already recorded for PaymentIntent: ${paymentIntentId}`);
      await client.query('COMMIT');
      return;
    }

    // Create payment record
    const paymentAmount = amount / 100; // Convert from cents to dollars

    const insertResult = await client.query(
      `INSERT INTO payments (
        participant_fee_id,
        amount,
        payment_date,
        method,
        reference_number,
        payment_processor,
        stripe_payment_intent_id,
        stripe_payment_method_id,
        stripe_payment_status,
        stripe_metadata
      ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        participant_fee_id,
        paymentAmount,
        'credit_card',
        paymentIntentId,
        'stripe',
        paymentIntentId,
        payment_method,
        'succeeded',
        JSON.stringify(metadata)
      ]
    );

    const paymentId = insertResult.rows[0].id;

    // Update participant_fee status
    const feeResult = await client.query(
      `SELECT
        total_amount,
        COALESCE(SUM(p.amount), 0) as total_paid
      FROM participant_fees pf
      LEFT JOIN payments p ON pf.id = p.participant_fee_id
      WHERE pf.id = $1
      GROUP BY pf.id, pf.total_amount`,
      [participant_fee_id]
    );

    if (feeResult.rows.length > 0) {
      const fee = feeResult.rows[0];
      const totalAmount = parseFloat(fee.total_amount);
      const totalPaid = parseFloat(fee.total_paid);

      let newStatus = 'unpaid';
      if (totalPaid >= totalAmount) {
        newStatus = 'paid';
      } else if (totalPaid > 0) {
        newStatus = 'partial';
      }

      await client.query(
        'UPDATE participant_fees SET status = $1 WHERE id = $2',
        [newStatus, participant_fee_id]
      );

      logger.info(`Updated participant_fee ${participant_fee_id} status to: ${newStatus}`);
    }

    await client.query('COMMIT');

    logger.info(`Payment recorded successfully: payment_id=${paymentId}, amount=$${paymentAmount}, participant_fee_id=${participant_fee_id}`);

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error handling payment success:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailure(paymentIntent, pool, logger) {
  const { id: paymentIntentId, last_payment_error } = paymentIntent;

  logger.warn(`Payment failed for PaymentIntent: ${paymentIntentId}`, {
    error: last_payment_error?.message,
    code: last_payment_error?.code,
  });

  // Could add logic here to notify the user, update status, etc.
}

/**
 * Handle canceled payment
 */
async function handlePaymentCanceled(paymentIntent, pool, logger) {
  const { id: paymentIntentId } = paymentIntent;

  logger.info(`Payment canceled for PaymentIntent: ${paymentIntentId}`);

  // Could add logic here to clean up any pending records
}
