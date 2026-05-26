# AEGIS

Autonomous Execution, Graph Intelligence & Stateful Runtime.

AEGIS is an AI-native operational memory platform for infrastructure systems. It ingests incidents and telemetry, stores semantic memory, builds an operational graph, retrieves similar incidents with vector search, and generates RCA/remediation suggestions.

This repository implements the Phase 1 MVP:

- incident ingestion API
- PostgreSQL incident metadata persistence
- Python embedding pipeline with `sentence-transformers`
- OpenSearch vector indexing and semantic retrieval
- incident similarity benchmark with top-k accuracy, recall@5, and similarity score
- explicit AI memory types: episodic incidents, semantic failure patterns, and procedural runbooks
- memory ranking by semantic similarity, recency, service, severity, remediation success, telemetry match, and human feedback
- memory schema and embedding model versioning for explainable retrieval after model changes
- re-embedding jobs for model/schema upgrades
- hot/warm/archived memory TTL tiers and memory quality scoring
- PII/secret redaction before logs are stored
- tenant/team/service-owner isolation and role-aware retrieval
- duplicate incident detection and incident-family clustering
- operator feedback capture for helpfulness, RCA correctness, and remediation outcome
- RCA evaluation reports comparing AI RCA against human-confirmed RCA
- audit trail, RAG trace viewer data, and postmortem draft generation
- telemetry causality graph build/traversal APIs for deployment, signal, fault, and incident lineage
- AI reasoning trace replay for memory retrieval, graph traversal, and RCA generation steps
- synthetic incident dataset generation and retrieval evaluation with precision@5, recall@5, MRR, and hit rate
- Neo4j operational graph writes
- OpenTelemetry Collector ingestion for metrics, logs, and traces with normalized incident telemetry signals
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

## Production Hosting

GitHub Pages hosts only the static React dashboard. The Java/Python backend services need a separate HTTPS host, such as a VPS running Docker Compose.

On a VPS, point a DNS record such as `api.example.com` to the server, copy this repository to the server, create a production env file, and start the backend stack:

```bash
cp .env.example .env
# edit .env with strong passwords and BACKEND_DOMAIN=api.example.com
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --build
```

The production Compose file uses Caddy for HTTPS and routes:

- `https://api.example.com/api/*` to the API gateway
- `https://api.example.com/api/v1/telemetry*` to the telemetry service

Set these GitHub repository variables before rebuilding GitHub Pages:

```bash
gh variable set VITE_API_BASE_URL --body https://api.example.com
gh variable set VITE_TELEMETRY_API_BASE_URL --body https://api.example.com
```

The backend CORS default allows `https://tanvisaxena1901.github.io`. Override it with `AEGIS_ALLOWED_ORIGINS` if you add more frontend origins.

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

## Synthetic Incident Traffic

For a realistic demo loop, use the synthetic incident API to generate incident-shaped payloads, then use k6 to drive telemetry ingestion, incident creation, RCA requests, memory searches, and causality graph builds.

This uses the open-source k6 CLI Docker image only. No k6 Cloud account or Grafana Cloud account is required.

Generate one synthetic workflow payload directly:

```bash
curl 'http://localhost:8080/api/v1/synthetic/incidents/next?tenantId=synthetic&profile=incident-management'
```

Start the backend plus Prometheus and Grafana:

```bash
docker compose -f infra/docker/docker-compose.yml --profile observability up --build
```

Then run the synthetic incident stream in another terminal:

```bash
docker compose -f infra/docker/docker-compose.yml --profile synthetic run --rm synthetic-incidents
```

Useful local URLs:

- dashboard: `http://localhost:5174`
- API gateway metrics: `http://localhost:8080/actuator/prometheus`
- telemetry service metrics: `http://localhost:8081/actuator/prometheus`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (`admin` / `admin` by default)
- recent telemetry: `http://localhost:8081/api/v1/telemetry/recent`

Tune the generator with env vars:

```bash
SYNTHETIC_VUS=8 SYNTHETIC_DURATION=15m SYNTHETIC_INCIDENT_RATE=0.5 \
  docker compose -f infra/docker/docker-compose.yml --profile synthetic run --rm synthetic-incidents
```

To seed historical memory before live simulation, call:

```bash
curl -X POST 'http://localhost:8080/api/v1/memory/synthetic-dataset?count=60'
```

The generated traffic is intentionally incident-shaped: the API produces noisy metric samples and workflow payloads, while k6 stores incidents, indexes memory, asks for RCA, and builds causality graphs. Prometheus/Grafana observe service health; k6 drives the incident workflow.

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
curl -X POST http://localhost:8080/api/v1/memory/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query":"payment timeout after deployment",
    "service":"payment-service",
    "tenantId":"tenant-1",
    "teamId":"payments",
    "requestedBy":"operator-1",
    "role":"responder",
    "severity":"HIGH",
    "limit":5,
    "telemetry":{"redis_latency_ms":900,"error_rate":0.2},
    "memoryTypes":["episodic","semantic","procedural"]
  }'
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

Operator feedback:

```bash
curl -X POST http://localhost:8080/api/v1/memory/feedback \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentId":"INC-1001",
    "tenantId":"tenant-1",
    "actorId":"operator-1",
    "helpful":true,
    "correctRca":true,
    "remediationWorked":true,
    "actionTaken":"rolled back payment-service v2.3"
  }'
```

Incident similarity benchmark:

```bash
curl http://localhost:8080/api/v1/benchmarks/incident-similarity
```

Graph RCA query:

```bash
curl 'http://localhost:8080/api/v1/graph/incidents?service=payment-service&rootCause=Redis%20saturation'
```

Build a telemetry causality graph:

```bash
curl -X POST http://localhost:8080/api/v1/graph/causality \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentId":"INC-1001",
    "service":"payment-service",
    "deploymentVersion":"v2.3",
    "telemetry":{"redis_latency_ms":900,"error_rate":0.18,"p95_latency_ms":1800},
    "logs":["redis timeout after 500ms","connection pool exhausted"],
    "events":["Deploy v2.3 completed"]
  }'
```

Operational AI-infra endpoints:

```bash
curl -X POST http://localhost:8080/api/v1/memory/reembed
curl -X POST 'http://localhost:8080/api/v1/memory/synthetic-dataset?count=60'
curl http://localhost:8080/api/v1/evaluation/retrieval
curl http://localhost:8080/api/v1/audit/events
curl http://localhost:8080/api/v1/rag/traces
curl http://localhost:8080/api/v1/reasoning/traces/{traceId}/replay
curl http://localhost:8080/api/v1/postmortems/INC-1001?tenantId=tenant-1
curl http://localhost:8080/api/v1/graph/insights?tenantId=tenant-1
```

## Platform Integration

AEGIS can call AI-Memory-Graph before generating an RCA:

```text
Aegis detects a Kubernetes issue
  -> collects pod logs, events, rollout status, and telemetry
  -> POST /api/v1/memory/search for similar historical incidents
  -> combines current evidence and retrieved memory in the RCA workflow
  -> shows root cause, evidence, and remediation with feedback controls
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
