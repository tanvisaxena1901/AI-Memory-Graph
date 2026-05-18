package dev.aegis.telemetry;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class TelemetryBuffer {
    private static final int MAX_EVENTS = 200;

    private final Deque<TelemetryEnvelope> events = new ArrayDeque<>();
    private final Counter jsonEvents;
    private final Counter otlpMetricBatches;
    private final Counter otlpLogBatches;
    private final Counter otlpTraceBatches;

    public TelemetryBuffer(MeterRegistry meterRegistry) {
        this.jsonEvents = meterRegistry.counter("aegis.telemetry.json.events");
        this.otlpMetricBatches = meterRegistry.counter("aegis.telemetry.otlp.batches", "signal", "metrics");
        this.otlpLogBatches = meterRegistry.counter("aegis.telemetry.otlp.batches", "signal", "logs");
        this.otlpTraceBatches = meterRegistry.counter("aegis.telemetry.otlp.batches", "signal", "traces");
    }

    public TelemetryEnvelope recordJson(Map<String, Object> payload) {
        jsonEvents.increment();
        return append(new TelemetryEnvelope(
                "json",
                "normalized",
                payload.size(),
                0,
                Instant.now(),
                payload));
    }

    public TelemetryEnvelope recordOtlp(String signal, int bytes, String contentType) {
        switch (signal) {
            case "metrics" -> otlpMetricBatches.increment();
            case "logs" -> otlpLogBatches.increment();
            case "traces" -> otlpTraceBatches.increment();
            default -> {
            }
        }
        return append(new TelemetryEnvelope(
                "otlp-http",
                signal,
                0,
                bytes,
                Instant.now(),
                Map.<String, Object>of("contentType", contentType == null ? "unknown" : contentType)));
    }

    public synchronized List<TelemetryEnvelope> recent() {
        return new ArrayList<>(events);
    }

    public synchronized TelemetryStats stats() {
        long json = events.stream().filter(event -> event.transport().equals("json")).count();
        long metrics = events.stream().filter(event -> event.signal().equals("metrics")).count();
        long logs = events.stream().filter(event -> event.signal().equals("logs")).count();
        long traces = events.stream().filter(event -> event.signal().equals("traces")).count();
        return new TelemetryStats(events.size(), json, metrics, logs, traces);
    }

    private synchronized TelemetryEnvelope append(TelemetryEnvelope event) {
        events.addFirst(event);
        while (events.size() > MAX_EVENTS) {
            events.removeLast();
        }
        return event;
    }

    public record TelemetryEnvelope(
            String transport,
            String signal,
            int fieldCount,
            int byteSize,
            Instant acceptedAt,
            Map<String, Object> attributes
    ) {
    }

    public record TelemetryStats(
            int bufferedEvents,
            long jsonEvents,
            long otlpMetricBatches,
            long otlpLogBatches,
            long otlpTraceBatches
    ) {
    }
}
