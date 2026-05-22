# AEGIS Architecture

## Purpose

AEGIS provides stateful operational memory for infrastructure systems. It turns telemetry, incidents, deployments, logs, and historical RCA into retrievable memory and graph relationships that autonomous workflows can use.

## Phase 1 Runtime

```text
Operator / Tooling
      |
      v
Spring WebFlux API Gateway
      |                         \
      v                          v
PostgreSQL metadata        Python AI Engine
                                  |
                       +----------+----------+
                       v                     v
                 OpenSearch vectors       Neo4j graph

OpenTelemetry Collector
      |
      v
Telemetry Service
```

## Data Flow

1. `POST /api/v1/incidents` accepts incident, log, telemetry, and deployment context.
2. Java persists normalized incident metadata in PostgreSQL.
3. Java asynchronously calls the Python AI engine.
4. Python creates an embedding from summary, logs, telemetry, and deployment metadata.
5. Python normalizes telemetry into incident-memory signals such as latency spike, error rate, restart count, CPU throttling, memory pressure, Kafka lag, DB connection usage, and Redis saturation.
6. Python redacts secrets/PII from logs before storage.
7. Python stamps each memory with schema version, embedding model, embedding version, tenant/team ownership, TTL tier, quality score, duplicate link, and incident cluster.
8. Python indexes episodic incident memory in OpenSearch alongside semantic failure patterns and procedural runbooks.
9. Python upserts service, deployment, incident, root-cause, and remediation relationships in Neo4j.
10. Memory search and RCA endpoints retrieve related memory and generate analysis.
11. Telemetry causality graph APIs derive deployment, signal, fault, service, and incident relationships for Neo4j traversal.
12. Reasoning trace replay records query embedding, memory retrieval, graph causality, and RCA generation events.
13. Operator feedback and human-confirmed RCA reports update future ranking, calibration, audit, and evaluation metrics.

## Telemetry Flow

1. Services, hosts, or Kubernetes components emit OTLP metrics, logs, and traces.
2. OpenTelemetry Collector receives OTLP on `4317` or `4318`.
3. The Collector batches and enriches telemetry with resource attributes.
4. The Collector exports OTLP HTTP batches to `telemetry-service` at `/v1/metrics`, `/v1/logs`, and `/v1/traces`.
5. AEGIS records batch metadata and exposes recent telemetry/stats APIs.
6. Incident ingestion and RCA requests normalize telemetry values into anomaly signals used by memory search and ranking.

## Memory Model

```text
episodic memory   -> past incidents with logs, telemetry, RCA, and outcomes
semantic memory   -> known failure patterns such as Redis saturation or Kafka lag
procedural memory -> runbooks and remediation steps
```

Ranking is a weighted blend of semantic similarity, recency, service match, severity match,
telemetry-signal overlap, successful remediation, memory quality, TTL tier, and human feedback.

Every memory stores:

```text
memorySchemaVersion=v1
embeddingModel=sentence-transformers/all-MiniLM-L6-v2
embeddingVersion=2026-05
ttlTier=hot|warm|archived
qualityScore=0.0..1.0
tenantId/teamId/serviceOwner
duplicateOf
cluster
runbookRef
```

When the embedding model or schema changes, `POST /api/v1/memory/reembed` refreshes stored
memory embeddings and version metadata.

## Governance

Tenant-scoped roles (`viewer`, `responder`) only retrieve memory from their tenant and optional
team scope. Platform roles (`platform-admin`, `auditor`) can inspect across tenants for platform
operations and review workflows.

Before logs are embedded or stored, the memory layer redacts API keys, tokens, JWTs, passwords,
emails, and account/card-like numbers.

Audit and RAG trace records make retrieval explainable:

```text
who searched -> query -> retrieved memories -> recommendation -> action taken
```

Reasoning replay adds workflow-level observability:

```text
query embedding -> memory retrieval -> graph causality -> RCA generation -> replay timeline
```

## Domain Graph

```text
(Service)-[:EXPERIENCED]->(Incident)
(Deployment)-[:PRECEDED]->(Incident)
(Incident)-[:CAUSED_BY]->(RootCause)
(Incident)-[:MITIGATED_BY]->(Remediation)
```

This supports graph RCA questions such as:

```text
Show all incidents caused by Redis saturation in payment services.
Service -> Deployment -> Incident -> RootCause -> Remediation
```

Telemetry causality graphs also model live infrastructure chains:

```text
Deployment -> Service -> Telemetry Signal -> Fault -> Incident
Node pressure -> Pod evictions -> Kafka lag -> API timeout
```

The API can return the latest graph, build a graph from an incident payload, or traverse from any
node to estimate blast radius and recurring patterns.

## Aegis Integration

```text
Aegis detects Kubernetes issue
        |
        v
Aegis collects pod logs, events, rollout status, and telemetry
        |
        v
AI-Memory-Graph POST /api/v1/memory/search
        |
        v
LangGraph/RCA workflow combines current evidence with retrieved memory
        |
        v
Aegis displays RCA, remediation plan, and feedback controls
```

## Engineering Properties

- Event-driven ready: ingestion boundary is isolated from AI indexing.
- Async APIs: Spring WebFlux and non-blocking service contracts.
- Observability: Actuator, Prometheus endpoint, structured log patterns.
- Runtime separation: Java coordinates platform APIs; Python owns AI workflows.
- Storage separation: PostgreSQL for operational metadata, OpenSearch for vector memory, Neo4j for relationships.
