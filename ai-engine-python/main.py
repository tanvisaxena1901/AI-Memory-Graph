import logging
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException

from embeddings import EmbeddingModel
from models import (
    BenchmarkReport,
    BenchmarkResult,
    AccessRole,
    AuditEvent,
    CausalityGraph,
    GraphInsightReport,
    GraphTraversalRequest,
    IndexIncidentRequest,
    MemoryFeedbackRequest,
    PostmortemDraft,
    RagTrace,
    ReasoningTraceReplay,
    RcaEvaluationReport,
    RcaEvaluationRequest,
    RcaRequest,
    RcaResponse,
    ReembeddingReport,
    RetrievalEvaluationReport,
    SemanticSearchRequest,
    SimilarIncident,
    SyntheticDatasetReport,
    TelemetryCausalityRequest,
)
from rca_engine import RcaGenerator
from retrieval import IncidentMemoryStore
from retrieval.graph_repository import GraphRepository

logging.basicConfig(level=logging.INFO)
structlog.configure(processors=[structlog.processors.JSONRenderer()])

app = FastAPI(
    title="AEGIS AI Engine",
    version="0.1.0",
    description="Embedding, semantic retrieval, graph memory, and RCA service for AEGIS.",
)

embedding_model = EmbeddingModel()
memory_store = IncidentMemoryStore()
graph_repository = GraphRepository()
rca_generator = RcaGenerator()
memory_store.index_seed_memories(embedding_model.encode)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/incidents/index", status_code=202)
def index_incident(request: IndexIncidentRequest) -> dict[str, str]:
    logs = request.logs or []
    telemetry = request.telemetry or {}
    text = memory_store.incident_text(request.incident, logs, telemetry)
    embedding = embedding_model.encode(text)
    memory_store.index_incident(request.incident, logs, telemetry, embedding)
    graph_repository.upsert_incident(request.incident)
    return {"status": "indexed", "incidentId": request.incident.incidentId}


@app.post("/semantic-search", response_model=list[SimilarIncident])
def semantic_search(request: SemanticSearchRequest) -> list[SimilarIncident]:
    embedding = embedding_model.encode(request.query)
    return memory_store.search(
        embedding,
        request.service,
        request.limit,
        severity=request.severity,
        telemetry=request.telemetry,
        memory_types=request.memoryTypes,
        tenant_id=request.tenantId,
        team_id=request.teamId,
        requested_by=request.requestedBy,
        role=request.role,
        query_text=request.query,
    )


@app.post("/api/v1/memory/search", response_model=list[SimilarIncident])
def memory_search(request: SemanticSearchRequest) -> list[SimilarIncident]:
    return semantic_search(request)


@app.post("/rca", response_model=RcaResponse)
async def rca(request: RcaRequest) -> RcaResponse:
    embedding = embedding_model.encode(request.query)
    similar = memory_store.search(
        embedding,
        None,
        5,
        telemetry=request.telemetry,
        tenant_id=request.tenantId,
        team_id=request.teamId,
        requested_by=request.requestedBy,
        role=request.role,
        query_text=request.query,
    )
    response = await rca_generator.generate(request, similar)
    response.confidence = round(min(max(similar[0].rankScore if similar else 0.45, 0.35), 0.95), 2)
    response.traceId = memory_store.latest_trace_id()
    memory_store.append_reasoning_event(
        response.traceId,
        step="RCA_GENERATION",
        detail="Generated RCA from current evidence, retrieved memories, and telemetry context.",
        incident_id=request.incidentId,
        service=similar[0].service if similar else None,
        inputs={"query": request.query, "logCount": len(request.logs or [])},
        outputs={"likelyRootCause": response.likelyRootCause, "confidence": response.confidence},
        duration_ms=42,
    )
    return response


@app.post("/api/v1/memory/feedback")
def memory_feedback(request: MemoryFeedbackRequest) -> dict[str, Any]:
    return memory_store.record_feedback(request)


@app.post("/api/v1/rca/evaluate", response_model=RcaEvaluationReport)
def evaluate_rca(request: RcaEvaluationRequest) -> RcaEvaluationReport:
    return memory_store.evaluate_rca(request)


@app.get("/api/v1/graph/incidents")
def graph_incidents(rootCause: str, service: str | None = None) -> list[dict[str, str]]:
    return graph_repository.find_incidents_by_cause(service, rootCause)


@app.get("/api/v1/graph/insights", response_model=GraphInsightReport)
def graph_insights(tenantId: str = "default") -> GraphInsightReport:
    return memory_store.graph_insights(tenantId)


@app.post("/api/v1/graph/causality", response_model=CausalityGraph)
def build_causality_graph(request: TelemetryCausalityRequest) -> CausalityGraph:
    graph = graph_repository.build_causality_graph(request)
    memory_store.append_reasoning_event(
        memory_store.latest_trace_id(),
        step="GRAPH_CAUSALITY",
        detail="Built telemetry causality graph from metrics, logs, events, and deployment context.",
        incident_id=graph.incidentId,
        service=request.service,
        inputs={"telemetryKeys": list(request.telemetry.keys()), "eventCount": len(request.events)},
        outputs={"nodes": len(graph.nodes), "edges": len(graph.edges), "blastRadius": graph.blastRadius},
        duration_ms=18,
    )
    return graph


@app.get("/api/v1/graph/causality", response_model=CausalityGraph)
def latest_causality_graph(incidentId: str | None = None) -> CausalityGraph:
    return graph_repository.latest_causality_graph(incidentId)


@app.post("/api/v1/graph/traverse", response_model=CausalityGraph)
def traverse_graph(request: GraphTraversalRequest) -> CausalityGraph:
    return graph_repository.traverse(request)


@app.post("/api/v1/memory/reembed", response_model=ReembeddingReport)
def reembed_memory() -> ReembeddingReport:
    return memory_store.reembed(embedding_model.encode)


@app.post("/api/v1/memory/synthetic-dataset", response_model=SyntheticDatasetReport)
def synthetic_dataset(count: int = 60) -> SyntheticDatasetReport:
    return memory_store.generate_synthetic_dataset(embedding_model.encode, count)


@app.get("/api/v1/evaluation/retrieval", response_model=RetrievalEvaluationReport)
def retrieval_evaluation(k: int = 5) -> RetrievalEvaluationReport:
    return memory_store.retrieval_evaluation(embedding_model.encode, k)


@app.get("/api/v1/audit/events", response_model=list[AuditEvent])
def audit_events() -> list[AuditEvent]:
    return memory_store.audit_events()


@app.get("/api/v1/rag/traces", response_model=list[RagTrace])
def rag_traces() -> list[RagTrace]:
    return memory_store.rag_traces()


@app.get("/api/v1/reasoning/traces/{trace_id}/replay", response_model=ReasoningTraceReplay)
def reasoning_trace_replay(trace_id: str) -> ReasoningTraceReplay:
    replay = memory_store.reasoning_replay(trace_id)
    if replay is None:
        raise HTTPException(status_code=404, detail="reasoning trace not found")
    return replay


@app.get("/api/v1/postmortems/{incident_id}", response_model=PostmortemDraft)
def postmortem(incident_id: str, tenantId: str = "default") -> PostmortemDraft:
    draft = memory_store.postmortem(incident_id, tenantId)
    if draft is None:
        raise HTTPException(status_code=404, detail="incident memory not found")
    return draft


@app.get("/api/v1/benchmarks/incident-similarity", response_model=BenchmarkReport)
def incident_similarity_benchmark(k: int = 3) -> BenchmarkReport:
    cases = [
        ("payment timeout after deployment", "INC-BENCH-REDIS-POOL", "payment-service", "HIGH"),
        ("orders consumer lag after rollout", "INC-BENCH-KAFKA-LAG", "orders-service", "MEDIUM"),
        ("checkout crashloop oom memory pressure", "INC-BENCH-OOM", "checkout-service", "CRITICAL"),
        ("billing db connection pool exhausted", "INC-BENCH-DB-CONNECTIONS", "billing-service", "HIGH"),
    ]
    results: list[BenchmarkResult] = []
    for query, expected, service, severity in cases:
        embedding = embedding_model.encode(query)
        matches = memory_store.search(
            embedding,
            service,
            max(k, 5),
            severity=severity,
            role=AccessRole.PLATFORM_ADMIN,
            query_text=query,
        )
        top_match = matches[0] if matches else None
        top_k = matches[:k]
        top_five = matches[:5]
        expected_in_top_k = any(match.incidentId == expected for match in top_k)
        expected_in_top_five = any(match.incidentId == expected for match in top_five)
        expected_match = next((match for match in matches if match.incidentId == expected), top_match)
        results.append(
            BenchmarkResult(
                query=query,
                expectedIncidentId=expected,
                topMatchIncidentId=top_match.incidentId if top_match else None,
                topKHit=expected_in_top_k,
                recallAt5Hit=expected_in_top_five,
                similarityScore=expected_match.similarityScore if expected_match else 0.0,
            )
        )
    total = len(results) or 1
    return BenchmarkReport(
        cases=results,
        topKAccuracy=sum(1 for result in results if result.topKHit) / total,
        recallAt5=sum(1 for result in results if result.recallAt5Hit) / total,
        averageSimilarityScore=sum(result.similarityScore for result in results) / total,
    )
