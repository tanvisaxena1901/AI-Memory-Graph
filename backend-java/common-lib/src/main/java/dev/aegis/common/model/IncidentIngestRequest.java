package dev.aegis.common.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record IncidentIngestRequest(
        String incidentId,
        String service,
        IncidentSeverity severity,
        String summary,
        List<String> logs,
        Map<String, Object> telemetry,
        String deploymentVersion,
        Instant timestamp
) {
}
