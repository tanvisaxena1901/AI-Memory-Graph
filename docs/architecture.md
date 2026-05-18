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
5. Python indexes the incident and vector in OpenSearch.
6. Python upserts service, deployment, and incident relationships in Neo4j.
7. Semantic search and RCA endpoints retrieve related incidents and generate analysis.

## Telemetry Flow

1. Services, hosts, or Kubernetes components emit OTLP metrics, logs, and traces.
2. OpenTelemetry Collector receives OTLP on `4317` or `4318`.
3. The Collector batches and enriches telemetry with resource attributes.
4. The Collector exports OTLP HTTP batches to `telemetry-service` at `/v1/metrics`, `/v1/logs`, and `/v1/traces`.
5. AEGIS records batch metadata and exposes recent telemetry/stats APIs.
6. Later phases normalize OTLP payloads into anomaly signals, graph relationships, and incident memory.

## Domain Graph

```text
(Service)-[:EXPERIENCED]->(Incident)
(Deployment)-[:PRECEDED]->(Incident)
```

Future phases will extend this into:

```text
Deployment -> MemorySpike -> OOMKilled -> ConsumerLag -> ApiTimeout
```

## Engineering Properties

- Event-driven ready: ingestion boundary is isolated from AI indexing.
- Async APIs: Spring WebFlux and non-blocking service contracts.
- Observability: Actuator, Prometheus endpoint, structured log patterns.
- Runtime separation: Java coordinates platform APIs; Python owns AI workflows.
- Storage separation: PostgreSQL for operational metadata, OpenSearch for vector memory, Neo4j for relationships.
