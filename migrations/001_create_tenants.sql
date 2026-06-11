-- 001_create_tenants.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  project_key  TEXT UNIQUE NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'free',
  upstream_url TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_project_key ON tenants(project_key);
CREATE INDEX idx_tenants_email ON tenants(email);
