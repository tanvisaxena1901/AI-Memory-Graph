from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class MemoryType(StrEnum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"


class AccessRole(StrEnum):
    VIEWER = "viewer"
    RESPONDER = "responder"
    PLATFORM_ADMIN = "platform-admin"
    AUDITOR = "auditor"


class Incident(BaseModel):
    incidentId: str
    tenantId: str = "default"
    teamId: str | None = None
    serviceOwner: str | None = None
    service: str
    severity: str
    summary: str
    deploymentVersion: str | None = None
    timestamp: datetime
    rootCause: str | None = None
    remediation: list[str] = Field(default_factory=list)
    successfulRemediation: bool | None = None
    aiConfidence: float | None = None
    humanConfirmed: bool | None = None
    runbookRef: str | None = None


class IndexIncidentRequest(BaseModel):
    incident: Incident
    logs: list[str] | None = Field(default_factory=list)
    telemetry: dict[str, Any] | None = Field(default_factory=dict)


class SemanticSearchRequest(BaseModel):
    query: str
    tenantId: str = "default"
    teamId: str | None = None
    requestedBy: str = "anonymous"
    role: AccessRole = AccessRole.VIEWER
    service: str | None = None
    severity: str | None = None
    limit: int = 5
    telemetry: dict[str, Any] | None = Field(default_factory=dict)
    memoryTypes: list[MemoryType] | None = None


class SimilarIncident(BaseModel):
    incidentId: str
    tenantId: str = "default"
    teamId: str | None = None
    serviceOwner: str | None = None
    service: str
    severity: str
    summary: str
    deploymentVersion: str | None = None
    timestamp: datetime
    score: float
    similarityScore: float
    rankScore: float
    memoryType: MemoryType = MemoryType.EPISODIC
    rootCause: str | None = None
    remediation: list[str] = Field(default_factory=list)
    telemetrySignals: dict[str, Any] = Field(default_factory=dict)
    rankingSignals: dict[str, float] = Field(default_factory=dict)
    memorySchemaVersion: str = "v1"
    embeddingModel: str
    embeddingVersion: str
    ttlTier: str
    qualityScore: float
    duplicateOf: str | None = None
    cluster: str
    runbookRef: str | None = None


class RcaRequest(BaseModel):
    incidentId: str | None = None
    tenantId: str = "default"
    teamId: str | None = None
    requestedBy: str = "anonymous"
    role: AccessRole = AccessRole.RESPONDER
    query: str
    logs: list[str] | None = Field(default_factory=list)
    telemetry: dict[str, Any] | None = Field(default_factory=dict)


class RcaResponse(BaseModel):
    incidentId: str | None = None
    summary: str
    likelyRootCause: str
    evidence: list[str]
    remediation: list[str]
    confidence: float = 0.6
    traceId: str | None = None


class MemoryFeedbackRequest(BaseModel):
    incidentId: str
    tenantId: str = "default"
    actorId: str = "anonymous"
    helpful: bool | None = None
    correctRca: bool | None = None
    remediationWorked: bool | None = None
    actionTaken: str | None = None
    notes: str | None = None


class RcaEvaluationRequest(BaseModel):
    incidentId: str
    tenantId: str = "default"
    aiRootCause: str
    humanRootCause: str
    aiRemediation: list[str] = Field(default_factory=list)
    humanRemediation: list[str] = Field(default_factory=list)
    aiConfidence: float | None = None
    humanConfirmed: bool | None = None


class RcaEvaluationReport(BaseModel):
    incidentId: str
    rootCauseMatched: bool
    remediationOverlap: float
    accuracyScore: float
    confidenceCalibrationError: float | None = None
    aiRootCause: str
    humanRootCause: str


class BenchmarkCase(BaseModel):
    query: str
    expectedIncidentId: str
    service: str | None = None
    severity: str | None = None


class BenchmarkResult(BaseModel):
    query: str
    expectedIncidentId: str
    topMatchIncidentId: str | None
    topKHit: bool
    recallAt5Hit: bool
    similarityScore: float


class BenchmarkReport(BaseModel):
    cases: list[BenchmarkResult]
    topKAccuracy: float
    recallAt5: float
    averageSimilarityScore: float


class RetrievalEvaluationReport(BaseModel):
    cases: list[BenchmarkResult]
    precisionAt5: float
    recallAt5: float
    mrr: float
    hitRate: float


class ReembeddingReport(BaseModel):
    status: str
    scanned: int
    reembedded: int
    embeddingModel: str
    embeddingVersion: str


class SyntheticDatasetReport(BaseModel):
    status: str
    generated: int
    clusters: dict[str, int]


class AuditEvent(BaseModel):
    eventId: str
    timestamp: datetime
    actorId: str
    role: AccessRole
    tenantId: str
    action: str
    query: str | None = None
    retrievedIncidentIds: list[str] = Field(default_factory=list)
    recommendation: str | None = None
    actionTaken: str | None = None


class RagTrace(BaseModel):
    traceId: str
    timestamp: datetime
    query: str
    tenantId: str
    usedMemories: list[SimilarIncident]
    coldStart: bool
    fallbackSources: list[str] = Field(default_factory=list)
    events: list["ReasoningEvent"] = Field(default_factory=list)


class PostmortemDraft(BaseModel):
    incidentId: str
    summary: str
    timeline: list[str]
    impact: str
    rootCause: str
    detectionGap: str
    remediation: list[str]
    followUps: list[str]


class GraphInsightReport(BaseModel):
    repeatedDeploymentFailures: list[dict[str, Any]]
    recurringRootCauses: list[dict[str, Any]]
    effectiveRemediations: list[dict[str, Any]]


class TelemetryCausalityRequest(BaseModel):
    incidentId: str | None = None
    tenantId: str | None = "default"
    service: str
    deploymentVersion: str | None = None
    telemetry: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    events: list[str] = Field(default_factory=list)
    timestamp: datetime | None = None


class CausalityNode(BaseModel):
    id: str
    label: str
    kind: str
    service: str | None = None
    severity: str | None = None
    detail: str
    score: float = 0.0


class CausalityEdge(BaseModel):
    source: str
    target: str
    relationship: str
    weight: float = 1.0
    evidence: list[str] = Field(default_factory=list)


class CausalityGraph(BaseModel):
    incidentId: str | None = None
    tenantId: str = "default"
    nodes: list[CausalityNode]
    edges: list[CausalityEdge]
    blastRadius: list[str] = Field(default_factory=list)
    recurringPatterns: list[str] = Field(default_factory=list)
    reasoningSummary: str


class GraphTraversalRequest(BaseModel):
    startNodeId: str
    tenantId: str = "default"
    maxDepth: int = 3
    direction: str = "both"


class ReasoningEvent(BaseModel):
    eventId: str
    traceId: str
    timestamp: datetime
    step: str
    incidentId: str | None = None
    service: str | None = None
    detail: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    durationMs: int = 0
    parentEventId: str | None = None


class ReasoningTraceReplay(BaseModel):
    traceId: str
    events: list[ReasoningEvent]
    workflowPath: list[str]
    summary: str
