package dev.aegis.common.model;

import java.util.List;

public record BenchmarkReport(
        List<BenchmarkResult> cases,
        double topKAccuracy,
        double recallAt5,
        double averageSimilarityScore
) {
}
