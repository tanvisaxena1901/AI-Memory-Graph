package dev.aegis.common.model;

import java.util.List;
import java.util.Map;

public record RcaRequest(
        String incidentId,
        String tenantId,
        String teamId,
        String requestedBy,
        String role,
        String query,
        List<String> logs,
        Map<String, Object> telemetry
) {
}
