package dev.aegis.common.model;

import java.util.List;

public record RcaEvaluationRequest(
        String incidentId,
        String tenantId,
        String aiRootCause,
        String humanRootCause,
        List<String> aiRemediation,
        List<String> humanRemediation,
        Double aiConfidence,
        Boolean humanConfirmed
) {
}
