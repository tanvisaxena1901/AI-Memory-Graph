package dev.aegis.common.model;

import java.util.List;

public record CausalityGraph(
        String incidentId,
        String tenantId,
        List<CausalityNode> nodes,
        List<CausalityEdge> edges,
        List<String> blastRadius,
        List<String> recurringPatterns,
        String reasoningSummary
) {
}
