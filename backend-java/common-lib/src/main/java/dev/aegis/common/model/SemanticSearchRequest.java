package dev.aegis.common.model;

import java.util.List;
import java.util.Map;

public record SemanticSearchRequest(
        String query,
        String tenantId,
        String teamId,
        String requestedBy,
        String role,
        String service,
        IncidentSeverity severity,
        int limit,
        Map<String, Object> telemetry,
        List<String> memoryTypes
) {
}
