import logging
import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

from config import settings
from models import (
    AccessRole,
    AuditEvent,
    GraphInsightReport,
    Incident,
    MemoryFeedbackRequest,
    MemoryType,
    PostmortemDraft,
    RagTrace,
    ReasoningEvent,
    ReasoningTraceReplay,
    RcaEvaluationReport,
    RcaEvaluationRequest,
    ReembeddingReport,
    RetrievalEvaluationReport,
    SimilarIncident,
    SyntheticDatasetReport,
)

log = logging.getLogger(__name__)

SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passwd|pwd)\s*[:=]\s*([^\s,;]+)"),
    re.compile(r"(?i)(api[_-]?key|token|secret)\s*[:=]\s*([A-Za-z0-9._\-+/=]{8,})"),
    re.compile(r"\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    re.compile(r"\b(?:\d[ -]*?){12,19}\b"),
]


SEED_MEMORIES: list[dict[str, Any]] = [
    {
        "incidentId": "INC-BENCH-REDIS-POOL",
        "service": "payment-service",
        "severity": "HIGH",
        "summary": "Payment requests timed out after deployment because Redis connection pool exhausted.",
        "deploymentVersion": "v2.3.0",
        "timestamp": "2026-04-20T10:30:00+00:00",
        "memoryType": MemoryType.EPISODIC.value,
        "rootCause": "Redis pool exhaustion caused request timeouts after a payment-service deployment.",
        "remediation": [
            "Increase Redis pool max connections after checking server capacity.",
            "Rollback deployment retry changes that amplified Redis pressure.",
        ],
        "successfulRemediation": True,
        "logs": ["redis timeout after 500ms", "connection pool exhausted"],
        "telemetry": {"redis_latency_ms": 920, "error_rate": 0.22, "p95_latency_ms": 2100},
    },
    {
        "incidentId": "PATTERN-REDIS-SATURATION",
        "service": "shared-cache",
        "severity": "HIGH",
        "summary": "Known failure pattern: Redis saturation creates latency spikes, retries, and pool exhaustion.",
        "deploymentVersion": None,
        "timestamp": "2026-03-15T09:00:00+00:00",
        "memoryType": MemoryType.SEMANTIC.value,
        "rootCause": "Cache saturation or connection starvation.",
        "remediation": ["Reduce retry pressure, inspect Redis CPU, and tune pool sizing."],
        "successfulRemediation": True,
        "logs": [],
        "telemetry": {"redis_latency_ms": 800, "error_rate": 0.15},
    },
    {
        "incidentId": "RUNBOOK-REDIS-POOL",
        "service": "payment-service",
        "severity": "MEDIUM",
        "summary": "Runbook: remediate Redis pool exhaustion for payment services.",
        "deploymentVersion": None,
        "timestamp": "2026-03-01T12:00:00+00:00",
        "memoryType": MemoryType.PROCEDURAL.value,
        "rootCause": "Procedure for validating Redis pool saturation.",
        "remediation": [
            "Check active connections, blocked clients, Redis CPU, and application pool metrics.",
            "Scale callers gradually or roll back retry/concurrency changes.",
        ],
        "successfulRemediation": True,
        "logs": [],
        "telemetry": {"redis_latency_ms": 700},
    },
    {
        "incidentId": "INC-BENCH-KAFKA-LAG",
        "service": "orders-service",
        "severity": "MEDIUM",
        "summary": "Order processing delayed because consumer deployment introduced Kafka lag.",
        "deploymentVersion": "v1.8.4",
        "timestamp": "2026-04-28T08:15:00+00:00",
        "memoryType": MemoryType.EPISODIC.value,
        "rootCause": "Kafka consumer throughput regression after deployment.",
        "remediation": ["Scale consumers and roll back the slow deserializer change."],
        "successfulRemediation": True,
        "logs": ["consumer lag exceeded threshold", "partition processing delayed"],
        "telemetry": {"kafka_lag": 48000, "error_rate": 0.04},
    },
    {
        "incidentId": "INC-BENCH-OOM",
        "service": "checkout-service",
        "severity": "CRITICAL",
        "summary": "Checkout pods entered CrashLoopBackOff from memory pressure and OOM kills.",
        "deploymentVersion": "v4.1.2",
        "timestamp": "2026-05-05T17:45:00+00:00",
        "memoryType": MemoryType.EPISODIC.value,
        "rootCause": "Container memory pressure caused repeated pod restarts.",
        "remediation": ["Rollback the release and capture heap profiles before raising limits."],
        "successfulRemediation": True,
        "logs": ["OOMKilled", "CrashLoopBackOff"],
        "telemetry": {"restart_count": 9, "memory_working_set_ratio": 0.96},
    },
    {
        "incidentId": "INC-BENCH-DB-CONNECTIONS",
        "service": "billing-service",
        "severity": "HIGH",
        "summary": "Billing API failed requests because database connection usage hit max capacity.",
        "deploymentVersion": "v3.6.1",
        "timestamp": "2026-05-09T11:10:00+00:00",
        "memoryType": MemoryType.EPISODIC.value,
        "rootCause": "Database connection pool exhaustion.",
        "remediation": ["Tune DB pool limits and remove leaked transaction handles."],
        "successfulRemediation": False,
        "logs": ["timeout acquiring database connection"],
        "telemetry": {"db_connections_used": 198, "db_connections_max": 200, "error_rate": 0.19},
    },
]


class IncidentMemoryStore:
    def __init__(self) -> None:
        self._client = self._build_client()
        self._fallback_docs: dict[str, dict[str, Any]] = {}
        self._feedback: dict[str, list[dict[str, Any]]] = {}
        self._rca_evaluations: dict[str, RcaEvaluationReport] = {}
        self._audit_events: list[AuditEvent] = []
        self._rag_traces: dict[str, RagTrace] = {}
        self._last_trace_id: str | None = None
        self._ensure_index()

    def index_seed_memories(self, embed) -> None:
        for seed in SEED_MEMORIES:
            if seed["incidentId"] in self._fallback_docs:
                continue
            document = self._enrich_document(dict(seed))
            document["embedding"] = embed(document["text"])
            self._store_document(document)

    def index_incident(
        self,
        incident: Incident,
        logs: list[str],
        telemetry: dict[str, Any],
        embedding: list[float],
    ) -> None:
        redacted_logs = [self.redact(value) for value in logs]
        document = {
            "incidentId": incident.incidentId,
            "tenantId": incident.tenantId,
            "teamId": incident.teamId,
            "serviceOwner": incident.serviceOwner,
            "service": incident.service,
            "severity": incident.severity,
            "summary": self.redact(incident.summary),
            "deploymentVersion": incident.deploymentVersion,
            "timestamp": incident.timestamp.isoformat(),
            "memoryType": MemoryType.EPISODIC.value,
            "rootCause": self.redact(incident.rootCause) if incident.rootCause else None,
            "remediation": incident.remediation,
            "successfulRemediation": incident.successfulRemediation,
            "aiConfidence": incident.aiConfidence,
            "humanConfirmed": incident.humanConfirmed,
            "runbookRef": incident.runbookRef,
            "logs": redacted_logs,
            "telemetry": telemetry,
        }
        document = self._enrich_document(document)
        document["embedding"] = embedding
        self._store_document(document)

    def search(
        self,
        query_embedding: list[float],
        service: str | None,
        limit: int,
        *,
        severity: str | None = None,
        telemetry: dict[str, Any] | None = None,
        memory_types: list[MemoryType] | None = None,
        tenant_id: str = "default",
        team_id: str | None = None,
        requested_by: str = "anonymous",
        role: AccessRole = AccessRole.VIEWER,
        query_text: str | None = None,
    ) -> list[SimilarIncident]:
        candidate_limit = max(limit * 5, 25)
        self._authorize(role, tenant_id)
        if self._client is None:
            results = self._fallback_search(
                query_embedding,
                service,
                severity,
                telemetry or {},
                memory_types,
                limit,
                tenant_id,
                team_id,
                role,
            )
            self._record_search_trace(query_text, tenant_id, requested_by, role, results)
            return results
        filters = []
        if memory_types:
            filters.append({"terms": {"memoryType": [item.value for item in memory_types]}})
        if service:
            filters.append({"term": {"service": service}})
        if role not in {AccessRole.PLATFORM_ADMIN, AccessRole.AUDITOR}:
            filters.append({"term": {"tenantId": tenant_id}})
            if team_id:
                filters.append({"term": {"teamId": team_id}})
        try:
            body = {
                "size": candidate_limit,
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
            response = self._client.search(index=settings.opensearch_index, body=body)
            docs = [(float(hit["_score"]), hit["_source"]) for hit in response["hits"]["hits"]]
            results = self._rank_docs(docs, service, severity, telemetry or {}, limit)
            self._record_search_trace(query_text, tenant_id, requested_by, role, results)
            return results
        except Exception as exc:
            log.warning("opensearch_search_failed fallback=memory reason=%s", exc)
            results = self._fallback_search(
                query_embedding,
                service,
                severity,
                telemetry or {},
                memory_types,
                limit,
                tenant_id,
                team_id,
                role,
            )
            self._record_search_trace(query_text, tenant_id, requested_by, role, results)
            return results

    def record_feedback(self, request: MemoryFeedbackRequest) -> dict[str, Any]:
        event = {
            "helpful": request.helpful,
            "correctRca": request.correctRca,
            "remediationWorked": request.remediationWorked,
            "actionTaken": request.actionTaken,
            "notes": request.notes,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        self._feedback.setdefault(request.incidentId, []).append(event)
        if request.incidentId in self._fallback_docs:
            self._fallback_docs[request.incidentId]["feedbackScore"] = self._feedback_score(
                request.incidentId
            )
            if request.remediationWorked is not None:
                self._fallback_docs[request.incidentId]["successfulRemediation"] = request.remediationWorked
                self._fallback_docs[request.incidentId]["qualityScore"] = self._quality_score(
                    self._fallback_docs[request.incidentId]
                )
        self._audit_events.append(
            AuditEvent(
                eventId=f"audit-{uuid.uuid4().hex[:12]}",
                timestamp=datetime.now(UTC),
                actorId=request.actorId,
                role=AccessRole.RESPONDER,
                tenantId=request.tenantId,
                action="memory.feedback",
                retrievedIncidentIds=[request.incidentId],
                actionTaken=request.actionTaken,
            )
        )
        return {"status": "recorded", "incidentId": request.incidentId}

    def evaluate_rca(self, request: RcaEvaluationRequest) -> RcaEvaluationReport:
        ai_root = set(self._tokens(request.aiRootCause))
        human_root = set(self._tokens(request.humanRootCause))
        root_overlap = self._overlap(ai_root, human_root)

        ai_remediation = set(self._tokens(" ".join(request.aiRemediation)))
        human_remediation = set(self._tokens(" ".join(request.humanRemediation)))
        remediation_overlap = self._overlap(ai_remediation, human_remediation)

        report = RcaEvaluationReport(
            incidentId=request.incidentId,
            rootCauseMatched=root_overlap >= 0.35,
            remediationOverlap=round(remediation_overlap, 3),
            accuracyScore=round((root_overlap * 0.7) + (remediation_overlap * 0.3), 3),
            confidenceCalibrationError=self._confidence_error(
                request.aiConfidence, request.humanConfirmed
            ),
            aiRootCause=request.aiRootCause,
            humanRootCause=request.humanRootCause,
        )
        self._rca_evaluations[request.incidentId] = report
        if request.incidentId in self._fallback_docs:
            self._fallback_docs[request.incidentId]["humanConfirmed"] = request.humanConfirmed
            self._fallback_docs[request.incidentId]["aiConfidence"] = request.aiConfidence
            self._fallback_docs[request.incidentId]["qualityScore"] = self._quality_score(
                self._fallback_docs[request.incidentId]
            )
        return report

    @staticmethod
    def incident_text(incident: Incident, logs: list[str], telemetry: dict[str, Any]) -> str:
        telemetry_signals = IncidentMemoryStore.normalize_telemetry(telemetry)
        telemetry_text = " ".join(f"{key}={value}" for key, value in telemetry.items())
        signal_text = " ".join(f"{key}={value}" for key, value in telemetry_signals.items())
        return " ".join(
            [
                MemoryType.EPISODIC.value,
                incident.service,
                incident.severity,
                IncidentMemoryStore.redact(incident.summary),
                incident.deploymentVersion or "",
                IncidentMemoryStore.redact(incident.rootCause or ""),
                " ".join(incident.remediation),
                telemetry_text,
                signal_text,
                " ".join(IncidentMemoryStore.redact(log) for log in logs),
            ]
        ).strip()

    @staticmethod
    def normalize_telemetry(telemetry: dict[str, Any]) -> dict[str, Any]:
        values = {key.lower(): value for key, value in telemetry.items()}
        signals: dict[str, Any] = {}

        latency = IncidentMemoryStore._first_number(
            values, "p95_latency_ms", "latency_ms", "http_server_duration_p95_ms"
        )
        if latency is not None and latency >= 1000:
            signals["latency_spike"] = latency

        error_rate = IncidentMemoryStore._first_number(values, "error_rate", "error_rate_pct")
        if error_rate is not None and error_rate >= 0.05:
            signals["error_rate"] = error_rate

        restart_count = IncidentMemoryStore._first_number(values, "restart_count", "pod_restart_count")
        if restart_count is not None and restart_count > 0:
            signals["restart_count"] = restart_count

        cpu_throttle = IncidentMemoryStore._first_number(
            values, "cpu_throttling", "cpu_throttling_ratio", "container_cpu_cfs_throttled_ratio"
        )
        if cpu_throttle is not None and cpu_throttle >= 0.2:
            signals["cpu_throttling"] = cpu_throttle

        memory_ratio = IncidentMemoryStore._first_number(
            values, "memory_pressure", "memory_working_set_ratio", "container_memory_usage_ratio"
        )
        if memory_ratio is not None and memory_ratio >= 0.85:
            signals["memory_pressure"] = memory_ratio

        kafka_lag = IncidentMemoryStore._first_number(values, "kafka_lag", "consumer_lag")
        if kafka_lag is not None and kafka_lag >= 1000:
            signals["kafka_lag"] = kafka_lag

        db_used = IncidentMemoryStore._first_number(values, "db_connections_used", "db_pool_used")
        db_max = IncidentMemoryStore._first_number(values, "db_connections_max", "db_pool_max")
        if db_used is not None and db_max:
            usage = db_used / db_max
            if usage >= 0.85:
                signals["db_connection_usage"] = round(usage, 3)

        redis_latency = IncidentMemoryStore._first_number(values, "redis_latency_ms")
        if redis_latency is not None and redis_latency >= 500:
            signals["redis_saturation"] = redis_latency

        return signals

    @staticmethod
    def document_text(document: dict[str, Any]) -> str:
        telemetry = document.get("telemetry") or {}
        telemetry_signals = document.get("telemetrySignals") or {}
        return " ".join(
            [
                document.get("cluster") or "",
                document.get("runbookRef") or "",
                document.get("memoryType") or "",
                document.get("service") or "",
                document.get("severity") or "",
                document.get("summary") or "",
                document.get("deploymentVersion") or "",
                document.get("rootCause") or "",
                " ".join(document.get("remediation") or []),
                " ".join(document.get("logs") or []),
                " ".join(f"{key}={value}" for key, value in telemetry.items()),
                " ".join(f"{key}={value}" for key, value in telemetry_signals.items()),
            ]
        ).strip()

    @staticmethod
    def redact(text: str) -> str:
        redacted = text
        for pattern in SECRET_PATTERNS:
            if pattern.pattern.startswith("(?i)(password") or pattern.pattern.startswith("(?i)(api"):
                redacted = pattern.sub(lambda match: f"{match.group(1)}=[REDACTED]", redacted)
            else:
                redacted = pattern.sub("[REDACTED]", redacted)
        return redacted

    def _enrich_document(self, document: dict[str, Any]) -> dict[str, Any]:
        document.setdefault("tenantId", "default")
        document.setdefault("teamId", None)
        document.setdefault("serviceOwner", None)
        document.setdefault("memoryType", MemoryType.EPISODIC.value)
        document["memorySchemaVersion"] = settings.memory_schema_version
        document["embeddingModel"] = settings.embedding_model
        document["embeddingVersion"] = settings.embedding_version
        document["telemetrySignals"] = self.normalize_telemetry(document.get("telemetry", {}))
        document["ttlTier"] = self._ttl_tier(document.get("timestamp"))
        document["cluster"] = document.get("cluster") or self._cluster_for(document)
        document["runbookRef"] = document.get("runbookRef") or self._runbook_for(document["cluster"])
        document["qualityScore"] = self._quality_score(document)
        document["duplicateOf"] = document.get("duplicateOf") or self._detect_duplicate(document)
        document["summary"] = self.redact(document.get("summary", ""))
        document["logs"] = [self.redact(value) for value in document.get("logs", [])]
        if document.get("rootCause"):
            document["rootCause"] = self.redact(document["rootCause"])
        document["text"] = self.document_text(document)
        return document

    def reembed(self, embed) -> ReembeddingReport:
        scanned = 0
        reembedded = 0
        for doc in list(self._fallback_docs.values()):
            scanned += 1
            if (
                doc.get("embeddingModel") == settings.embedding_model
                and doc.get("embeddingVersion") == settings.embedding_version
                and doc.get("memorySchemaVersion") == settings.memory_schema_version
            ):
                continue
            enriched = self._enrich_document(doc)
            enriched["embedding"] = embed(enriched["text"])
            self._store_document(enriched)
            reembedded += 1
        return ReembeddingReport(
            status="completed",
            scanned=scanned,
            reembedded=reembedded,
            embeddingModel=settings.embedding_model,
            embeddingVersion=settings.embedding_version,
        )

    def generate_synthetic_dataset(self, embed, count: int = 60) -> SyntheticDatasetReport:
        categories = [
            ("redis-saturation", "payment-service", "Redis pool exhaustion after deployment"),
            ("oom-killed", "checkout-service", "OOMKilled pods after heap growth"),
            ("kafka-lag", "orders-service", "Kafka consumer lag after rollout"),
            ("db-connection-exhaustion", "billing-service", "Database connection pool exhausted"),
            ("probe-failures", "inventory-service", "Readiness probe failures after config change"),
        ]
        generated = 0
        cluster_counts: Counter[str] = Counter()
        base_date = datetime.now(UTC)
        for index in range(count):
            cluster, service, summary = categories[index % len(categories)]
            incident_id = f"SYN-{index + 1:04d}"
            if incident_id in self._fallback_docs:
                continue
            telemetry = self._synthetic_telemetry(cluster, index)
            doc = self._enrich_document(
                {
                    "incidentId": incident_id,
                    "tenantId": f"tenant-{(index % 3) + 1}",
                    "teamId": f"team-{(index % 4) + 1}",
                    "serviceOwner": f"{service}-team",
                    "service": service,
                    "severity": ["LOW", "MEDIUM", "HIGH", "CRITICAL"][index % 4],
                    "summary": f"{summary} #{index + 1}",
                    "deploymentVersion": f"v{1 + index % 5}.{index % 10}.0",
                    "timestamp": (base_date - timedelta(days=index * 9)).isoformat(),
                    "memoryType": MemoryType.EPISODIC.value,
                    "rootCause": cluster.replace("-", " "),
                    "remediation": [f"Apply {self._runbook_for(cluster)}"],
                    "successfulRemediation": index % 5 != 0,
                    "humanConfirmed": index % 3 != 0,
                    "aiConfidence": round(0.55 + ((index % 40) / 100), 2),
                    "cluster": cluster,
                    "logs": [summary, "request failed after rollout"],
                    "telemetry": telemetry,
                }
            )
            doc["embedding"] = embed(doc["text"])
            self._store_document(doc)
            generated += 1
            cluster_counts[cluster] += 1
        return SyntheticDatasetReport(
            status="generated",
            generated=generated,
            clusters=dict(cluster_counts),
        )

    def retrieval_evaluation(self, embed, k: int = 5) -> RetrievalEvaluationReport:
        from models import BenchmarkResult

        cases = [
            ("payment timeout after deployment", "INC-BENCH-REDIS-POOL", "payment-service", "HIGH"),
            ("orders consumer lag after rollout", "INC-BENCH-KAFKA-LAG", "orders-service", "MEDIUM"),
            ("checkout crashloop oom memory pressure", "INC-BENCH-OOM", "checkout-service", "CRITICAL"),
            ("billing db connection pool exhausted", "INC-BENCH-DB-CONNECTIONS", "billing-service", "HIGH"),
            ("readiness probe failing after deployment", "SYN-0005", None, None),
        ]
        results = []
        reciprocal_ranks = []
        for query, expected, service, severity in cases:
            matches = self.search(
                embed(query),
                service,
                max(k, 5),
                severity=severity,
                role=AccessRole.PLATFORM_ADMIN,
                query_text=query,
            )
            ids = [match.incidentId for match in matches]
            rank = ids.index(expected) + 1 if expected in ids else 0
            reciprocal_ranks.append(1 / rank if rank else 0)
            expected_match = matches[rank - 1] if rank else None
            results.append(
                BenchmarkResult(
                    query=query,
                    expectedIncidentId=expected,
                    topMatchIncidentId=ids[0] if ids else None,
                    topKHit=expected in ids[:k],
                    recallAt5Hit=expected in ids[:5],
                    similarityScore=expected_match.similarityScore if expected_match else 0.0,
                )
            )
        total = len(results) or 1
        return RetrievalEvaluationReport(
            cases=results,
            precisionAt5=sum(1 for result in results if result.recallAt5Hit) / (total * 5),
            recallAt5=sum(1 for result in results if result.recallAt5Hit) / total,
            mrr=sum(reciprocal_ranks) / total,
            hitRate=sum(1 for result in results if result.topKHit) / total,
        )

    def postmortem(self, incident_id: str, tenant_id: str = "default") -> PostmortemDraft | None:
        doc = self._fallback_docs.get(incident_id)
        if doc is None or doc.get("tenantId", "default") != tenant_id:
            return None
        return PostmortemDraft(
            incidentId=incident_id,
            summary=doc["summary"],
            timeline=[
                f"{doc['timestamp']}: incident detected for {doc['service']}",
                "AI-Memory-Graph retrieved related incidents and runbooks.",
                "Operator feedback and RCA evaluation should be attached after resolution.",
            ],
            impact=f"{doc['severity']} severity impact on {doc['service']}.",
            rootCause=doc.get("rootCause") or "Root cause not confirmed yet.",
            detectionGap="Confirm whether alerting fired before user-visible symptoms.",
            remediation=doc.get("remediation") or [f"Use {doc.get('runbookRef')}"],
            followUps=[
                "Attach human-confirmed RCA.",
                "Record whether remediation worked.",
                "Update runbook if this incident exposed a new failure mode.",
            ],
        )

    def graph_insights(self, tenant_id: str = "default") -> GraphInsightReport:
        docs = [doc for doc in self._fallback_docs.values() if doc.get("tenantId", "default") == tenant_id]
        deployment_failures = Counter(
            doc["service"] for doc in docs if doc.get("deploymentVersion") and doc.get("severity") in {"HIGH", "CRITICAL"}
        )
        causes = Counter(doc.get("cluster", "unknown") for doc in docs)
        remediations = Counter(
            step
            for doc in docs
            if doc.get("successfulRemediation") is True
            for step in doc.get("remediation", [])
        )
        return GraphInsightReport(
            repeatedDeploymentFailures=[
                {"service": service, "count": count}
                for service, count in deployment_failures.most_common(10)
            ],
            recurringRootCauses=[
                {"rootCause": cause, "count": count} for cause, count in causes.most_common(10)
            ],
            effectiveRemediations=[
                {"remediation": step, "count": count} for step, count in remediations.most_common(10)
            ],
        )

    def audit_events(self) -> list[AuditEvent]:
        return self._audit_events[-100:]

    def rag_traces(self) -> list[RagTrace]:
        return list(self._rag_traces.values())[-100:]

    def latest_trace_id(self) -> str | None:
        return self._last_trace_id

    def append_reasoning_event(
        self,
        trace_id: str | None,
        *,
        step: str,
        detail: str,
        incident_id: str | None = None,
        service: str | None = None,
        inputs: dict[str, Any] | None = None,
        outputs: dict[str, Any] | None = None,
        duration_ms: int = 0,
    ) -> ReasoningEvent | None:
        if not trace_id or trace_id not in self._rag_traces:
            return None
        trace = self._rag_traces[trace_id]
        parent_id = trace.events[-1].eventId if trace.events else None
        event = ReasoningEvent(
            eventId=f"evt-{uuid.uuid4().hex[:12]}",
            traceId=trace_id,
            timestamp=datetime.now(UTC),
            step=step,
            incidentId=incident_id,
            service=service,
            detail=detail,
            inputs=inputs or {},
            outputs=outputs or {},
            durationMs=duration_ms,
            parentEventId=parent_id,
        )
        trace.events.append(event)
        return event

    def reasoning_replay(self, trace_id: str) -> ReasoningTraceReplay | None:
        trace = self._rag_traces.get(trace_id)
        if trace is None:
            return None
        workflow_path = [event.step for event in trace.events]
        memory_ids = [memory.incidentId for memory in trace.usedMemories[:3]]
        summary = (
            f"Trace {trace_id} replayed {len(trace.events)} reasoning events. "
            f"Query used {len(trace.usedMemories)} memories"
            + (f": {', '.join(memory_ids)}." if memory_ids else ".")
        )
        return ReasoningTraceReplay(
            traceId=trace_id,
            events=trace.events,
            workflowPath=workflow_path,
            summary=summary,
        )

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
                    "tenantId": {"type": "keyword"},
                    "teamId": {"type": "keyword"},
                    "serviceOwner": {"type": "keyword"},
                    "service": {"type": "keyword"},
                    "severity": {"type": "keyword"},
                    "summary": {"type": "text"},
                    "deploymentVersion": {"type": "keyword"},
                    "timestamp": {"type": "date"},
                    "memoryType": {"type": "keyword"},
                    "rootCause": {"type": "text"},
                    "remediation": {"type": "text"},
                    "successfulRemediation": {"type": "boolean"},
                    "aiConfidence": {"type": "float"},
                    "humanConfirmed": {"type": "boolean"},
                    "memorySchemaVersion": {"type": "keyword"},
                    "embeddingModel": {"type": "keyword"},
                    "embeddingVersion": {"type": "keyword"},
                    "ttlTier": {"type": "keyword"},
                    "qualityScore": {"type": "float"},
                    "duplicateOf": {"type": "keyword"},
                    "cluster": {"type": "keyword"},
                    "runbookRef": {"type": "keyword"},
                    "telemetrySignals": {"type": "object", "enabled": True},
                    "feedbackScore": {"type": "float"},
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
        self,
        query_embedding: list[float],
        service: str | None,
        severity: str | None,
        telemetry: dict[str, Any],
        memory_types: list[MemoryType] | None,
        limit: int,
        tenant_id: str,
        team_id: str | None,
        role: AccessRole,
    ) -> list[SimilarIncident]:
        query = np.array(query_embedding)
        candidates = []
        allowed_types = {item.value for item in memory_types} if memory_types else None
        for doc in self._fallback_docs.values():
            if allowed_types and doc.get("memoryType") not in allowed_types:
                continue
            if not self._can_read(doc, tenant_id, team_id, role):
                continue
            embedding = np.array(doc["embedding"])
            candidates.append((float(np.dot(query, embedding)), doc))
        return self._rank_docs(candidates, service, severity, telemetry, limit)

    def _rank_docs(
        self,
        docs: list[tuple[float, dict[str, Any]]],
        service: str | None,
        severity: str | None,
        telemetry: dict[str, Any],
        limit: int,
    ) -> list[SimilarIncident]:
        query_signals = self.normalize_telemetry(telemetry)
        ranked = []
        for similarity, doc in docs:
            ranking_signals = self._ranking_signals(doc, similarity, service, severity, query_signals)
            score = (
                similarity * 0.44
                + ranking_signals["recency"] * 0.10
                + ranking_signals["service"] * 0.12
                + ranking_signals["severity"] * 0.08
                + ranking_signals["successful_fix_boost"] * 0.12
                + ranking_signals["feedback"] * 0.05
                + ranking_signals["telemetry"] * 0.08
                + ranking_signals["quality"] * 0.08
                + ranking_signals["ttl"] * 0.04
            )
            ranked.append((score, similarity, ranking_signals, doc))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [
            self._doc_to_incident(doc, rank_score, similarity, ranking_signals)
            for rank_score, similarity, ranking_signals, doc in ranked[: max(limit, 1)]
        ]

    def _ranking_signals(
        self,
        doc: dict[str, Any],
        similarity: float,
        service: str | None,
        severity: str | None,
        query_signals: dict[str, Any],
    ) -> dict[str, float]:
        doc_severity = str(doc.get("severity") or "").upper()
        successful_fix_boost = 1.0 if doc.get("successfulRemediation") is True else 0.3
        service_score = 1.0 if service and doc.get("service") == service else 0.0
        severity_score = 1.0 if severity and doc_severity == severity.upper() else 0.0
        telemetry_score = self._telemetry_score(query_signals, doc.get("telemetrySignals") or {})
        ttl_score = {"hot": 1.0, "warm": 0.75, "archived": 0.35}.get(doc.get("ttlTier"), 0.5)
        return {
            "similarity": round(similarity, 4),
            "recency": round(self._recency_score(doc.get("timestamp")), 4),
            "service": service_score,
            "severity": severity_score,
            "successful_fix_boost": successful_fix_boost,
            "feedback": round(self._feedback_score(doc["incidentId"]), 4),
            "telemetry": round(telemetry_score, 4),
            "quality": float(doc.get("qualityScore", 0.0)),
            "ttl": ttl_score,
        }

    def _store_document(self, document: dict[str, Any]) -> None:
        self._fallback_docs[document["incidentId"]] = document
        if self._client is None:
            return
        try:
            self._client.index(
                index=settings.opensearch_index, id=document["incidentId"], body=document
            )
        except Exception as exc:
            log.warning(
                "opensearch_index_failed fallback=memory incidentId=%s reason=%s",
                document["incidentId"],
                exc,
            )

    def _doc_to_incident(
        self,
        doc: dict[str, Any],
        rank_score: float,
        similarity: float,
        ranking_signals: dict[str, float],
    ) -> SimilarIncident:
        return SimilarIncident(
            incidentId=doc["incidentId"],
            tenantId=doc.get("tenantId", "default"),
            teamId=doc.get("teamId"),
            serviceOwner=doc.get("serviceOwner"),
            service=doc["service"],
            severity=doc["severity"],
            summary=doc["summary"],
            deploymentVersion=doc.get("deploymentVersion"),
            timestamp=datetime.fromisoformat(doc["timestamp"]),
            score=rank_score,
            similarityScore=similarity,
            rankScore=rank_score,
            memoryType=MemoryType(doc.get("memoryType", MemoryType.EPISODIC.value)),
            rootCause=doc.get("rootCause"),
            remediation=doc.get("remediation") or [],
            telemetrySignals=doc.get("telemetrySignals") or {},
            rankingSignals=ranking_signals,
            memorySchemaVersion=doc.get("memorySchemaVersion", settings.memory_schema_version),
            embeddingModel=doc.get("embeddingModel", settings.embedding_model),
            embeddingVersion=doc.get("embeddingVersion", settings.embedding_version),
            ttlTier=doc.get("ttlTier", "hot"),
            qualityScore=float(doc.get("qualityScore", 0.0)),
            duplicateOf=doc.get("duplicateOf"),
            cluster=doc.get("cluster", "unknown"),
            runbookRef=doc.get("runbookRef"),
        )

    def _authorize(self, role: AccessRole, tenant_id: str) -> None:
        if role in {AccessRole.PLATFORM_ADMIN, AccessRole.AUDITOR}:
            return
        if not tenant_id:
            raise PermissionError("tenantId is required for tenant-scoped memory access")

    @staticmethod
    def _can_read(
        doc: dict[str, Any], tenant_id: str, team_id: str | None, role: AccessRole
    ) -> bool:
        if role in {AccessRole.PLATFORM_ADMIN, AccessRole.AUDITOR}:
            return True
        if doc.get("tenantId", "default") != tenant_id:
            return False
        if team_id and doc.get("teamId") not in {None, team_id}:
            return False
        return True

    def _record_search_trace(
        self,
        query: str | None,
        tenant_id: str,
        requested_by: str,
        role: AccessRole,
        results: list[SimilarIncident],
    ) -> None:
        trace_id = f"trace-{uuid.uuid4().hex[:12]}"
        cold_start = not any(item.memoryType == MemoryType.EPISODIC for item in results)
        timestamp = datetime.now(UTC)
        events = [
            ReasoningEvent(
                eventId=f"evt-{uuid.uuid4().hex[:12]}",
                traceId=trace_id,
                timestamp=timestamp,
                step="QUERY_EMBEDDING",
                detail="Encoded operator query with sentence-transformer embedding model.",
                inputs={"query": query or ""},
                outputs={
                    "embeddingModel": settings.embedding_model,
                    "embeddingVersion": settings.embedding_version,
                },
                durationMs=12,
            ),
            ReasoningEvent(
                eventId=f"evt-{uuid.uuid4().hex[:12]}",
                traceId=trace_id,
                timestamp=timestamp,
                step="MEMORY_RETRIEVAL",
                detail="Retrieved and ranked operational memories from vector search.",
                inputs={"tenantId": tenant_id, "role": role.value},
                outputs={
                    "retrievedIncidentIds": [item.incidentId for item in results],
                    "coldStart": cold_start,
                },
                durationMs=24,
            ),
            ReasoningEvent(
                eventId=f"evt-{uuid.uuid4().hex[:12]}",
                traceId=trace_id,
                timestamp=timestamp,
                step="RANKING_EXPLANATION",
                detail="Combined semantic similarity, recency, service, severity, telemetry, quality, and feedback signals.",
                outputs={
                    "topSignals": results[0].rankingSignals if results else {},
                    "topMemory": results[0].incidentId if results else None,
                },
                durationMs=8,
            ),
        ]
        for index in range(1, len(events)):
            events[index].parentEventId = events[index - 1].eventId
        trace = RagTrace(
            traceId=trace_id,
            timestamp=timestamp,
            query=query or "",
            tenantId=tenant_id,
            usedMemories=results,
            coldStart=cold_start,
            fallbackSources=["known-pattern-library", "runbook-templates", "kubernetes-failure-taxonomy"]
            if cold_start
            else [],
            events=events,
        )
        self._rag_traces[trace_id] = trace
        self._last_trace_id = trace_id
        self._audit_events.append(
            AuditEvent(
                eventId=f"audit-{uuid.uuid4().hex[:12]}",
                timestamp=trace.timestamp,
                actorId=requested_by,
                role=role,
                tenantId=tenant_id,
                action="memory.search",
                query=query,
                retrievedIncidentIds=[item.incidentId for item in results],
                recommendation=results[0].summary if results else "cold-start fallback",
            )
        )

    def _feedback_score(self, incident_id: str) -> float:
        events = self._feedback.get(incident_id, [])
        if not events:
            return 0.5
        values = []
        for event in events:
            for key in ("helpful", "correctRca", "remediationWorked"):
                if event.get(key) is not None:
                    values.append(1.0 if event[key] else 0.0)
        return sum(values) / len(values) if values else 0.5

    @staticmethod
    def _recency_score(timestamp: str | None) -> float:
        if not timestamp:
            return 0.0
        try:
            parsed = datetime.fromisoformat(timestamp)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            age_days = max((datetime.now(UTC) - parsed).total_seconds() / 86400, 0)
            return max(0.0, 1.0 - (age_days / 180))
        except ValueError:
            return 0.0

    @staticmethod
    def _telemetry_score(query_signals: dict[str, Any], doc_signals: dict[str, Any]) -> float:
        if not query_signals:
            return 0.0
        overlap = set(query_signals).intersection(doc_signals)
        return len(overlap) / len(query_signals)

    @staticmethod
    def _ttl_tier(timestamp: str | None) -> str:
        if not timestamp:
            return "hot"
        try:
            parsed = datetime.fromisoformat(timestamp)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            age_days = max((datetime.now(UTC) - parsed).days, 0)
        except ValueError:
            return "hot"
        if age_days <= 90:
            return "hot"
        if age_days <= 365:
            return "warm"
        return "archived"

    @staticmethod
    def _quality_score(doc: dict[str, Any]) -> float:
        checks = [
            bool(doc.get("logs")),
            bool(doc.get("telemetry")),
            bool(doc.get("rootCause")) or doc.get("humanConfirmed") is True,
            doc.get("successfulRemediation") is not None,
            bool(doc.get("deploymentVersion")),
        ]
        return round(sum(1 for item in checks if item) / len(checks), 3)

    @staticmethod
    def _cluster_for(doc: dict[str, Any]) -> str:
        text = " ".join(
            [
                doc.get("summary") or "",
                doc.get("rootCause") or "",
                " ".join(doc.get("logs") or []),
                " ".join((doc.get("telemetrySignals") or {}).keys()),
            ]
        ).lower()
        if "redis" in text or "cache" in text:
            return "redis-saturation"
        if "oom" in text or "memory" in text or "crashloop" in text:
            return "oom-killed"
        if "kafka" in text or "consumer lag" in text:
            return "kafka-lag"
        if "database" in text or "db_" in text or "connection pool" in text:
            return "db-connection-exhaustion"
        if "probe" in text or "readiness" in text or "liveness" in text:
            return "probe-failures"
        return "unknown"

    @staticmethod
    def _runbook_for(cluster: str) -> str | None:
        return {
            "redis-saturation": "redis-pool-exhaustion.yaml",
            "oom-killed": "kubernetes-oomkilled.yaml",
            "kafka-lag": "kafka-consumer-lag.yaml",
            "db-connection-exhaustion": "database-connection-exhaustion.yaml",
            "probe-failures": "kubernetes-probe-failures.yaml",
        }.get(cluster)

    def _detect_duplicate(self, doc: dict[str, Any]) -> str | None:
        for existing in self._fallback_docs.values():
            if existing["incidentId"] == doc["incidentId"]:
                continue
            if existing.get("tenantId", "default") != doc.get("tenantId", "default"):
                continue
            if existing.get("service") != doc.get("service"):
                continue
            if existing.get("cluster") != doc.get("cluster"):
                continue
            overlap = self._overlap(
                set(self._tokens(existing.get("summary", ""))),
                set(self._tokens(doc.get("summary", ""))),
            )
            if overlap >= 0.45:
                return existing["incidentId"]
        return None

    @staticmethod
    def _synthetic_telemetry(cluster: str, index: int) -> dict[str, Any]:
        if cluster == "redis-saturation":
            return {"redis_latency_ms": 650 + index, "error_rate": 0.12, "p95_latency_ms": 1500}
        if cluster == "oom-killed":
            return {"restart_count": 2 + index % 8, "memory_working_set_ratio": 0.92}
        if cluster == "kafka-lag":
            return {"kafka_lag": 2000 + index * 100, "error_rate": 0.03}
        if cluster == "db-connection-exhaustion":
            return {"db_connections_used": 95, "db_connections_max": 100, "error_rate": 0.16}
        return {"p95_latency_ms": 1250, "error_rate": 0.08}

    @staticmethod
    def _first_number(values: dict[str, Any], *keys: str) -> float | None:
        for key in keys:
            value = values.get(key)
            if isinstance(value, int | float):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError:
                    continue
        return None

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return [
            token
            for token in "".join(char.lower() if char.isalnum() else " " for char in text).split()
            if len(token) > 2
        ]

    @staticmethod
    def _overlap(left: set[str], right: set[str]) -> float:
        if not left or not right:
            return 0.0
        return len(left.intersection(right)) / len(left.union(right))

    @staticmethod
    def _confidence_error(confidence: float | None, confirmed: bool | None) -> float | None:
        if confidence is None or confirmed is None:
            return None
        expected = 1.0 if confirmed else 0.0
        return round(abs(confidence - expected), 3)
