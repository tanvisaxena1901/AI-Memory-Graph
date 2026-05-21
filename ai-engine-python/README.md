# AEGIS AI Engine

FastAPI service responsible for:

- generating incident embeddings with `sentence-transformers`
- indexing incident memory in OpenSearch
- retrieving ranked memory across episodic incidents, semantic failure patterns, and procedural runbooks
- storing operational relationships in Neo4j, including root cause and remediation nodes
- normalizing telemetry into memory signals for latency, errors, restarts, CPU, memory, Kafka, DB, and Redis issues
- stamping memories with schema version, embedding model/version, TTL tier, quality score, tenant/team ownership, duplicate links, clusters, and runbook references
- redacting secrets and PII from logs before storage
- recording human feedback and RCA evaluation reports
- serving incident similarity and retrieval evaluation benchmarks
- generating synthetic incidents and postmortem drafts
- exposing audit events and RAG traces for explainability
- producing basic RCA summaries from telemetry and retrieved memory
- providing the future home for LangGraph workflows

Run locally:

```bash
uv sync
uv run uvicorn main:app --reload --port 8000
```

The engine prefers real OpenSearch and Neo4j connections, but keeps an in-process memory fallback for early API development when dependencies are not running.

Key endpoints:

```text
POST /api/v1/memory/search
POST /api/v1/memory/feedback
POST /api/v1/memory/reembed
POST /api/v1/memory/synthetic-dataset?count=60
POST /api/v1/rca/evaluate
GET  /api/v1/benchmarks/incident-similarity
GET  /api/v1/evaluation/retrieval
GET  /api/v1/audit/events
GET  /api/v1/rag/traces
GET  /api/v1/postmortems/{incidentId}
GET  /api/v1/graph/insights
GET  /api/v1/graph/incidents?service=payment-service&rootCause=Redis
```
