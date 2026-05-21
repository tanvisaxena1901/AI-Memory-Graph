package dev.aegis.common.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record IncidentIngestRequest(
        String incidentId,
        String tenantId,
        String teamId,
        String serviceOwner,
        String service,
        IncidentSeverity severity,
        String summary,
        List<String> logs,
        Map<String, Object> telemetry,
        String deploymentVersion,
        Instant timestamp,
        String rootCause,
        List<String> remediation,
        Boolean successfulRemediation,
        Double aiConfidence,
        Boolean humanConfirmed,
        String runbookRef
) {
}
