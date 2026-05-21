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

`POST /api/v1/memory/search`

```json
{
  "query": "payment timeout after deployment",
  "tenantId": "tenant-1",
  "teamId": "payments",
  "requestedBy": "operator-1",
  "role": "responder",
  "service": "payment-service",
  "severity": "HIGH",
  "limit": 5,
  "telemetry": {
    "redis_latency_ms": 900,
    "error_rate": 0.2
  },
  "memoryTypes": ["episodic", "semantic", "procedural"]
}
```

Returns ranked incident memory from OpenSearch vector search or the in-memory fallback.
Ranking combines semantic similarity, recency, service match, severity match, telemetry
signal overlap, remediation success, and operator feedback.

The legacy `POST /api/v1/semantic-search` endpoint is still available for basic semantic
retrieval.

Example result fields:

```json
{
  "incidentId": "INC-BENCH-REDIS-POOL",
  "service": "payment-service",
  "severity": "HIGH",
  "summary": "Payment requests timed out after deployment because Redis connection pool exhausted.",
  "score": 0.89,
  "similarityScore": 0.76,
  "rankScore": 0.89,
  "memoryType": "episodic",
  "memorySchemaVersion": "v1",
  "embeddingModel": "sentence-transformers/all-MiniLM-L6-v2",
  "embeddingVersion": "2026-05",
  "ttlTier": "hot",
  "qualityScore": 1.0,
  "duplicateOf": null,
  "cluster": "redis-saturation",
  "runbookRef": "redis-pool-exhaustion.yaml",
  "rootCause": "Redis pool exhaustion caused request timeouts after a payment-service deployment.",
  "remediation": ["Increase Redis pool max connections after checking server capacity."],
  "telemetrySignals": {
    "latency_spike": 2100,
    "error_rate": 0.22,
    "redis_saturation": 920
  },
  "rankingSignals": {
    "similarity": 0.76,
    "recency": 0.84,
    "service": 1.0,
    "severity": 1.0,
    "successful_fix_boost": 1.0,
    "feedback": 0.5,
    "telemetry": 1.0,
    "quality": 1.0,
    "ttl": 1.0
  }
}
```

Access is tenant-scoped for `viewer` and `responder`. `platform-admin` and `auditor`
can query across tenants for platform operations and review workflows.

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

## Human Feedback Loop

`POST /api/v1/memory/feedback`

```json
{
  "incidentId": "INC-1001",
  "tenantId": "tenant-1",
  "actorId": "operator-1",
  "helpful": true,
  "correctRca": true,
  "remediationWorked": true,
  "actionTaken": "rolled back payment-service v2.3",
  "notes": "Matched the Redis pool issue from the previous rollout."
}
```

Feedback is retained by the AI engine and contributes to future memory ranking.

## RCA Evaluation

`POST /api/v1/rca/evaluate`

```json
{
  "incidentId": "INC-1001",
  "tenantId": "tenant-1",
  "aiRootCause": "Redis saturation after deployment.",
  "humanRootCause": "Redis connection pool exhaustion after payment deployment.",
  "aiRemediation": ["Inspect Redis connection pool saturation."],
  "humanRemediation": ["Increase Redis pool max connections and roll back retry amplification."],
  "aiConfidence": 0.82,
  "humanConfirmed": false
}
```

Returns an accuracy-style report with root-cause match, remediation overlap, and overall
accuracy score. If AI confidence and human outcome are supplied, it also returns a
confidence calibration error.

## Memory Operations

Re-embed all stale memories after an embedding model/schema version change:

```text
POST /api/v1/memory/reembed
```

Generate a synthetic demo dataset across Redis saturation, OOMKilled, Kafka lag,
database connection exhaustion, and probe failure families:

```text
POST /api/v1/memory/synthetic-dataset?count=60
```

Inspect retrieval quality:

```text
GET /api/v1/evaluation/retrieval?k=5
```

Returns precision@5, recall@5, MRR, and hit rate.

## Audit And Traces

```text
GET /api/v1/audit/events
GET /api/v1/rag/traces
```

Audit events track who searched memory, which incidents were retrieved, the recommendation,
and follow-up action metadata. RAG traces expose the memories used in an RCA/search path and
whether cold-start fallback sources were used.

## Postmortems

```text
GET /api/v1/postmortems/{incidentId}?tenantId=tenant-1
```

Returns a draft with summary, timeline, impact, root cause, detection gap, remediation, and
follow-ups.

## Incident Similarity Benchmark

`GET /api/v1/benchmarks/incident-similarity?k=3`

Returns benchmark cases, top-k accuracy, recall@5, and average similarity score for the
seed incident memory dataset.

## Graph RCA Query

`GET /api/v1/graph/incidents?service=payment-service&rootCause=Redis%20saturation`

Uses the Neo4j relationship model:

```text
Service -> Deployment -> Incident -> RootCause -> Remediation
```

Graph summary questions:

```text
GET /api/v1/graph/insights?tenantId=tenant-1
```

Returns services that repeatedly fail after deployments, recurring root causes, and
remediations that worked most often.

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
