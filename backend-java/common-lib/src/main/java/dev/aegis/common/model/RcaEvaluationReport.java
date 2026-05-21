package dev.aegis.common.model;

public record RcaEvaluationReport(
        String incidentId,
        boolean rootCauseMatched,
        double remediationOverlap,
        double accuracyScore,
        Double confidenceCalibrationError,
        String aiRootCause,
        String humanRootCause
) {
}
