from models import AccessRole, GraphTraversalRequest, TelemetryCausalityRequest
from retrieval.incident_memory import IncidentMemoryStore
from retrieval.graph_repository import GraphRepository


def embed(text: str) -> list[float]:
    lower = text.lower()
    return [
        1.0 if "redis" in lower or "payment" in lower else 0.0,
        1.0 if "kafka" in lower or "orders" in lower else 0.0,
        1.0 if "oom" in lower or "memory" in lower or "checkout" in lower else 0.0,
        1.0 if "database" in lower or "billing" in lower else 0.0,
    ]


def test_seeded_incident_similarity_ranks_expected_payment_incident():
    store = IncidentMemoryStore()
    store.index_seed_memories(embed)

    results = store.search(
        embed("payment timeout after deployment"),
        "payment-service",
        3,
        severity="HIGH",
        telemetry={"redis_latency_ms": 900, "error_rate": 0.2},
    )

    assert results[0].incidentId == "INC-BENCH-REDIS-POOL"
    assert results[0].memoryType == "episodic"
    assert results[0].telemetrySignals["redis_saturation"] == 920
    assert results[0].rankingSignals["service"] == 1.0


def test_telemetry_normalization_extracts_operational_signals():
    signals = IncidentMemoryStore.normalize_telemetry(
        {
            "p95_latency_ms": 1800,
            "error_rate": 0.12,
            "restart_count": 2,
            "cpu_throttling_ratio": 0.3,
            "memory_working_set_ratio": 0.9,
            "kafka_lag": 5000,
            "db_connections_used": 95,
            "db_connections_max": 100,
        }
    )

    assert signals == {
        "latency_spike": 1800.0,
        "error_rate": 0.12,
        "restart_count": 2.0,
        "cpu_throttling": 0.3,
        "memory_pressure": 0.9,
        "kafka_lag": 5000.0,
        "db_connection_usage": 0.95,
    }


def test_redaction_tenant_filtering_quality_and_metadata():
    store = IncidentMemoryStore()
    store.generate_synthetic_dataset(embed, count=5)

    redacted = store.redact(
        "password=hunter2 token=abcdefghi user@example.com 4111 1111 1111 1111"
    )
    assert "hunter2" not in redacted
    assert "abcdefghi" not in redacted
    assert "user@example.com" not in redacted
    assert "4111 1111 1111 1111" not in redacted

    tenant_results = store.search(
        embed("redis pool exhausted"),
        None,
        10,
        tenant_id="tenant-1",
        role=AccessRole.VIEWER,
        query_text="redis pool exhausted",
    )
    assert tenant_results
    assert all(result.tenantId == "tenant-1" for result in tenant_results)
    assert tenant_results[0].memorySchemaVersion == "v1"
    assert tenant_results[0].embeddingVersion == "2026-05"
    assert tenant_results[0].ttlTier in {"hot", "warm", "archived"}
    assert 0 <= tenant_results[0].qualityScore <= 1


def test_synthetic_dataset_evaluation_audit_and_postmortem():
    store = IncidentMemoryStore()
    report = store.generate_synthetic_dataset(embed, count=10)
    assert report.generated == 10
    assert "redis-saturation" in report.clusters

    evaluation = store.retrieval_evaluation(embed)
    assert 0 <= evaluation.precisionAt5 <= 1
    assert 0 <= evaluation.mrr <= 1

    results = store.search(
        embed("payment redis timeout"),
        None,
        3,
        tenant_id="tenant-1",
        role=AccessRole.VIEWER,
        requested_by="operator-1",
        query_text="payment redis timeout",
    )
    assert results
    assert store.audit_events()[-1].actorId == "operator-1"
    assert store.rag_traces()

    draft = store.postmortem("SYN-0001", "tenant-1")
    assert draft is not None
    assert draft.incidentId == "SYN-0001"


def test_reasoning_trace_replay_records_retrieval_events():
    store = IncidentMemoryStore()
    store.index_seed_memories(embed)

    store.search(
        embed("payment redis timeout"),
        "payment-service",
        3,
        role=AccessRole.PLATFORM_ADMIN,
        requested_by="operator-1",
        query_text="payment redis timeout",
    )
    trace_id = store.latest_trace_id()
    store.append_reasoning_event(
        trace_id,
        step="RCA_GENERATION",
        detail="Generated test RCA.",
        incident_id="INC-BENCH-REDIS-POOL",
        service="payment-service",
    )

    replay = store.reasoning_replay(trace_id)
    assert replay is not None
    assert replay.workflowPath[:2] == ["QUERY_EMBEDDING", "MEMORY_RETRIEVAL"]
    assert replay.events[-1].step == "RCA_GENERATION"


def test_telemetry_causality_graph_and_traversal_fallback():
    graph_repository = GraphRepository()
    graph = graph_repository.build_causality_graph(
        TelemetryCausalityRequest(
            incidentId="INC-CAUSAL-1",
            service="payment-service",
            deploymentVersion="v2.3",
            telemetry={"redis_latency_ms": 900, "error_rate": 0.18, "p95_latency_ms": 1800},
            logs=["redis timeout after 500ms", "connection pool exhausted"],
            events=["Deploy v2.3 completed"],
        )
    )

    assert graph.incidentId == "INC-CAUSAL-1"
    assert any(node.kind == "signal" and node.label == "Redis saturation" for node in graph.nodes)
    assert any(edge.relationship == "CAUSED" for edge in graph.edges)
    assert "payment-service" in graph.blastRadius

    traversal = graph_repository.traverse(
        GraphTraversalRequest(startNodeId="service:payment-service", maxDepth=2)
    )
    assert traversal.nodes
    assert traversal.edges
