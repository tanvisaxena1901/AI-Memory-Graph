# API Reference

## Ingest Incident

`POST /api/v1/incidents`

```json
{
  "incidentId": "INC-1001",
  "service": "payment-service",
  "severity": "HIGH",
  "summary": "Redis connection saturation",
  "deploymentVersion": "v2.3",
  "logs": ["redis timeout after 500ms"],
  "telemetry": {
    "redis_latency_ms": 820,
    "error_rate": 0.18
  }
}
```

Stores metadata in PostgreSQL, then indexes semantic memory in the AI engine.

## Search Incident Memory

`POST /api/v1/semantic-search`

```json
{
  "query": "Redis latency after deployment",
  "service": "payment-service",
  "limit": 5
}
```

Returns semantically similar incidents from OpenSearch vector search.

## Generate RCA

`POST /api/v1/rca`

```json
{
  "incidentId": "INC-1001",
  "query": "Redis latency after deployment",
  "logs": ["redis timeout after 500ms"],
  "telemetry": {
    "redis_latency_ms": 820
  }
}
```

Returns:

- concise summary
- likely root cause
- evidence
- remediation suggestions

## Service Ports

- API gateway: `8080`
- telemetry service: `8081`
- OpenTelemetry Collector OTLP gRPC: `4317`
- OpenTelemetry Collector OTLP HTTP: `4318`
- workflow runtime: `8082`
- AI engine: `8000`
- PostgreSQL: `5432`
- OpenSearch: `9200`
- Neo4j browser: `7474`

## Telemetry Ingestion

Normalized dashboard/development telemetry:

`POST /api/v1/telemetry`

```json
{
  "service": "payment-service",
  "source": "otel-collector",
  "values": {
    "p95_latency_ms": 1840,
    "error_rate": 18,
    "redis_latency_ms": 820
  }
}
```

Recent telemetry:

`GET /api/v1/telemetry/recent`

Telemetry stats:

`GET /api/v1/telemetry/stats`

OpenTelemetry Collector OTLP HTTP export targets:

```text
POST /v1/metrics
POST /v1/logs
POST /v1/traces
```
