package dev.aegis.common.model;

import java.util.List;

public record CausalityEdge(
        String source,
        String target,
        String relationship,
        double weight,
        List<String> evidence
) {
}
