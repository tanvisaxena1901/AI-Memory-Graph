# AEGIS AI Engine

FastAPI service responsible for:

- generating incident embeddings with `sentence-transformers`
- indexing incident memory in OpenSearch
- retrieving semantically similar incidents
- storing operational relationships in Neo4j
- producing basic RCA summaries from telemetry and retrieved memory
- providing the future home for LangGraph workflows

Run locally:

```bash
uv sync
uv run uvicorn main:app --reload --port 8000
```

The engine prefers real OpenSearch and Neo4j connections, but keeps an in-process memory fallback for early API development when dependencies are not running.
