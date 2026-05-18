import logging

import structlog
from fastapi import FastAPI

from embeddings import EmbeddingModel
from models import IndexIncidentRequest, RcaRequest, RcaResponse, SemanticSearchRequest, SimilarIncident
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
    return memory_store.search(embedding, request.service, request.limit)


@app.post("/rca", response_model=RcaResponse)
async def rca(request: RcaRequest) -> RcaResponse:
    embedding = embedding_model.encode(request.query)
    similar = memory_store.search(embedding, None, 5)
    return await rca_generator.generate(request, similar)
