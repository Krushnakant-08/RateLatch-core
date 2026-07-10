-- 004_create_owner_account.sql
-- Creates the platform owner/admin account
-- Default credentials:
--   Email:    krushnakantpatil06@gmail.com
--   Password: admin123  (change immediately after first login)
--
-- The password_hash below is bcrypt(admin123, 12 rounds).
-- To generate a new hash: node -e "const b=require('bcrypt'); b.hash('yourpassword',12).then(console.log)"

INSERT INTO tenants (email, project_key, password_hash, plan, upstream_url, role, status)
VALUES (
  'krushnakantpatil06@gmail.com',
  'rl_admin_master',
  '$2b$12$X6/JLdY1CSKC8QJoBBrvzu1cT63WifyJi4ZOgw500kj3DBhkmps0y',
  'enterprise',
  'https://localhost',
  'owner',
  'active'
)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      plan = EXCLUDED.plan,
      updated_at = now();
