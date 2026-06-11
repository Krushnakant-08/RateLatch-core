-- 004_create_owner_account.sql
-- Creates the platform owner/admin account
-- Default credentials:
--   Email:       admin@ratelimiter.io
--   Project Key: rl_admin_master_key

-- First, add a 'role' column to tenants if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'role'
  ) THEN
    ALTER TABLE tenants ADD COLUMN role TEXT NOT NULL DEFAULT 'tenant';
  END IF;
END $$;

-- Insert the owner account (skip if already exists)
INSERT INTO tenants (email, project_key, plan, upstream_url, role, status)
VALUES (
  'krushnakantpatil06@gmail.com',
  'master_key',
  'enterprise',
  'https://localhost',
  'owner',
  'active'
)
ON CONFLICT (email) DO NOTHING;
