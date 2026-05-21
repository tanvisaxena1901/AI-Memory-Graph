CREATE TABLE IF NOT EXISTS incidents (
    incident_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(120) NOT NULL DEFAULT 'default',
    team_id VARCHAR(120),
    service_owner VARCHAR(160),
    service VARCHAR(160) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    summary TEXT NOT NULL,
    deployment_version VARCHAR(120),
    timestamp TIMESTAMPTZ NOT NULL,
    root_cause TEXT,
    remediation TEXT,
    successful_remediation BOOLEAN,
    ai_confidence DOUBLE PRECISION,
    human_confirmed BOOLEAN,
    runbook_ref VARCHAR(240)
);

CREATE INDEX IF NOT EXISTS idx_incidents_service_timestamp
    ON incidents (service, timestamp DESC);

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS root_cause TEXT;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS remediation TEXT;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS successful_remediation BOOLEAN;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(120) NOT NULL DEFAULT 'default';

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS team_id VARCHAR(120);

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS service_owner VARCHAR(160);

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS ai_confidence DOUBLE PRECISION;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS human_confirmed BOOLEAN;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS runbook_ref VARCHAR(240);
