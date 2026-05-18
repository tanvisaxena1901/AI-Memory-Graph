package dev.aegis.common.model;

import java.time.Instant;

public record IncidentDto(
        String incidentId,
        String service,
        IncidentSeverity severity,
        String summary,
        String deploymentVersion,
        Instant timestamp
) {
}
