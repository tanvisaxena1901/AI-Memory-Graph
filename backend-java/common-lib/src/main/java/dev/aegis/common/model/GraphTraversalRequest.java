package dev.aegis.common.model;

public record GraphTraversalRequest(
        String startNodeId,
        String tenantId,
        int maxDepth,
        String direction
) {
}
