package dev.aegis.common.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record TelemetryCausalityRequest(
        String incidentId,
        String tenantId,
        String service,
        String deploymentVersion,
        Map<String, Object> telemetry,
        List<String> logs,
        List<String> events,
        Instant timestamp
) {
}
