import logging
from datetime import datetime
from typing import Any

import numpy as np

from config import settings
from models import Incident, SimilarIncident

log = logging.getLogger(__name__)


class IncidentMemoryStore:
    def __init__(self) -> None:
        self._client = self._build_client()
        self._fallback_docs: dict[str, dict[str, Any]] = {}
        self._ensure_index()

    def index_incident(
        self,
        incident: Incident,
        logs: list[str],
        telemetry: dict[str, Any],
        embedding: list[float],
    ) -> None:
        document = {
            "incidentId": incident.incidentId,
            "service": incident.service,
            "severity": incident.severity,
            "summary": incident.summary,
            "deploymentVersion": incident.deploymentVersion,
            "timestamp": incident.timestamp.isoformat(),
            "logs": logs,
            "telemetry": telemetry,
            "embedding": embedding,
            "text": self.incident_text(incident, logs, telemetry),
        }
        if self._client is None:
            self._fallback_docs[incident.incidentId] = document
            return
        try:
            self._client.index(index=settings.opensearch_index, id=incident.incidentId, body=document)
        except Exception as exc:
            log.warning("opensearch_index_failed fallback=memory incidentId=%s reason=%s", incident.incidentId, exc)
            self._fallback_docs[incident.incidentId] = document

    def search(self, query_embedding: list[float], service: str | None, limit: int) -> list[SimilarIncident]:
        if self._client is None:
            return self._fallback_search(query_embedding, service, limit)
        filters = []
        if service:
            filters.append({"term": {"service.keyword": service}})
        body = {
            "size": max(limit, 1),
            "query": {
                "script_score": {
                    "query": {"bool": {"filter": filters}} if filters else {"match_all": {}},
                    "script": {
                        "source": "knn_score",
                        "lang": "knn",
                        "params": {
                            "field": "embedding",
                            "query_value": query_embedding,
                            "space_type": "cosinesimil",
                        },
                    },
                }
            },
        }
        try:
            response = self._client.search(index=settings.opensearch_index, body=body)
            return [self._hit_to_incident(hit) for hit in response["hits"]["hits"]]
        except Exception as exc:
            log.warning("opensearch_search_failed fallback=memory reason=%s", exc)
            return self._fallback_search(query_embedding, service, limit)

    @staticmethod
    def incident_text(incident: Incident, logs: list[str], telemetry: dict[str, Any]) -> str:
        telemetry_text = " ".join(f"{key}={value}" for key, value in telemetry.items())
        return " ".join(
            [
                incident.service,
                incident.severity,
                incident.summary,
                incident.deploymentVersion or "",
                telemetry_text,
                " ".join(logs),
            ]
        ).strip()

    def _build_client(self):
        try:
            from opensearchpy import OpenSearch

            auth = None
            if settings.opensearch_user and settings.opensearch_password:
                auth = (settings.opensearch_user, settings.opensearch_password)
            client = OpenSearch(hosts=[settings.opensearch_url], http_auth=auth)
            opensearch_logger = logging.getLogger("opensearch")
            previous_level = opensearch_logger.level
            opensearch_logger.setLevel(logging.ERROR)
            try:
                available = client.ping()
            finally:
                opensearch_logger.setLevel(previous_level)
            if not available:
                log.warning("opensearch_unavailable url=%s", settings.opensearch_url)
                return None
            return client
        except Exception as exc:
            log.warning("opensearch_client_unavailable reason=%s", exc)
            return None

    def _ensure_index(self) -> None:
        if self._client is None:
            return
        mapping = {
            "settings": {"index": {"knn": True}},
            "mappings": {
                "properties": {
                    "incidentId": {"type": "keyword"},
                    "service": {"type": "keyword"},
                    "severity": {"type": "keyword"},
                    "summary": {"type": "text"},
                    "deploymentVersion": {"type": "keyword"},
                    "timestamp": {"type": "date"},
                    "text": {"type": "text"},
                    "embedding": {
                        "type": "knn_vector",
                        "dimension": settings.embedding_dimension,
                    },
                }
            },
        }
        try:
            if not self._client.indices.exists(index=settings.opensearch_index):
                self._client.indices.create(index=settings.opensearch_index, body=mapping)
        except Exception as exc:
            log.warning("opensearch_index_create_failed reason=%s", exc)

    def _fallback_search(
        self, query_embedding: list[float], service: str | None, limit: int
    ) -> list[SimilarIncident]:
        query = np.array(query_embedding)
        ranked = []
        for doc in self._fallback_docs.values():
            if service and doc["service"] != service:
                continue
            embedding = np.array(doc["embedding"])
            score = float(np.dot(query, embedding))
            ranked.append((score, doc))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [self._doc_to_incident(doc, score) for score, doc in ranked[:limit]]

    def _hit_to_incident(self, hit: dict[str, Any]) -> SimilarIncident:
        return self._doc_to_incident(hit["_source"], float(hit["_score"]))

    @staticmethod
    def _doc_to_incident(doc: dict[str, Any], score: float) -> SimilarIncident:
        return SimilarIncident(
            incidentId=doc["incidentId"],
            service=doc["service"],
            severity=doc["severity"],
            summary=doc["summary"],
            deploymentVersion=doc.get("deploymentVersion"),
            timestamp=datetime.fromisoformat(doc["timestamp"]),
            score=score,
        )
