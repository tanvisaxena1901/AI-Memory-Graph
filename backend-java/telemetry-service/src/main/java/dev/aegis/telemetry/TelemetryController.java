package dev.aegis.telemetry;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/telemetry")
public class TelemetryController {
    private static final Logger log = LoggerFactory.getLogger(TelemetryController.class);

    private final TelemetryBuffer telemetryBuffer;

    public TelemetryController(TelemetryBuffer telemetryBuffer) {
        this.telemetryBuffer = telemetryBuffer;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    TelemetryAccepted ingest(@RequestBody Map<String, Object> event) {
        TelemetryBuffer.TelemetryEnvelope envelope = telemetryBuffer.recordJson(event);
        log.info("telemetry_event_received transport=json fields={}", event.keySet());
        return new TelemetryAccepted("accepted", envelope.acceptedAt(), "json", "normalized");
    }

    @GetMapping("/recent")
    List<TelemetryBuffer.TelemetryEnvelope> recent() {
        return telemetryBuffer.recent();
    }

    @GetMapping("/stats")
    TelemetryBuffer.TelemetryStats stats() {
        return telemetryBuffer.stats();
    }

    record TelemetryAccepted(String status, Instant acceptedAt, String transport, String signal) {
    }
}
