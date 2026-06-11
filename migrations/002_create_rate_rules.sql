-- 002_create_rate_rules.sql
CREATE TABLE rate_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route       TEXT NOT NULL DEFAULT '*',
  key_by      TEXT NOT NULL DEFAULT 'ip',
  max_req     INT NOT NULL,
  window_ms   INT NOT NULL,
  priority    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_rules_tenant ON rate_rules(tenant_id, priority DESC);
