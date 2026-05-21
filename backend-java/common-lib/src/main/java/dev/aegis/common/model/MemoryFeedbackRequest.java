package dev.aegis.common.model;

public record MemoryFeedbackRequest(
        String incidentId,
        String tenantId,
        String actorId,
        Boolean helpful,
        Boolean correctRca,
        Boolean remediationWorked,
        String actionTaken,
        String notes
) {
}
