-- 003_create_usage_logs.sql
CREATE TABLE usage_logs (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hour       TIMESTAMPTZ NOT NULL,
  allowed    BIGINT NOT NULL DEFAULT 0,
  blocked    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, hour)
);

CREATE INDEX idx_usage_logs_tenant_hour ON usage_logs(tenant_id, hour DESC);
