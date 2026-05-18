package dev.aegis.common.model;

public record SemanticSearchRequest(
        String query,
        String service,
        int limit
) {
}
