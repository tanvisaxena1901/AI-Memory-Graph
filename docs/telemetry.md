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
