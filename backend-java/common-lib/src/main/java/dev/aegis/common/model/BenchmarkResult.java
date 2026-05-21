package dev.aegis.common.model;

public record BenchmarkResult(
        String query,
        String expectedIncidentId,
        String topMatchIncidentId,
        boolean topKHit,
        boolean recallAt5Hit,
        double similarityScore
) {
}
