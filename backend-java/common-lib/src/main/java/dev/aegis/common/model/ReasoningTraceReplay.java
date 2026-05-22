package dev.aegis.common.model;

import java.util.List;

public record ReasoningTraceReplay(
        String traceId,
        List<ReasoningEvent> events,
        List<String> workflowPath,
        String summary
) {
}
