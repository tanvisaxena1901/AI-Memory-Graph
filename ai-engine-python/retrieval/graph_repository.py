import logging
from collections import deque

from config import settings
from models import (
    CausalityEdge,
    CausalityGraph,
    CausalityNode,
    GraphTraversalRequest,
    Incident,
    TelemetryCausalityRequest,
)

log = logging.getLogger(__name__)


class GraphRepository:
    def __init__(self) -> None:
        self._driver = self._build_driver()
        self._fallback_graphs: dict[str, CausalityGraph] = {}

    def upsert_incident(self, incident: Incident) -> None:
        if self._driver is None:
            return
        query = """
        MERGE (svc:Service {name: $service})
        MERGE (inc:Incident {incidentId: $incidentId})
        SET inc.summary = $summary,
            inc.severity = $severity,
            inc.timestamp = datetime($timestamp),
            inc.deploymentVersion = $deploymentVersion
        MERGE (svc)-[:EXPERIENCED]->(inc)
        WITH inc
        FOREACH (_ IN CASE WHEN $deploymentVersion IS NULL THEN [] ELSE [1] END |
            MERGE (dep:Deployment {service: $service, version: $deploymentVersion})
            MERGE (dep)-[:PRECEDED]->(inc)
        )
        WITH inc
        FOREACH (_ IN CASE WHEN $rootCause IS NULL THEN [] ELSE [1] END |
            MERGE (cause:RootCause {name: $rootCause})
            MERGE (inc)-[:CAUSED_BY]->(cause)
        )
        WITH inc
        UNWIND $remediation AS step
            MERGE (rem:Remediation {step: step})
            MERGE (inc)-[:MITIGATED_BY]->(rem)
        """
        try:
            with self._driver.session() as session:
                session.run(
                    query,
                    incidentId=incident.incidentId,
                    service=incident.service,
                    summary=incident.summary,
                    severity=incident.severity,
                    timestamp=incident.timestamp.isoformat(),
                    deploymentVersion=incident.deploymentVersion,
                    rootCause=incident.rootCause,
                    remediation=incident.remediation,
                )
        except Exception as exc:
            log.warning("neo4j_write_failed incidentId=%s reason=%s", incident.incidentId, exc)

    def find_incidents_by_cause(self, service: str | None, root_cause: str) -> list[dict[str, str]]:
        if self._driver is None:
            return []
        query = """
        MATCH (svc:Service)-[:EXPERIENCED]->(inc:Incident)-[:CAUSED_BY]->(cause:RootCause)
        WHERE toLower(cause.name) CONTAINS toLower($rootCause)
          AND ($service IS NULL OR svc.name = $service)
        OPTIONAL MATCH (inc)-[:MITIGATED_BY]->(rem:Remediation)
        RETURN inc.incidentId AS incidentId,
               svc.name AS service,
               inc.severity AS severity,
               inc.summary AS summary,
               cause.name AS rootCause,
               collect(rem.step) AS remediation
        ORDER BY inc.timestamp DESC
        LIMIT 25
        """
        try:
            with self._driver.session() as session:
                return [dict(record) for record in session.run(query, service=service, rootCause=root_cause)]
        except Exception as exc:
            log.warning("neo4j_query_failed rootCause=%s reason=%s", root_cause, exc)
            return []

    def build_causality_graph(self, request: TelemetryCausalityRequest) -> CausalityGraph:
        graph = self._derive_causality_graph(request)
        self._fallback_graphs[graph.incidentId or request.service] = graph
        if self._driver is not None:
            self._write_causality_graph(graph)
        return graph

    def latest_causality_graph(self, incident_id: str | None = None) -> CausalityGraph:
        if incident_id and incident_id in self._fallback_graphs:
            return self._fallback_graphs[incident_id]
        if self._fallback_graphs:
            return next(reversed(self._fallback_graphs.values()))
        return self._derive_causality_graph(
            TelemetryCausalityRequest(
                incidentId="INC-DEMO-CAUSALITY",
                service="payment-service",
                deploymentVersion="v2.3.0",
                telemetry={"redis_latency_ms": 920, "error_rate": 0.22, "p95_latency_ms": 2100},
                logs=["redis timeout after 500ms", "connection pool exhausted", "checkout API timeout"],
                events=["Deploy v2.3.0 completed", "Redis latency alarm fired", "API timeout rate increased"],
            )
        )

    def traverse(self, request: GraphTraversalRequest) -> CausalityGraph:
        graphs = list(self._fallback_graphs.values()) or [self.latest_causality_graph()]
        nodes = {node.id: node for graph in graphs for node in graph.nodes}
        edges = [edge for graph in graphs for edge in graph.edges]
        if request.startNodeId not in nodes:
            return CausalityGraph(
                incidentId=None,
                tenantId=request.tenantId,
                nodes=[],
                edges=[],
                reasoningSummary=f"No graph node found for {request.startNodeId}.",
            )

        adjacency: dict[str, list[tuple[str, CausalityEdge]]] = {}
        for edge in edges:
            if request.direction in {"out", "both"}:
                adjacency.setdefault(edge.source, []).append((edge.target, edge))
            if request.direction in {"in", "both"}:
                adjacency.setdefault(edge.target, []).append((edge.source, edge))

        seen = {request.startNodeId}
        selected_edges: list[CausalityEdge] = []
        queue: deque[tuple[str, int]] = deque([(request.startNodeId, 0)])
        while queue:
            node_id, depth = queue.popleft()
            if depth >= max(request.maxDepth, 1):
                continue
            for next_id, edge in adjacency.get(node_id, []):
                selected_edges.append(edge)
                if next_id not in seen:
                    seen.add(next_id)
                    queue.append((next_id, depth + 1))

        selected_nodes = [nodes[node_id] for node_id in seen]
        return CausalityGraph(
            incidentId=None,
            tenantId=request.tenantId,
            nodes=selected_nodes,
            edges=selected_edges,
            blastRadius=[node.label for node in selected_nodes if node.kind in {"service", "fault"}],
            recurringPatterns=[node.label for node in selected_nodes if node.kind == "signal"],
            reasoningSummary=(
                f"Traversal from {request.startNodeId} reached {len(selected_nodes)} nodes "
                f"and {len(selected_edges)} relationships."
            ),
        )

    def _derive_causality_graph(self, request: TelemetryCausalityRequest) -> CausalityGraph:
        incident_id = request.incidentId or f"INC-{request.service.upper().replace('-', '')}-LIVE"
        service_id = f"service:{request.service}"
        incident_node_id = f"incident:{incident_id}"
        nodes = [
            CausalityNode(
                id=service_id,
                label=request.service,
                kind="service",
                service=request.service,
                detail="Affected service receiving telemetry, logs, traces, and deployment context.",
                score=0.8,
            ),
            CausalityNode(
                id=incident_node_id,
                label=incident_id,
                kind="incident",
                service=request.service,
                severity=self._severity_for(request.telemetry),
                detail="Incident synthesized from telemetry causality analysis.",
                score=1.0,
            ),
        ]
        edges = [
            CausalityEdge(
                source=service_id,
                target=incident_node_id,
                relationship="EXPERIENCED",
                weight=1.0,
                evidence=[f"service={request.service}"],
            )
        ]

        previous_id = service_id
        if request.deploymentVersion:
            deployment_id = f"deployment:{request.service}:{request.deploymentVersion}"
            nodes.append(
                CausalityNode(
                    id=deployment_id,
                    label=f"Deploy {request.deploymentVersion}",
                    kind="deployment",
                    service=request.service,
                    detail="Deployment change included in causality timeline.",
                    score=0.72,
                )
            )
            edges.append(
                CausalityEdge(
                    source=deployment_id,
                    target=service_id,
                    relationship="CHANGED",
                    weight=0.78,
                    evidence=[f"deploymentVersion={request.deploymentVersion}"],
                )
            )
            previous_id = deployment_id

        signals = self._signals_for(request.telemetry, request.logs, request.events)
        for signal in signals:
            node_id = f"signal:{request.service}:{signal['name']}"
            nodes.append(
                CausalityNode(
                    id=node_id,
                    label=signal["label"],
                    kind="signal",
                    service=request.service,
                    detail=signal["detail"],
                    score=signal["score"],
                )
            )
            edges.append(
                CausalityEdge(
                    source=previous_id,
                    target=node_id,
                    relationship=signal["relationship"],
                    weight=signal["score"],
                    evidence=signal["evidence"],
                )
            )
            previous_id = node_id

        if signals:
            fault_id = f"fault:{request.service}:customer-impact"
            nodes.append(
                CausalityNode(
                    id=fault_id,
                    label="API timeout / user impact",
                    kind="fault",
                    service=request.service,
                    detail="Downstream timeout and retry impact inferred from unhealthy telemetry signals.",
                    score=max(signal["score"] for signal in signals),
                )
            )
            edges.extend(
                [
                    CausalityEdge(
                        source=previous_id,
                        target=fault_id,
                        relationship="PROPAGATED_TO",
                        weight=0.82,
                        evidence=request.logs[:3] or ["unhealthy telemetry threshold crossed"],
                    ),
                    CausalityEdge(
                        source=fault_id,
                        target=incident_node_id,
                        relationship="CAUSED",
                        weight=0.9,
                        evidence=[signal["label"] for signal in signals[:3]],
                    ),
                ]
            )

        blast_radius = [request.service]
        if any(signal["name"] in {"kafka_lag", "redis_saturation", "db_connection_usage"} for signal in signals):
            blast_radius.extend([f"{request.service}:downstream-apis", f"{request.service}:retry-callers"])
        recurring_patterns = [signal["name"].replace("_", "-") for signal in signals]
        summary = (
            f"Telemetry causality graph for {request.service} linked "
            f"{len(signals)} operational signals to {incident_id}."
        )
        return CausalityGraph(
            incidentId=incident_id,
            tenantId=request.tenantId or "default",
            nodes=nodes,
            edges=edges,
            blastRadius=blast_radius,
            recurringPatterns=recurring_patterns,
            reasoningSummary=summary,
        )

    def _write_causality_graph(self, graph: CausalityGraph) -> None:
        query = """
        UNWIND $nodes AS node
        MERGE (n:CausalityNode {id: node.id})
        SET n.label = node.label,
            n.kind = node.kind,
            n.service = node.service,
            n.severity = node.severity,
            n.detail = node.detail,
            n.score = node.score,
            n.tenantId = $tenantId
        WITH count(*) AS _
        UNWIND $edges AS edge
        MATCH (source:CausalityNode {id: edge.source})
        MATCH (target:CausalityNode {id: edge.target})
        MERGE (source)-[rel:CAUSAL_LINK {relationship: edge.relationship}]->(target)
        SET rel.weight = edge.weight,
            rel.evidence = edge.evidence
        """
        try:
            with self._driver.session() as session:
                session.run(
                    query,
                    tenantId=graph.tenantId,
                    nodes=[node.model_dump() for node in graph.nodes],
                    edges=[edge.model_dump() for edge in graph.edges],
                )
        except Exception as exc:
            log.warning("neo4j_causality_write_failed incidentId=%s reason=%s", graph.incidentId, exc)

    @staticmethod
    def _signals_for(
        telemetry: dict[str, object], logs: list[str], events: list[str]
    ) -> list[dict[str, object]]:
        lower_logs = " ".join([*logs, *events]).lower()
        values = {key.lower(): value for key, value in telemetry.items()}
        signals: list[dict[str, object]] = []

        def number(*keys: str) -> float | None:
            for key in keys:
                value = values.get(key)
                if isinstance(value, int | float):
                    return float(value)
                if isinstance(value, str):
                    try:
                        return float(value.strip("%")) / (100 if value.endswith("%") else 1)
                    except ValueError:
                        continue
            return None

        redis_latency = number("redis_latency_ms")
        if redis_latency is not None and redis_latency >= 500 or "redis" in lower_logs:
            signals.append(
                {
                    "name": "redis_saturation",
                    "label": "Redis saturation",
                    "relationship": "SATURATED",
                    "detail": f"Redis latency or pool pressure detected ({redis_latency or 'log evidence'}).",
                    "score": 0.88,
                    "evidence": [f"redis_latency_ms={redis_latency}"] if redis_latency else ["redis log evidence"],
                }
            )

        kafka_lag = number("kafka_lag", "consumer_lag", "lag")
        if kafka_lag is not None and kafka_lag >= 1000 or "consumer lag" in lower_logs or "kafka" in lower_logs:
            signals.append(
                {
                    "name": "kafka_lag",
                    "label": "Kafka lag",
                    "relationship": "BACKED_UP",
                    "detail": f"Consumer lag indicates delayed event processing ({kafka_lag or 'log evidence'}).",
                    "score": 0.82,
                    "evidence": [f"kafka_lag={kafka_lag}"] if kafka_lag else ["kafka lag log evidence"],
                }
            )

        memory_pressure = number("memory_pressure", "memory_working_set_ratio", "memory_percent")
        restart_count = number("restart_count", "pod_restart_count")
        if (
            memory_pressure is not None and memory_pressure >= 0.85
            or restart_count is not None and restart_count > 0
            or "oom" in lower_logs
            or "crashloop" in lower_logs
        ):
            signals.append(
                {
                    "name": "memory_pressure",
                    "label": "Memory pressure",
                    "relationship": "EVICTED_OR_RESTARTED",
                    "detail": "Memory pressure, OOM, or restart evidence detected.",
                    "score": 0.9,
                    "evidence": [
                        item
                        for item in [f"memory={memory_pressure}" if memory_pressure else "", f"restart_count={restart_count}" if restart_count else ""]
                        if item
                    ]
                    or ["memory log evidence"],
                }
            )

        db_used = number("db_connections_used", "db_pool_used")
        db_max = number("db_connections_max", "db_pool_max")
        db_pool_exhausted = db_used is not None and db_max and db_used / db_max >= 0.85
        db_log_evidence = (
            ("database" in lower_logs or "db " in lower_logs or "postgres" in lower_logs)
            and "connection pool" in lower_logs
        )
        if db_pool_exhausted or db_log_evidence:
            signals.append(
                {
                    "name": "db_connection_usage",
                    "label": "DB connection exhaustion",
                    "relationship": "EXHAUSTED",
                    "detail": "Database connection pool usage crossed capacity threshold.",
                    "score": 0.8,
                    "evidence": [f"db_connections={db_used}/{db_max}"] if db_used and db_max else ["connection pool log evidence"],
                }
            )

        latency = number("p95_latency_ms", "latency_ms")
        error_rate = number("error_rate", "error_rate_pct")
        if latency is not None and latency >= 1000 or error_rate is not None and error_rate >= 0.05:
            signals.append(
                {
                    "name": "api_degradation",
                    "label": "API degradation",
                    "relationship": "DEGRADED",
                    "detail": "Latency or error rate crossed incident thresholds.",
                    "score": 0.76,
                    "evidence": [
                        item
                        for item in [f"p95_latency_ms={latency}" if latency else "", f"error_rate={error_rate}" if error_rate else ""]
                        if item
                    ],
                }
            )
        return signals

    @staticmethod
    def _severity_for(telemetry: dict[str, object]) -> str:
        values = {key.lower(): value for key, value in telemetry.items()}
        error_rate = values.get("error_rate")
        latency = values.get("p95_latency_ms") or values.get("latency_ms")
        try:
            error = float(str(error_rate).strip("%")) / (100 if str(error_rate).endswith("%") else 1)
            p95 = float(str(latency))
        except (TypeError, ValueError):
            return "MEDIUM"
        if error >= 0.2 or p95 >= 2000:
            return "CRITICAL"
        if error >= 0.1 or p95 >= 1000:
            return "HIGH"
        return "MEDIUM"

    def _build_driver(self):
        if settings.neo4j_uri.lower() in {"disabled", "none", "off"}:
            return None
        try:
            from neo4j import GraphDatabase

            driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password),
                connection_timeout=2,
            )
            driver.verify_connectivity()
            return driver
        except Exception as exc:
            log.warning("neo4j_unavailable reason=%s", exc)
            return None
