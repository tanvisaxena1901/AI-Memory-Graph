from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class Incident(BaseModel):
    incidentId: str
    service: str
    severity: str
    summary: str
    deploymentVersion: str | None = None
    timestamp: datetime


class IndexIncidentRequest(BaseModel):
    incident: Incident
    logs: list[str] | None = Field(default_factory=list)
    telemetry: dict[str, Any] | None = Field(default_factory=dict)


class SemanticSearchRequest(BaseModel):
    query: str
    service: str | None = None
    limit: int = 5


class SimilarIncident(BaseModel):
    incidentId: str
    service: str
    severity: str
    summary: str
    deploymentVersion: str | None = None
    timestamp: datetime
    score: float


class RcaRequest(BaseModel):
    incidentId: str | None = None
    query: str
    logs: list[str] | None = Field(default_factory=list)
    telemetry: dict[str, Any] | None = Field(default_factory=dict)


class RcaResponse(BaseModel):
    incidentId: str | None = None
    summary: str
    likelyRootCause: str
    evidence: list[str]
    remediation: list[str]
