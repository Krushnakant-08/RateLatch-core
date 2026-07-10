-- 006_add_password_to_tenants.sql
-- Add password_hash for email+password authentication.
-- Existing tenants will have NULL and must re-register or use a reset flow.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_hash TEXT;
