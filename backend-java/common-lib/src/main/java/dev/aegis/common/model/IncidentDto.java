package dev.aegis.common.model;

import java.time.Instant;
import java.util.List;

public record IncidentDto(
        String incidentId,
        String tenantId,
        String teamId,
        String serviceOwner,
        String service,
        IncidentSeverity severity,
        String summary,
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
