# Roadmap

## Phase 1: Operational Memory MVP

- Incident ingestion API
- PostgreSQL metadata persistence
- Sentence-transformer embeddings
- OpenSearch vector search
- Neo4j incident/service/deployment graph
- Basic RCA generation
- OpenTelemetry Collector local ingestion surface

## Phase 2: Kubernetes Intelligence

- Kubernetes Java Client watchers
- Pod event ingestion
- CrashLoopBackOff and OOMKilled detectors
- Deployment change capture
- Fluent Bit log ingestion
- OpenTelemetry OTLP payload normalization into metric points, logs, and spans

## Phase 3: Stateful AI Runtime

- LangGraph incident investigation workflow
- Fetch logs, fetch metrics, retrieve memory, analyze deployment changes, generate RCA
- Retry policies
- Workflow state persistence in PostgreSQL
- Workflow trace API and dashboard view

## Phase 4: Predictive Intelligence

- anomaly detection over telemetry baselines
- graph traversal based blast-radius analysis
- remediation planning
- deployment risk scoring
- incident recurrence prediction
