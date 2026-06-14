-- 005_create_subscriptions.sql
-- Tracks Razorpay subscription state per tenant for autopay billing.

-- Add razorpay_customer_id to tenants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'razorpay_customer_id'
  ) THEN
    ALTER TABLE tenants ADD COLUMN razorpay_customer_id TEXT;
  END IF;
END $$;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  razorpay_sub_id  TEXT UNIQUE NOT NULL,
  razorpay_plan_id TEXT NOT NULL,
  plan             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'created',
  current_start    TIMESTAMPTZ,
  current_end      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay ON subscriptions(razorpay_sub_id);
