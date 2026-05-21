package dev.aegis.common.model;

import java.util.List;

public record RcaResponse(
        String incidentId,
        String summary,
        String likelyRootCause,
        List<String> evidence,
        List<String> remediation,
        double confidence,
        String traceId
) {
}
