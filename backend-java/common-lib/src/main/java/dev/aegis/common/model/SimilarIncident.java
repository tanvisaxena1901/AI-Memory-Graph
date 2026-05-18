package dev.aegis.common.model;

import java.time.Instant;

public record SimilarIncident(
        String incidentId,
        String service,
        IncidentSeverity severity,
        String summary,
        String deploymentVersion,
        Instant timestamp,
        double score
) {
}
