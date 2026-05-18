# AEGIS

Autonomous Execution, Graph Intelligence & Stateful Runtime.

AEGIS is an AI-native operational memory platform for infrastructure systems. It ingests incidents and telemetry, stores semantic memory, builds an operational graph, retrieves similar incidents with vector search, and generates RCA/remediation suggestions.

This repository implements the Phase 1 MVP:

- incident ingestion API
- PostgreSQL incident metadata persistence
- Python embedding pipeline with `sentence-transformers`
- OpenSearch vector indexing and semantic retrieval
- Neo4j operational graph writes
- OpenTelemetry Collector ingestion for metrics, logs, and traces
- basic AI RCA generation
- Dockerized local infrastructure
- React dashboard shell

## Repository Layout

```text
backend-java/
  api-gateway/          Spring WebFlux incident/RCA API
  telemetry-service/    telemetry ingestion stub for Phase 2
  workflow-runtime/     workflow runtime stub for Phase 3
  common-lib/           shared domain contracts
ai-engine-python/
  embeddings/           sentence-transformer embeddings
  retrieval/            OpenSearch memory and Neo4j graph storage
  rca_engine/           RCA generation
  langgraph_workflows/  Phase 3 LangGraph workflows
infra/
  docker/               local Compose stack and Dockerfiles
  otel/                 OpenTelemetry Collector config
  kubernetes/           starter K8s manifests
  helm/                 chart placeholder
frontend/
  dashboard/            React + TypeScript + Tailwind dashboard
docs/                   architecture, API, roadmap
```

## Run Locally

Start dependencies and services:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

API gateway:

- OpenAPI UI: `http://localhost:8080/swagger-ui.html`
- health: `http://localhost:8080/actuator/health`

AI engine:

- docs: `http://localhost:8000/docs`
- health: `http://localhost:8000/health`

Telemetry service:

- health: `http://localhost:8081/actuator/health`
- normalized telemetry: `POST http://localhost:8081/api/v1/telemetry`
- OTLP HTTP metrics: `POST http://localhost:8081/v1/metrics`
- OTLP HTTP logs: `POST http://localhost:8081/v1/logs`
- OTLP HTTP traces: `POST http://localhost:8081/v1/traces`
- recent telemetry: `http://localhost:8081/api/v1/telemetry/recent`

OpenTelemetry Collector:

- OTLP gRPC receiver: `localhost:4317`
- OTLP HTTP receiver: `localhost:4318`

## Example Incident

```bash
curl -X POST http://localhost:8080/api/v1/incidents \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentId": "INC-1001",
    "service": "payment-service",
    "severity": "HIGH",
    "summary": "Redis connection saturation after deployment",
    "deploymentVersion": "v2.3",
    "logs": ["redis timeout after 500ms", "connection pool exhausted"],
    "telemetry": {"redis_latency_ms": 820, "error_rate": 0.18}
  }'
```

Semantic retrieval:

```bash
curl -X POST http://localhost:8080/api/v1/semantic-search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Redis latency after deployment","limit":5}'
```

RCA:

```bash
curl -X POST http://localhost:8080/api/v1/rca \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentId":"INC-1001",
    "query":"Redis latency after deployment",
    "logs":["redis timeout after 500ms"],
    "telemetry":{"redis_latency_ms":820}
  }'
```

## Example Telemetry

```bash
curl -X POST http://localhost:8081/api/v1/telemetry \
  -H 'Content-Type: application/json' \
  -d '{
    "service": "payment-service",
    "source": "otel-collector",
    "values": {
      "p95_latency_ms": 1840,
      "error_rate": 18,
      "redis_latency_ms": 820
    }
  }'
```

OpenTelemetry Collector config lives at `infra/otel/otel-collector-config.yaml`.

## Phase Roadmap

Phase 1 is implemented as the MVP foundation. Phase 2 adds Kubernetes watchers, Fluent Bit/OpenTelemetry ingestion, and deployment intelligence. Phase 3 adds LangGraph orchestration, retries, and workflow persistence. Phase 4 adds anomaly detection, remediation planning, and graph traversal intelligence.
