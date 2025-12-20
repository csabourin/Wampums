-- Migration: Add Stripe payment tracking fields
-- Description: Add fields to track Stripe payment intents and transaction IDs

-- Add Stripe-specific columns to payments table
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_payment_method_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_transaction_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_payment_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS stripe_metadata JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS payment_processor VARCHAR(50) DEFAULT 'manual';

-- Create index for faster Stripe payment intent lookups
CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent
ON payments(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

-- Create index for faster Stripe transaction lookups
CREATE INDEX IF NOT EXISTS idx_payments_stripe_transaction
ON payments(stripe_transaction_id)
WHERE stripe_transaction_id IS NOT NULL;

-- Add comment to payment_processor column
COMMENT ON COLUMN payments.payment_processor IS 'Payment processor used: manual, stripe, etc.';
COMMENT ON COLUMN payments.stripe_payment_intent_id IS 'Stripe PaymentIntent ID for tracking payments';
COMMENT ON COLUMN payments.stripe_payment_method_id IS 'Stripe PaymentMethod ID used for payment';
COMMENT ON COLUMN payments.stripe_transaction_id IS 'Stripe transaction/charge ID';
COMMENT ON COLUMN payments.stripe_payment_status IS 'Stripe payment status: requires_payment_method, requires_confirmation, requires_action, processing, requires_capture, canceled, succeeded';
COMMENT ON COLUMN payments.stripe_metadata IS 'Additional Stripe metadata and response data';
