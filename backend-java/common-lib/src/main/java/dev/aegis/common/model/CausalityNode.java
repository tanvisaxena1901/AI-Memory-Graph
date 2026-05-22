package dev.aegis.common.model;

public record CausalityNode(
        String id,
        String label,
        String kind,
        String service,
        String severity,
        String detail,
        double score
) {
}
