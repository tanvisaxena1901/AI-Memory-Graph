# Telemetry Ingestion

AEGIS accepts telemetry through two paths:

- normalized JSON events for dashboard and early local development
- OpenTelemetry Collector OTLP HTTP batches for metrics, logs, and traces

## OpenTelemetry Collector

The local Docker stack runs `otel/opentelemetry-collector-contrib` with:

- OTLP gRPC receiver on `4317`
- OTLP HTTP receiver on `4318`
- host metrics receiver for local CPU, memory, filesystem, and network telemetry
- OTLP HTTP exporter to `telemetry-service`

Configuration:

```text
infra/otel/otel-collector-config.yaml
```

Run:

```bash
docker compose -f infra/docker/docker-compose.yml up --build telemetry-service otel-collector
```

AEGIS telemetry service receives Collector exports at:

```text
POST http://localhost:8081/v1/metrics
POST http://localhost:8081/v1/logs
POST http://localhost:8081/v1/traces
```

These endpoints accept OTLP HTTP payloads from the Collector and record batch metadata. Full OTLP protobuf decoding into service-level metric points is the next implementation step.

## Incident Memory Normalization

When telemetry is attached to an incident or RCA request, the AI engine normalizes common
OpenTelemetry-style fields into memory-ranking signals:

| Signal | Example fields |
| --- | --- |
| `latency_spike` | `p95_latency_ms`, `latency_ms`, `http_server_duration_p95_ms` |
| `error_rate` | `error_rate`, `error_rate_pct` |
| `restart_count` | `restart_count`, `pod_restart_count` |
| `cpu_throttling` | `cpu_throttling_ratio`, `container_cpu_cfs_throttled_ratio` |
| `memory_pressure` | `memory_working_set_ratio`, `container_memory_usage_ratio` |
| `kafka_lag` | `kafka_lag`, `consumer_lag` |
| `db_connection_usage` | `db_connections_used` / `db_connections_max` |
| `redis_saturation` | `redis_latency_ms` |

These signals make memories telemetry-rich rather than plain text only. Memory search uses
signal overlap as one ranking feature alongside vector similarity, service, severity, recency,
remediation success, and human feedback.

The same normalized signals can build a causality graph:

```text
deployment change -> affected service -> telemetry signal -> fault -> incident
```

For example, `redis_latency_ms`, `error_rate`, and `p95_latency_ms` become Redis saturation and
API degradation nodes connected to the current incident. The graph can be traversed from any node
to estimate blast radius and recurring operational patterns.

## Normalized Telemetry API

Dashboard and development clients can post normalized events:

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

Inspect recent telemetry:

```bash
curl http://localhost:8081/api/v1/telemetry/recent
curl http://localhost:8081/api/v1/telemetry/stats
```

## Intended Flow

```text
Kubernetes / services / host
        |
        v
OpenTelemetry Collector
        |
        v
AEGIS telemetry-service
        |
        v
metric anomaly detection -> incident memory -> graph correlation -> RCA
```
