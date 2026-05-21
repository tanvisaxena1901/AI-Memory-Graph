package dev.aegis.common.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record SimilarIncident(
        String incidentId,
        String tenantId,
        String teamId,
        String serviceOwner,
        String service,
        IncidentSeverity severity,
        String summary,
        String deploymentVersion,
        Instant timestamp,
        double score,
        double similarityScore,
        double rankScore,
        String memoryType,
        String rootCause,
        List<String> remediation,
        Map<String, Object> telemetrySignals,
        Map<String, Double> rankingSignals,
        String memorySchemaVersion,
        String embeddingModel,
        String embeddingVersion,
        String ttlTier,
        double qualityScore,
        String duplicateOf,
        String cluster,
        String runbookRef
) {
}
