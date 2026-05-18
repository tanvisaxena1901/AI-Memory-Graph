CREATE TABLE IF NOT EXISTS incidents (
    incident_id VARCHAR(64) PRIMARY KEY,
    service VARCHAR(160) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    summary TEXT NOT NULL,
    deployment_version VARCHAR(120),
    timestamp TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_service_timestamp
    ON incidents (service, timestamp DESC);
