package dev.aegis.common.model;

import java.time.Instant;
import java.util.Map;

public record ReasoningEvent(
        String eventId,
        String traceId,
        Instant timestamp,
        String step,
        String incidentId,
        String service,
        String detail,
        Map<String, Object> inputs,
        Map<String, Object> outputs,
        int durationMs,
        String parentEventId
) {
}
