# AI Memory Graph - Telemetry Analysis

AEGIS, short for Autonomous Execution, Graph Intelligence and Stateful Runtime, is an AI-native incident analysis platform. It turns raw telemetry, incidents, and historical memory into a working operational graph so an operator can ask what happened, why it happened, what similar incidents look like, and what to fix first.

The project combines four things:

- incident memory search across episodic incidents, semantic failure patterns, and procedural runbooks
- telemetry ingestion for metrics, logs, and traces
- causality graph generation and traversal for incident lineage
- RCA generation with evidence, remediation, trace replay, and feedback loops

## What It Does

AEGIS is designed for infrastructure and platform teams that need faster incident triage with more context than a plain log search or dashboard can provide.

It helps you:

- identify likely root cause from current logs, telemetry, and similar incidents
- compare a live incident with historical failures
- build and inspect a causality graph for dependencies, deployment changes, and signals
- feed telemetry into a shared incident memory store
- generate postmortem-friendly RCA summaries and remediation steps
- replay reasoning traces so the analysis is explainable

## How It Works

At a high level:

1. The dashboard captures the current incident context.
2. The API gateway receives incident, memory, graph, and RCA requests.
3. The AI engine embeds the query, searches OpenSearch memory, and consults Neo4j graph data.
4. Telemetry flows through the telemetry service and OpenTelemetry Collector.
5. The dashboard renders RCA, graph, memory, and reasoning views from those APIs.

When Ollama is available, the Python AI engine can use it for generated RCA text. When it is not, the engine still produces an incident-aware RCA from telemetry, logs, and retrieved memory.

## Architecture

```text
React dashboard
  -> Spring WebFlux API gateway
      -> PostgreSQL incident metadata
      -> Python AI engine
          -> OpenSearch incident memory
          -> Neo4j operational graph
      -> Telemetry service
          -> OpenTelemetry Collector
          -> Prometheus / Grafana
```

Main runtime pieces:

- `frontend/dashboard` - the React UI for incident analysis, memory search, graph inspection, RCA chat, and reasoning replay
- `backend-java/api-gateway` - the public incident and analysis API
- `backend-java/telemetry-service` - telemetry ingestion and normalization
- `ai-engine-python` - embeddings, retrieval, graph-aware RCA, evaluation, and synthetic dataset generation
- `infra/docker` - local Compose stack for the full system

## Repository Layout

```text
backend-java/
  api-gateway/          Spring WebFlux incident/RCA API
  telemetry-service/    telemetry ingestion and normalization service
  workflow-runtime/     workflow runtime stub
  common-lib/           shared domain contracts
ai-engine-python/
  embeddings/           sentence-transformer embeddings
  retrieval/            OpenSearch memory and Neo4j graph storage
  rca_engine/           RCA generation
  langgraph_workflows/  workflow stubs
frontend/
  dashboard/            React + TypeScript + Tailwind dashboard
infra/
  docker/               local Compose stack and Dockerfiles
  otel/                 OpenTelemetry Collector config
  kubernetes/           starter Kubernetes manifests
  helm/                 chart placeholder
docs/                   architecture, API, roadmap, telemetry notes
```

## Install And Run

### Option 1: Full Stack With Docker

This is the easiest way to run the whole project.

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

That starts:

- PostgreSQL on `5432`
- OpenSearch on `9200`
- Neo4j on `7687`
- AI engine on `8000`
- API gateway on `8080`
- telemetry service on `8081`
- OpenTelemetry Collector on `4317` / `4318`

Open the dashboard in a separate terminal:

```bash
cd frontend/dashboard
npm install
npm run dev
```

Then visit:

- dashboard: `http://localhost:5174`
- API gateway Swagger UI: `http://localhost:8080/swagger-ui.html`
- AI engine docs: `http://localhost:8000/docs`
- telemetry service health: `http://localhost:8081/actuator/health`

### Option 2: Local Development Without Docker

Use this if you want to work on one layer at a time.

Prerequisites:

- Node.js 18+ for the dashboard
- Java 21+ for the Spring services
- Python 3.12+ and `uv` for the AI engine
- PostgreSQL, OpenSearch, and Neo4j available locally or through Docker

Run the AI engine:

```bash
cd ai-engine-python
uv sync
uv run uvicorn main:app --reload --port 8000
```

Run the API gateway:

```bash
./gradlew :backend-java:api-gateway:bootRun
```

Run the telemetry service:

```bash
./gradlew :backend-java:telemetry-service:bootRun
```

Run the dashboard:

```bash
cd frontend/dashboard
npm install
npm run dev
```

## Configuration

Copy the example environment file before running the stack locally or in production:

```bash
cp .env.example .env
```

Important values from `.env.example`:

- `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `AI_ENGINE_BASE_URL`
- `AEGIS_ALLOWED_ORIGINS`
- `AEGIS_OPENSEARCH_URL`
- `AEGIS_NEO4J_URI`, `AEGIS_NEO4J_USER`, `AEGIS_NEO4J_PASSWORD`
- `AEGIS_USE_OLLAMA`, `AEGIS_OLLAMA_URL`, `AEGIS_OLLAMA_MODEL`
- `VITE_API_BASE_URL`, `VITE_TELEMETRY_API_BASE_URL` for the dashboard build

If you enable Ollama, the AI engine will try to use it for generated RCA text. If it is disabled or unavailable, the engine still returns an RCA from the live incident context and retrieved memory.

## How To Use It

1. Open the dashboard.
2. Load or select an incident.
3. Run RCA to see likely cause, evidence, and remediation.
4. Search memory to find related historical incidents.
5. Build the graph to inspect service and signal lineage.
6. Replay reasoning to inspect how the answer was assembled.
7. Use the synthetic incident flow to seed test data and drive the platform end to end.

Useful API examples:

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

```bash
curl -X POST http://localhost:8080/api/v1/memory/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "payment timeout after deployment",
    "service": "payment-service",
    "tenantId": "tenant-1",
    "teamId": "payments",
    "requestedBy": "operator-1",
    "role": "responder",
    "severity": "HIGH",
    "limit": 5,
    "telemetry": {"redis_latency_ms": 900, "error_rate": 0.2},
    "memoryTypes": ["episodic", "semantic", "procedural"]
  }'
```

```bash
curl -X POST http://localhost:8080/api/v1/rca \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentId": "INC-1001",
    "query": "Redis latency after deployment",
    "logs": ["redis timeout after 500ms"],
    "telemetry": {"redis_latency_ms": 820}
  }'
```

## Synthetic Traffic And Demo Flow

AEGIS includes a synthetic incident pipeline so you can demo the platform without wiring a real production system.

Generate a synthetic incident payload:

```bash
curl 'http://localhost:8080/api/v1/synthetic/incidents/next?tenantId=synthetic&profile=incident-management'
```

Seed memory with synthetic historical incidents:

```bash
curl -X POST 'http://localhost:8080/api/v1/memory/synthetic-dataset?count=60'
```

Run the synthetic incident stream:

```bash
docker compose -f infra/docker/docker-compose.yml --profile synthetic run --rm synthetic-incidents
```

If you also want observability:

```bash
docker compose -f infra/docker/docker-compose.yml --profile observability up --build
```

Useful observability URLs:

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`
- API gateway metrics: `http://localhost:8080/actuator/prometheus`
- telemetry service metrics: `http://localhost:8081/actuator/prometheus`
- recent telemetry: `http://localhost:8081/api/v1/telemetry/recent`

## Production Hosting

The dashboard can be hosted statically, but the backend stack needs a real host.

The production Compose file in `infra/docker/docker-compose.prod.yml` uses Caddy for HTTPS and routes:

- `/api/*` to the API gateway
- `/api/v1/telemetry*` to the telemetry service

Before publishing the dashboard, set the frontend build variables:

```bash
gh variable set VITE_API_BASE_URL --body https://api.example.com
gh variable set VITE_TELEMETRY_API_BASE_URL --body https://api.example.com
```

## Why This Project Is Useful

- It shortens triage by bringing memory, telemetry, and graph context into one place.
- It makes RCA explanations auditable instead of opaque.
- It lets teams compare a live incident against known failure patterns.
- It supports synthetic testing, so you can validate workflows without waiting for production traffic.
- It gives you a single workflow from detection to remediation, instead of separate tools for search, graphs, and postmortems.

## Further Reading

- [Architecture notes](docs/architecture.md)
- [API reference](docs/api.md)
- [Telemetry guide](docs/telemetry.md)
- [Roadmap](docs/roadmap.md)
